/**
 * password-reset-store.ts — admin-mediated "forgot password" flow
 *
 * This app has no mailer capable of sending to an arbitrary end-user address
 * (see openalice-email-digest.ts: Resend REST, but hard-coded to a single
 * fixed internal DIGEST_EMAIL — not a general per-user transactional
 * channel). Registration already solves an equivalent problem the same way
 * (workspace_invites: admin creates a one-time link, hands it to the user
 * out of band). Password reset follows the identical pattern:
 *
 *   1. requestPasswordReset(email) — user self-submits; if the email matches
 *      an active user, a pending row is inserted (token_hash = NULL). Any
 *      prior pending/active row for that user is revoked (superseded).
 *      Always resolves the same way regardless of whether the email matched
 *      a real user — callers must not branch on the return value to decide
 *      what to tell the requester (that would defeat the anti-enumeration
 *      guarantee the HTTP layer promises).
 *   2. generatePasswordResetLink(requestId, adminId) — Owner/Admin action.
 *      Fills in token_hash/expires_at/generated_by/generated_at on the
 *      pending row and returns the plaintext token ONCE. Never stored.
 *   3. resetPassword(token, newPassword) — public. Atomic claim (same
 *      concurrent-double-use guard as workspace_invites), password policy
 *      check, hash + persist, bump users.session_epoch to invalidate every
 *      previously-issued session cookie for that user.
 *
 * All invalid/expired/used/revoked token states in resetPassword() return the
 * same "invalid_or_expired" code (oracle prevention), matching invite-store.ts.
 */

import { createHash, randomBytes } from "node:crypto";

import { eq, and, sql as drizzleSql } from "drizzle-orm";

import { execRows, getDb, passwordResetTokens, users } from "@iuf-trading-room/db";

import { hashPassword, validateNewPassword } from "./auth-store.js";

// ── constants ──────────────────────────────────────────────────────────────────
const RESET_URL_BASE = "https://app.eycvector.com/reset-password";
const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour, starting at generation time (not request time)

function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function requireDb() {
  const db = getDb();
  if (!db) throw new Error("password-reset-store requires PERSISTENCE_MODE=database");
  return db;
}

// ── requestPasswordReset ──────────────────────────────────────────────────────
// Always resolves the same way for existing vs non-existent email — the
// caller (POST /api/v1/auth/request-password-reset) must return an identical
// generic response either way. No row is written for an email that doesn't
// match an active user (nothing to queue, and it avoids storing junk rows for
// typos / probing — this app's login already accepts the same asymmetry, see
// auth-store.ts loginWithPassword's early return on missing user).
export async function requestPasswordReset(email: string): Promise<void> {
  const db = requireDb();
  const normalEmail = email.toLowerCase().trim();

  const [user] = await db
    .select({ id: users.id, isActive: users.isActive })
    .from(users)
    .where(eq(users.email, normalEmail))
    .limit(1);

  if (!user || user.isActive === false) return;

  // Supersede any prior pending/active (not yet used, not yet revoked) row
  // for this user — only the newest request can ever be resolved.
  await db
    .update(passwordResetTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(passwordResetTokens.userId, user.id),
        drizzleSql`${passwordResetTokens.usedAt} IS NULL`,
        drizzleSql`${passwordResetTokens.revokedAt} IS NULL`
      )
    );

  await db.insert(passwordResetTokens).values({ userId: user.id });
}

// ── admin queue ────────────────────────────────────────────────────────────────
export type PendingResetRequestRow = {
  id: string;
  userId: string;
  email: string;
  name: string;
  requestedAt: string;
};

// Pending = self-submitted, not yet generated (token_hash NULL), not revoked
// by a newer request. Scoped to the admin's own workspace via the users join.
export async function listPendingPasswordResetRequests(
  workspaceId: string
): Promise<PendingResetRequestRow[]> {
  const db = requireDb();
  const rows = await db
    .select({
      id: passwordResetTokens.id,
      userId: passwordResetTokens.userId,
      email: users.email,
      name: users.name,
      requestedAt: passwordResetTokens.requestedAt
    })
    .from(passwordResetTokens)
    .innerJoin(users, eq(passwordResetTokens.userId, users.id))
    .where(
      and(
        eq(users.workspaceId, workspaceId),
        drizzleSql`${passwordResetTokens.tokenHash} IS NULL`,
        drizzleSql`${passwordResetTokens.revokedAt} IS NULL`
      )
    )
    .orderBy(drizzleSql`${passwordResetTokens.requestedAt} DESC`);

  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    email: r.email,
    name: r.name,
    requestedAt: r.requestedAt.toISOString()
  }));
}

