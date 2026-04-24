/**
 * auth-store.ts — login / register-with-invite / logout helpers
 *
 * Uses Node built-in `crypto.scrypt` (no extra deps) for password hashing.
 * Session is stored as a signed cookie ("iuf_session") containing the user id.
 * Cookie signing uses HMAC-SHA256 with AUTH_SECRET env var.
 *
 * Format: `<userId>.<hmac_hex>`
 */
import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

import { eq } from "drizzle-orm";

import { getDb, inviteCodes, users, workspaces } from "@iuf-trading-room/db";

const scryptAsync = promisify(scrypt);

// ── constants ─────────────────────────────────────────────────────────────────
const COOKIE_NAME = "iuf_session";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days
const SCRYPT_KEYLEN = 64;

function getAuthSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    // fall back to a deterministic-but-weak secret in dev so server doesn't crash
    return "iuf-dev-secret-change-in-prod";
  }
  return secret;
}

// ── password helpers ──────────────────────────────────────────────────────────
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scryptAsync(password, salt, SCRYPT_KEYLEN)) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, keyHex] = stored.split(":");
  if (!salt || !keyHex) return false;
  try {
    const derived = (await scryptAsync(password, salt, SCRYPT_KEYLEN)) as Buffer;
    const storedKey = Buffer.from(keyHex, "hex");
    if (derived.length !== storedKey.length) return false;
    return timingSafeEqual(derived, storedKey);
  } catch {
    return false;
  }
}

// ── cookie helpers ────────────────────────────────────────────────────────────
function signCookie(userId: string): string {
  const secret = getAuthSecret();
  const mac = createHmac("sha256", secret).update(userId).digest("hex");
  return `${userId}.${mac}`;
}

function verifyAndParseCookie(value: string): string | null {
  const dot = value.lastIndexOf(".");
  if (dot < 0) return null;
  const userId = value.slice(0, dot);
  const mac = value.slice(dot + 1);
  const expected = createHmac("sha256", getAuthSecret()).update(userId).digest("hex");
  const expectedBuf = Buffer.from(expected);
  const receivedBuf = Buffer.from(mac.padEnd(expected.length, "0").slice(0, expected.length));
  if (expectedBuf.length !== receivedBuf.length) return null;
  return timingSafeEqual(expectedBuf, receivedBuf) ? userId : null;
}

