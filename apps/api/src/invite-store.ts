/**
 * invite-store.ts — workspace_invites management
 *
 * Security model:
 *  - Plain invite token (256-bit random) returned ONCE at creation; never stored.
 *  - DB stores SHA-256 hash only.
 *  - Token validity: not expired + not revoked + not used + (invited_email matches if set).
 *  - Concurrent double-registration blocked via atomic UPDATE … WHERE used_at IS NULL.
 *  - All invalid/expired/revoked/used states return the same error code ("invalid_or_expired")
 *    to prevent oracle attacks.
 *
 * Invite roles: Admin | Analyst | Trader | Viewer  (Owner is excluded by DB CHECK).
 */

import { createHash, randomBytes } from "node:crypto";

import { eq, and } from "drizzle-orm";
import { sql as drizzleSql } from "drizzle-orm";

import { execRows, getDb, workspaceInvites, users, workspaces } from "@iuf-trading-room/db";

import { hashPassword, validateNewPassword } from "./auth-store.js";
import type { AuthResult } from "./auth-store.js";

// ── constants ──────────────────────────────────────────────────────────────────
const REGISTRATION_BASE_URL = "https://app.eycvector.com/register";
const DEFAULT_EXPIRES_DAYS = 7;

export const INVITE_ROLES = ["Admin", "Analyst", "Trader", "Viewer"] as const;
export type InviteRole = (typeof INVITE_ROLES)[number];

export type InviteStatus = "pending" | "used" | "expired" | "revoked";

export type InviteRow = {
  id: string;
  role: string;
  invitedEmail: string | null;
  label: string | null;
  createdBy: string;
  expiresAt: string;
  createdAt: string;
  usedAt: string | null;
  usedBy: string | null;
  revokedAt: string | null;
  status: InviteStatus;
};

// ── token helpers ──────────────────────────────────────────────────────────────
function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function requireDb() {
  const db = getDb();
  if (!db) throw new Error("invite-store requires PERSISTENCE_MODE=database");
  return db;
}

function computeStatus(row: {
  usedAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date;
}): InviteStatus {
  if (row.revokedAt !== null) return "revoked";
  if (row.usedAt !== null) return "used";
  if (row.expiresAt <= new Date()) return "expired";
  return "pending";
}

// ── createWorkspaceInvite ──────────────────────────────────────────────────────
export async function createWorkspaceInvite(opts: {
  workspaceId: string;
  createdBy: string;
  role: InviteRole;
  invitedEmail?: string | null;
  label?: string | null;
  expiresInDays?: number;
}): Promise<{
  id: string;
  token: string; // plain token — show once only
  registrationUrl: string;
  expiresAt: string;
  role: InviteRole;
}> {
  const db = requireDb();
  const token = generateToken();
  const tokenHash = hashToken(token);
  const expiresInDays = Math.max(1, Math.min(opts.expiresInDays ?? DEFAULT_EXPIRES_DAYS, 365));
  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);

  const [row] = await db
    .insert(workspaceInvites)
    .values({
      workspaceId: opts.workspaceId,
      tokenHash,
      role: opts.role,
      invitedEmail: opts.invitedEmail ?? null,
      label: opts.label ?? null,
      createdBy: opts.createdBy,
      expiresAt
    })
    .returning();

  if (!row) throw new Error("invite-store: INSERT workspace_invites returned no row");

  const registrationUrl = `${REGISTRATION_BASE_URL}?invite=${encodeURIComponent(token)}`;

  return {
    id: row.id,
    token,
    registrationUrl,
    expiresAt: row.expiresAt.toISOString(),
    role: opts.role
  };
}

// ── listWorkspaceInvites ───────────────────────────────────────────────────────
export async function listWorkspaceInvites(workspaceId: string): Promise<InviteRow[]> {
  const db = requireDb();
  const rows = await db
    .select({
      id: workspaceInvites.id,
      role: workspaceInvites.role,
      invitedEmail: workspaceInvites.invitedEmail,
      label: workspaceInvites.label,
      createdBy: workspaceInvites.createdBy,
      expiresAt: workspaceInvites.expiresAt,
      createdAt: workspaceInvites.createdAt,
      usedAt: workspaceInvites.usedAt,
      usedBy: workspaceInvites.usedBy,
      revokedAt: workspaceInvites.revokedAt
    })
    .from(workspaceInvites)
    .where(eq(workspaceInvites.workspaceId, workspaceId))
    .orderBy(drizzleSql`${workspaceInvites.createdAt} DESC`);

  return rows.map((r) => ({
    id: r.id,
    role: r.role,
    invitedEmail: r.invitedEmail,
    label: r.label,
    createdBy: r.createdBy,
    expiresAt: r.expiresAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
    usedAt: r.usedAt?.toISOString() ?? null,
    usedBy: r.usedBy ?? null,
    revokedAt: r.revokedAt?.toISOString() ?? null,
    status: computeStatus({ usedAt: r.usedAt, revokedAt: r.revokedAt, expiresAt: r.expiresAt })
  }));
}