// ── generatePasswordResetLink ────────────────────────────────────────────────
// Owner/Admin action. Turns a pending row into an active one-time token.
// Returns null if the request doesn't exist, isn't in the caller's
// workspace, or has already been generated/used/revoked (no oracle concern
// here — caller is an authenticated admin, not an anonymous requester).
export async function generatePasswordResetLink(opts: {
  requestId: string;
  workspaceId: string;
  generatedBy: string;
}): Promise<{ token: string; resetUrl: string; expiresAt: string } | null> {
  const db = requireDb();

  const [pending] = await db
    .select({
      id: passwordResetTokens.id,
      userId: passwordResetTokens.userId,
      workspaceId: users.workspaceId
    })
    .from(passwordResetTokens)
    .innerJoin(users, eq(passwordResetTokens.userId, users.id))
    .where(
      and(
        eq(passwordResetTokens.id, opts.requestId),
        drizzleSql`${passwordResetTokens.tokenHash} IS NULL`,
        drizzleSql`${passwordResetTokens.revokedAt} IS NULL`
      )
    )
    .limit(1);

  if (!pending || pending.workspaceId !== opts.workspaceId) return null;

  const token = generateToken();
  const tokenHash = hashToken(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + TOKEN_TTL_MS);

  // Drizzle's update-builder (not a raw SQL template) — matches
  // invite-store.ts revokeWorkspaceInvite's shape and avoids postgres-js
  // rejecting Date values passed as raw `sql` template parameters.
  const claimed = await db
    .update(passwordResetTokens)
    .set({
      tokenHash,
      generatedAt: now,
      generatedBy: opts.generatedBy,
      expiresAt
    })
    .where(
      and(
        eq(passwordResetTokens.id, pending.id),
        drizzleSql`${passwordResetTokens.tokenHash} IS NULL`,
        drizzleSql`${passwordResetTokens.revokedAt} IS NULL`
      )
    )
    .returning({ id: passwordResetTokens.id });

  if (claimed.length === 0) return null; // lost a race with another admin action

  return {
    token,
    resetUrl: `${RESET_URL_BASE}?token=${encodeURIComponent(token)}`,
    expiresAt: expiresAt.toISOString()
  };
}

// ── resetPassword ────────────────────────────────────────────────────────────
export type ResetPasswordResult =
  | { ok: true }
  | { ok: false; error: string };

class _ConcurrentClaimError extends Error {
  constructor() { super("CONCURRENT_CLAIM_LOST"); this.name = "_ConcurrentClaimError"; }
}

export async function resetPassword(opts: {
  token: string;
  newPassword: string;
}): Promise<ResetPasswordResult> {
  const db = requireDb();
  const tokenHash = hashToken(opts.token);

  const [row] = await db
    .select({
      id: passwordResetTokens.id,
      userId: passwordResetTokens.userId,
      usedAt: passwordResetTokens.usedAt,
      revokedAt: passwordResetTokens.revokedAt,
      expiresAt: passwordResetTokens.expiresAt
    })
    .from(passwordResetTokens)
    .where(eq(passwordResetTokens.tokenHash, tokenHash))
    .limit(1);

  // All invalid states -> same error (no token-existence oracle)
  if (!row) return { ok: false, error: "invalid_or_expired" };
  if (row.usedAt !== null) return { ok: false, error: "invalid_or_expired" };
  if (row.revokedAt !== null) return { ok: false, error: "invalid_or_expired" };
  if (!row.expiresAt || row.expiresAt <= new Date()) return { ok: false, error: "invalid_or_expired" };

  const passwordError = validateNewPassword(opts.newPassword);
  if (passwordError) return { ok: false, error: passwordError };

  const newHash = await hashPassword(opts.newPassword);

  try {
    await db.transaction(async (tx) => {
      // Atomic claim — concurrent double-submit guard, same shape as
      // invite-store.ts's workspace_invites claim.
      const claimed = execRows<{ id: string }>(
        await tx.execute(drizzleSql`
          UPDATE password_reset_tokens
          SET used_at = NOW()
          WHERE id = ${row.id}
            AND used_at IS NULL
            AND revoked_at IS NULL
            AND expires_at > NOW()
          RETURNING id
        `)
      );
      if (claimed.length === 0) {
        throw new _ConcurrentClaimError();
      }

      await tx.update(users).set({ passwordHash: newHash }).where(eq(users.id, row.userId));

      // Invalidate every session cookie issued for this user before now.
      await tx.execute(drizzleSql`
        UPDATE users SET session_epoch = session_epoch + 1 WHERE id = ${row.userId}
      `);
    });
  } catch (err) {
    if (err instanceof _ConcurrentClaimError) {
      return { ok: false, error: "invalid_or_expired" };
    }
    throw err;
  }

  return { ok: true };
}