export function buildSetCookieHeader(userId: string): string {
  const value = signCookie(userId);
  return [
    `${COOKIE_NAME}=${value}`,
    `Max-Age=${COOKIE_MAX_AGE}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax"
  ].join("; ");
}

export function buildClearCookieHeader(): string {
  return [
    `${COOKIE_NAME}=`,
    "Max-Age=0",
    "Path=/",
    "HttpOnly",
    "SameSite=Lax"
  ].join("; ");
}

export function parseSessionCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [k, v] = part.trim().split("=");
    if (k?.trim() === COOKIE_NAME && v) {
      return verifyAndParseCookie(v.trim());
    }
  }
  return null;
}

// ── DB helpers ────────────────────────────────────────────────────────────────
function requireDb() {
  const db = getDb();
  if (!db) throw new Error("auth-store requires PERSISTENCE_MODE=database");
  return db;
}

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: "Owner" | "Admin" | "Analyst" | "Trader" | "Viewer";
  workspaceId: string | null;
};

export type WorkspaceRow = {
  id: string;
  name: string;
  slug: string;
};

export type AuthResult =
  | { ok: true; user: AuthUser; workspace: WorkspaceRow }
  | { ok: false; error: string };

// ── login ─────────────────────────────────────────────────────────────────────
export async function loginWithPassword(
  email: string,
  password: string
): Promise<AuthResult> {
  const db = requireDb();
  const [row] = await db
    .select()
    .from(users)
    .where(eq(users.email, email.toLowerCase().trim()))
    .limit(1);

  if (!row) {
    return { ok: false, error: "invalid_credentials" };
  }

  if (!row.passwordHash) {
    // legacy seed user without password — only allow if password matches SEED_OWNER_PASSWORD
    const seedPassword = process.env.SEED_OWNER_PASSWORD;
    if (!seedPassword || password !== seedPassword) {
      return { ok: false, error: "invalid_credentials" };
    }
  } else {
    const valid = await verifyPassword(password, row.passwordHash);
    if (!valid) {
      return { ok: false, error: "invalid_credentials" };
    }
  }

  const workspace = row.workspaceId
    ? await db.select().from(workspaces).where(eq(workspaces.id, row.workspaceId)).limit(1).then((r) => r[0] ?? null)
    : await db.select().from(workspaces).limit(1).then((r) => r[0] ?? null);

  if (!workspace) {
    return { ok: false, error: "no_workspace" };
  }

  return {
    ok: true,
    user: {
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role as AuthUser["role"],
      workspaceId: row.workspaceId ?? null
    },
    workspace: { id: workspace.id, name: workspace.name, slug: workspace.slug }
  };
}

// ── register with invite ──────────────────────────────────────────────────────
export async function registerWithInvite(
  email: string,
  password: string,
  inviteCode: string
): Promise<AuthResult> {
  const db = requireDb();

  // validate invite code
  const [invite] = await db
    .select()
    .from(inviteCodes)
    .where(eq(inviteCodes.code, inviteCode.trim()))
    .limit(1);

  if (!invite) {
    return { ok: false, error: "invalid_invite_code" };
  }
  if (invite.usedBy) {
    return { ok: false, error: "invite_already_used" };
  }
  if (invite.expiresAt < new Date()) {
    return { ok: false, error: "invite_expired" };
  }

  // check email not already taken
  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.email, email.toLowerCase().trim()))
    .limit(1);

  if (existing) {
    return { ok: false, error: "email_already_registered" };
  }

  // get issuer's workspace (issuedBy may be null for system-generated codes)
  const issuerId = invite.issuedBy;
  const issuer = issuerId
    ? await db.select().from(users).where(eq(users.id, issuerId)).limit(1).then((r) => r[0] ?? null)
    : null;

  const workspace = issuer?.workspaceId
    ? await db.select().from(workspaces).where(eq(workspaces.id, issuer.workspaceId)).limit(1).then((r) => r[0] ?? null)
    : await db.select().from(workspaces).limit(1).then((r) => r[0] ?? null);

  if (!workspace) {
    return { ok: false, error: "no_workspace" };
  }

  const passwordHash = await hashPassword(password);
  const name = email.split("@")[0] ?? email;

  const [newUser] = await db
    .insert(users)
    .values({
      email: email.toLowerCase().trim(),
      name,
      passwordHash,
      role: "Viewer",
      workspaceId: workspace.id
    })
    .returning();

  // mark invite as used
  await db
    .update(inviteCodes)
    .set({ usedBy: newUser.id })
    .where(eq(inviteCodes.id, invite.id));

  return {
    ok: true,
    user: {
      id: newUser.id,
      email: newUser.email,
      name: newUser.name,
      role: newUser.role as AuthUser["role"],
      workspaceId: newUser.workspaceId ?? null
    },
    workspace: { id: workspace.id, name: workspace.name, slug: workspace.slug }
  };
}

// ── get user by id (for session hydration) ───────────────────────────────────
export async function getUserById(userId: string): Promise<(AuthUser & { workspace: WorkspaceRow }) | null> {
  const db = requireDb();
  const [row] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!row) return null;

  const workspace = row.workspaceId
    ? await db.select().from(workspaces).where(eq(workspaces.id, row.workspaceId)).limit(1).then((r) => r[0] ?? null)
    : await db.select().from(workspaces).limit(1).then((r) => r[0] ?? null);

  if (!workspace) return null;

  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role as AuthUser["role"],
    workspaceId: row.workspaceId ?? null,
    workspace: { id: workspace.id, name: workspace.name, slug: workspace.slug }
  };
}

// ── seed owner on startup ─────────────────────────────────────────────────────
export async function seedOwnerIfEmpty(): Promise<void> {
  const db = requireDb();
  const email = process.env.SEED_OWNER_EMAIL;
  const password = process.env.SEED_OWNER_PASSWORD;

  if (!email || !password) return;

  // check if any user exists
  const [anyUser] = await db.select().from(users).limit(1);
  if (anyUser) return; // already seeded

  // ensure workspace exists
  let [workspace] = await db.select().from(workspaces).limit(1);
  if (!workspace) {
    [workspace] = await db
      .insert(workspaces)
      .values({ name: "Primary Desk", slug: "primary-desk" })
      .returning();
  }

  const passwordHash = await hashPassword(password);

  await db.insert(users).values({
    email: email.toLowerCase().trim(),
    name: "楊董",
    passwordHash,
    role: "Owner",
    workspaceId: workspace.id
  });

  console.log(`[auth] Seeded owner user: ${email}`);
}