// ── revokeWorkspaceInvite ──────────────────────────────────────────────────────
export async function revokeWorkspaceInvite(
  id: string,
  workspaceId: string
): Promise<boolean> {
  const db = requireDb();
  const result = await db
    .update(workspaceInvites)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(workspaceInvites.id, id),
        eq(workspaceInvites.workspaceId, workspaceId),
        drizzleSql`${workspaceInvites.revokedAt} IS NULL`,
        drizzleSql`${workspaceInvites.usedAt} IS NULL`
      )
    )
    .returning({ id: workspaceInvites.id });

  return result.length > 0;
}

// ── validateAndClaimWorkspaceInvite ───────────────────────────────────────────
// Full register flow: validate token → claim + create user atomically → return session.
//
// Steps 6-8 (claim invite / INSERT user / link used_by) run inside a single DB
// transaction so that any failure (e.g. email UNIQUE violation in a race) rolls
// back the used_at update — the invite remains usable and is NOT permanently burned.
//
// Error oracle prevention: all bad-token states return the same "invalid_or_expired"
// code so callers cannot enumerate which tokens exist.

// Sentinel error thrown inside the transaction to signal "lost concurrent race".
// Using a named class lets us distinguish it from real DB errors in the catch block.
class _ConcurrentClaimError extends Error {
  constructor() { super("CONCURRENT_CLAIM_LOST"); this.name = "_ConcurrentClaimError"; }
}

export async function validateAndClaimWorkspaceInvite(opts: {
  inviteToken: string;
  email: string;
  name: string;
  password: string;
}): Promise<AuthResult> {
  const db = requireDb();
  const tokenHash = hashToken(opts.inviteToken);
  const normalEmail = opts.email.toLowerCase().trim();
  const normalName = opts.name.trim() || (normalEmail.split("@")[0] ?? normalEmail);

  // 1. Look up invite by hash (read-only, outside tx)
  const [invite] = await db
    .select()
    .from(workspaceInvites)
    .where(eq(workspaceInvites.tokenHash, tokenHash))
    .limit(1);

  // All invalid/expired/revoked/used states → same error (no oracle attack)
  if (!invite) {
    return { ok: false, error: "invalid_or_expired" };
  }
  if (invite.revokedAt !== null) {
    return { ok: false, error: "invalid_or_expired" };
  }
  if (invite.usedAt !== null) {
    return { ok: false, error: "invalid_or_expired" };
  }
  if (invite.expiresAt <= new Date()) {
    return { ok: false, error: "invalid_or_expired" };
  }

  // 2. If invite is email-specific, enforce match
  if (invite.invitedEmail !== null) {
    if (invite.invitedEmail.toLowerCase() !== normalEmail) {
      return { ok: false, error: "invalid_or_expired" };
    }
  }

  // 3. Early email uniqueness check (good UX; DB UNIQUE constraint is the hard guard)
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, normalEmail))
    .limit(1);

  if (existing) {
    return { ok: false, error: "email_already_registered" };
  }

  // 4. Password policy
  const passwordError = validateNewPassword(opts.password);
  if (passwordError) {
    return { ok: false, error: passwordError };
  }

  // 5. Hash password (CPU work done outside the transaction)
  const passwordHash = await hashPassword(opts.password);

  // 6-8. Atomic transaction: claim invite + create user + link used_by.
  //
  // If user INSERT fails for any reason (e.g. concurrent email registration),
  // the transaction rolls back and used_at reverts — the invite is NOT burned.
  let newUser: typeof users.$inferSelect;
  try {
    newUser = await db.transaction(async (tx) => {
      // Step 6: Atomic claim — concurrent double-registration guard
      const claimed = execRows<{ id: string }>(
        await tx.execute(drizzleSql`
          UPDATE workspace_invites
          SET used_at = NOW()
          WHERE id = ${invite.id}
            AND used_at IS NULL
            AND revoked_at IS NULL
            AND expires_at > NOW()
          RETURNING id
        `)
      );
      if (claimed.length === 0) {
        throw new _ConcurrentClaimError();
      }

      // Step 7: Create user (UNIQUE on email — any race here rolls back step 6 too)
      const [u] = await tx
        .insert(users)
        .values({
          email: normalEmail,
          name: normalName,
          passwordHash,
          role: invite.role as "Admin" | "Analyst" | "Trader" | "Viewer",
          workspaceId: invite.workspaceId,
          isActive: true
        })
        .returning();

      if (!u) throw new Error("INSERT_RETURNED_EMPTY");

      // Step 8: Back-fill used_by now that we have the new user id
      await tx
        .update(workspaceInvites)
        .set({ usedBy: u.id })
        .where(eq(workspaceInvites.id, invite.id));

      return u;
    });
  } catch (err) {
    if (err instanceof _ConcurrentClaimError) {
      return { ok: false, error: "invalid_or_expired" };
    }
    // Postgres UNIQUE constraint violation (code 23505) — rare race on email
    const errCode = (err as { code?: string }).code;
    if (errCode === "23505") {
      return { ok: false, error: "email_already_registered" };
    }
    // Unexpected DB error — rethrow so the route handler can return 500
    throw err;
  }

  // 9. Fetch workspace for session (outside tx — read-only, no rollback needed)
  const [workspace] = await db
    .select({ id: workspaces.id, name: workspaces.name, slug: workspaces.slug })
    .from(workspaces)
    .where(eq(workspaces.id, invite.workspaceId))
    .limit(1);

  if (!workspace) {
    return { ok: false, error: "no_workspace" };
  }

  return {
    ok: true,
    user: {
      id: newUser.id,
      email: newUser.email,
      name: newUser.name,
      role: newUser.role as "Owner" | "Admin" | "Analyst" | "Trader" | "Viewer",
      workspaceId: newUser.workspaceId ?? null
    },
    workspace: { id: workspace.id, name: workspace.name, slug: workspace.slug }
  };
}

// ── Admin: list workspace users ────────────────────────────────────────────────
export type UserListRow = {
  id: string;
  email: string;
  name: string;
  role: string;
  isActive: boolean;
  createdAt: string;
};

export async function listWorkspaceUsers(workspaceId: string): Promise<UserListRow[]> {
  const db = requireDb();
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      isActive: users.isActive,
      createdAt: users.createdAt
    })
    .from(users)
    .where(eq(users.workspaceId, workspaceId))
    .orderBy(drizzleSql`${users.createdAt} DESC`);

  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    name: r.name,
    role: r.role,
    isActive: r.isActive,
    createdAt: r.createdAt.toISOString()
  }));
}

// ── Admin: change user role ────────────────────────────────────────────────────
// Returns false if user not found in workspace, or if attempting to promote to Owner,
// or if the requestor is trying to change their own role.
export async function changeUserRole(opts: {
  targetUserId: string;
  newRole: string;
  requestorId: string;
  workspaceId: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (!INVITE_ROLES.includes(opts.newRole as InviteRole)) {
    return { ok: false, error: "invalid_role" }; // cannot set Owner via this endpoint
  }
  if (opts.targetUserId === opts.requestorId) {
    return { ok: false, error: "cannot_change_own_role" };
  }

  const db = requireDb();
  const result = await db
    .update(users)
    .set({ role: opts.newRole as "Admin" | "Analyst" | "Trader" | "Viewer" })
    .where(
      and(
        eq(users.id, opts.targetUserId),
        eq(users.workspaceId, opts.workspaceId)
      )
    )
    .returning({ id: users.id });

  if (result.length === 0) {
    return { ok: false, error: "user_not_found" };
  }
  return { ok: true };
}

// ── Admin: deactivate user ─────────────────────────────────────────────────────
export async function deactivateUser(opts: {
  targetUserId: string;
  requestorId: string;
  workspaceId: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (opts.targetUserId === opts.requestorId) {
    return { ok: false, error: "cannot_deactivate_self" };
  }

  const db = requireDb();
  const result = await db
    .update(users)
    .set({ isActive: false })
    .where(
      and(
        eq(users.id, opts.targetUserId),
        eq(users.workspaceId, opts.workspaceId)
      )
    )
    .returning({ id: users.id });

  if (result.length === 0) {
    return { ok: false, error: "user_not_found" };
  }
  return { ok: true };
}
