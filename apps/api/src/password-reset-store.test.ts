// password-reset-store.test.ts — 2026-07-16
//
// DB-mode regression lock for the admin-mediated "forgot password" flow
// (migration 0060). Exercises password-reset-store.ts functions directly
// against a real Postgres, same lane/pattern as
// domain/trading/paper-realized-pnl-db.test.ts: no HTTP server spawn here —
// the account-enumeration and session-invalidation HTTP-boundary behavior is
// covered separately in password-reset-flow.test.ts (spawns the real server).
//
// Wired into `pnpm run test:db` (package.json), not `pnpm test`.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after, before } from "node:test";

import { eq, sql as drizzleSql } from "drizzle-orm";
import { execRows, getDb, passwordResetTokens, users, workspaces } from "@iuf-trading-room/db";

import { hashPassword, verifyPassword } from "./auth-store.js";
import {
  generatePasswordResetLink,
  listPendingPasswordResetRequests,
  requestPasswordReset,
  resetPassword
} from "./password-reset-store.js";

let workspaceId = "";
const createdUserEmails: string[] = [];

async function makeUser(label: string): Promise<{ id: string; email: string }> {
  const db = getDb();
  assert.ok(db, "this suite requires PERSISTENCE_MODE=database with a live Postgres connection");
  const email = `password-reset-store-${label}-${randomUUID()}@test.iuf.local`;
  createdUserEmails.push(email);
  const passwordHash = await hashPassword("OriginalPassw0rd123!");
  const [row] = await db
    .insert(users)
    .values({ email, name: `Test ${label}`, passwordHash, role: "Viewer", workspaceId, isActive: true })
    .returning();
  if (!row) throw new Error("makeUser: INSERT returned no row");
  return { id: row.id, email: row.email };
}

before(async () => {
  const db = getDb();
  assert.ok(db, "this suite requires PERSISTENCE_MODE=database — run via `pnpm run test:db`");
  const [existing] = await db.select().from(workspaces).limit(1);
  if (existing) {
    workspaceId = existing.id;
  } else {
    const [created] = await db
      .insert(workspaces)
      .values({ name: "Password Reset Store Test", slug: `password-reset-store-${randomUUID()}` })
      .returning();
    workspaceId = created!.id;
  }
});

after(async () => {
  const db = getDb();
  if (!db) return;
  for (const email of createdUserEmails) {
    // password_reset_tokens rows CASCADE-delete with their user.
    await db.delete(users).where(eq(users.email, email)).catch(() => {});
  }
});

test("PRS-1: requestPasswordReset() for an existing active user inserts a pending row (token_hash NULL)", async () => {
  const db = getDb()!;
  const user = await makeUser("prs1");

  await requestPasswordReset(user.email);

  const rows = await db.select().from(passwordResetTokens).where(eq(passwordResetTokens.userId, user.id));
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.tokenHash, null);
  assert.equal(rows[0]!.usedAt, null);
  assert.equal(rows[0]!.revokedAt, null);
});

test("PRS-2: requestPasswordReset() for a non-existent email writes no row (anti-enumeration holds at the DB layer, not just the response)", async () => {
  const db = getDb()!;
  const bogusEmail = `password-reset-store-nonexistent-${randomUUID()}@test.iuf.local`;

  const countBefore = execRows<{ count: number }>(
    await db.execute(drizzleSql`SELECT COUNT(*)::int AS count FROM password_reset_tokens`)
  )[0]!.count;

  await requestPasswordReset(bogusEmail);

  const countAfter = execRows<{ count: number }>(
    await db.execute(drizzleSql`SELECT COUNT(*)::int AS count FROM password_reset_tokens`)
  )[0]!.count;

  assert.equal(countAfter, countBefore, "a request for an email with no matching user must not write any row");
});

test("PRS-3: a second requestPasswordReset() for the same user revokes the prior pending row and leaves exactly one active row", async () => {
  const db = getDb()!;
  const user = await makeUser("prs3");

  await requestPasswordReset(user.email);
  const [firstRow] = await db.select().from(passwordResetTokens).where(eq(passwordResetTokens.userId, user.id));
  assert.ok(firstRow);

  await requestPasswordReset(user.email);

  const rows = await db
    .select()
    .from(passwordResetTokens)
    .where(eq(passwordResetTokens.userId, user.id))
    .orderBy(drizzleSql`requested_at ASC`);

  assert.equal(rows.length, 2, "old row stays (revoked), new pending row added");
  assert.ok(rows[0]!.revokedAt !== null, "first row must be revoked (superseded)");
  assert.equal(rows[1]!.revokedAt, null, "second (newest) row must remain active/pending");
  assert.equal(rows[1]!.tokenHash, null);
});

test("PRS-4: generatePasswordResetLink() turns a pending row into an active one-time token and returns the plaintext once", async () => {
  const db = getDb()!;
  const admin = await makeUser("prs4-admin");
  const user = await makeUser("prs4-target");
  await requestPasswordReset(user.email);
  const [pending] = await db.select().from(passwordResetTokens).where(eq(passwordResetTokens.userId, user.id));
  assert.ok(pending);

  const result = await generatePasswordResetLink({
    requestId: pending!.id,
    workspaceId,
    generatedBy: admin.id
  });

  assert.ok(result, "generation must succeed for a valid pending request");
  assert.match(result!.token, /^[\w-]{20,}$/, "token must be a high-entropy url-safe string");
  assert.ok(result!.resetUrl.includes(encodeURIComponent(result!.token)));

  const [row] = await db.select().from(passwordResetTokens).where(eq(passwordResetTokens.id, pending!.id));
  assert.ok(row!.tokenHash, "token_hash must now be set");
  assert.notEqual(row!.tokenHash, result!.token, "DB must never store the plaintext token");
  assert.ok(row!.expiresAt, "expires_at must be set at generation time");
  assert.equal(row!.generatedBy, admin.id);
});

test("PRS-5: generatePasswordResetLink() rejects a request from a different workspace (no cross-tenant link minting)", async () => {
  const db = getDb()!;
  const admin = await makeUser("prs5-admin");
  const user = await makeUser("prs5-target");
  await requestPasswordReset(user.email);
  const [pending] = await db.select().from(passwordResetTokens).where(eq(passwordResetTokens.userId, user.id));

  const result = await generatePasswordResetLink({
    requestId: pending!.id,
    workspaceId: randomUUID(), // wrong workspace
    generatedBy: admin.id
  });

  assert.equal(result, null);
});

test("PRS-6: listPendingPasswordResetRequests() surfaces the pending row and excludes generated/revoked ones", async () => {
  const user = await makeUser("prs6");
  await requestPasswordReset(user.email);

  const before = await listPendingPasswordResetRequests(workspaceId);
  assert.ok(before.some((r) => r.email === user.email), "pending request must appear in the queue");

  const db = getDb()!;
  const [pending] = await db.select().from(passwordResetTokens).where(eq(passwordResetTokens.userId, user.id));
  const admin = await makeUser("prs6-admin");
  await generatePasswordResetLink({ requestId: pending!.id, workspaceId, generatedBy: admin.id });

  const after = await listPendingPasswordResetRequests(workspaceId);
  assert.ok(!after.some((r) => r.email === user.email), "once generated, request must leave the pending queue");
});

test("PRS-7: resetPassword() with a valid token updates the password hash and bumps session_epoch (invalidates old sessions)", async () => {
  const db = getDb()!;
  const admin = await makeUser("prs7-admin");
  const user = await makeUser("prs7-target");
  await requestPasswordReset(user.email);
  const [pending] = await db.select().from(passwordResetTokens).where(eq(passwordResetTokens.userId, user.id));
  const link = await generatePasswordResetLink({ requestId: pending!.id, workspaceId, generatedBy: admin.id });

  const [before] = await db.select().from(users).where(eq(users.id, user.id));
  assert.equal(before!.sessionEpoch, 0);

  const result = await resetPassword({ token: link!.token, newPassword: "BrandNewPassw0rd456!" });
  assert.deepEqual(result, { ok: true });

  const [after] = await db.select().from(users).where(eq(users.id, user.id));
  assert.equal(after!.sessionEpoch, 1, "session_epoch must be bumped exactly once");
  assert.ok(await verifyPassword("BrandNewPassw0rd456!", after!.passwordHash!), "new password must actually verify");
  assert.equal(await verifyPassword("OriginalPassw0rd123!", after!.passwordHash!), false, "old password must no longer verify");

  const [tokenRow] = await db.select().from(passwordResetTokens).where(eq(passwordResetTokens.id, pending!.id));
  assert.ok(tokenRow!.usedAt !== null, "token must be marked used");
});

test("PRS-8: resetPassword() rejects a token twice (used-once) with invalid_or_expired both times distinguishable only by first success", async () => {
  const db = getDb()!;
  const admin = await makeUser("prs8-admin");
  const user = await makeUser("prs8-target");
  await requestPasswordReset(user.email);
  const [pending] = await db.select().from(passwordResetTokens).where(eq(passwordResetTokens.userId, user.id));
  const link = await generatePasswordResetLink({ requestId: pending!.id, workspaceId, generatedBy: admin.id });

  const first = await resetPassword({ token: link!.token, newPassword: "FirstUsePassw0rd789!" });
  assert.deepEqual(first, { ok: true });

  const second = await resetPassword({ token: link!.token, newPassword: "SecondUsePassw0rd999!" });
  assert.deepEqual(second, { ok: false, error: "invalid_or_expired" });

  const [after] = await db.select().from(users).where(eq(users.id, user.id));
  assert.equal(after!.sessionEpoch, 1, "second (rejected) attempt must not bump session_epoch again");
});

test("PRS-9: resetPassword() rejects an expired token", async () => {
  const db = getDb()!;
  const admin = await makeUser("prs9-admin");
  const user = await makeUser("prs9-target");
  await requestPasswordReset(user.email);
  const [pending] = await db.select().from(passwordResetTokens).where(eq(passwordResetTokens.userId, user.id));
  const link = await generatePasswordResetLink({ requestId: pending!.id, workspaceId, generatedBy: admin.id });

  // Force the row into the past — simulates TTL elapsed without waiting an hour.
  await db
    .update(passwordResetTokens)
    .set({ expiresAt: new Date(Date.now() - 60_000) })
    .where(eq(passwordResetTokens.id, pending!.id));

  const result = await resetPassword({ token: link!.token, newPassword: "TooLatePassw0rd111!" });
  assert.deepEqual(result, { ok: false, error: "invalid_or_expired" });
});

test("PRS-10: resetPassword() rejects a weak new password without consuming the token", async () => {
  const db = getDb()!;
  const admin = await makeUser("prs10-admin");
  const user = await makeUser("prs10-target");
  await requestPasswordReset(user.email);
  const [pending] = await db.select().from(passwordResetTokens).where(eq(passwordResetTokens.userId, user.id));
  const link = await generatePasswordResetLink({ requestId: pending!.id, workspaceId, generatedBy: admin.id });

  const result = await resetPassword({ token: link!.token, newPassword: "short1A" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, "password_too_short");

  // Token must still be usable — a rejected policy check is not a "use".
  const [tokenRow] = await db.select().from(passwordResetTokens).where(eq(passwordResetTokens.id, pending!.id));
  assert.equal(tokenRow!.usedAt, null);

  const retry = await resetPassword({ token: link!.token, newPassword: "NowStrongPassw0rd222!" });
  assert.deepEqual(retry, { ok: true });
});

test("PRS-11: resetPassword() rejects a token that was superseded (revoked) by a newer request before it was ever generated", async () => {
  const db = getDb()!;
  const admin = await makeUser("prs11-admin");
  const user = await makeUser("prs11-target");
  await requestPasswordReset(user.email);
  const [firstPending] = await db.select().from(passwordResetTokens).where(eq(passwordResetTokens.userId, user.id));
  const link = await generatePasswordResetLink({ requestId: firstPending!.id, workspaceId, generatedBy: admin.id });

  // User asks again before ever using the first link — must revoke the first (already-generated) row too.
  await requestPasswordReset(user.email);

  const result = await resetPassword({ token: link!.token, newPassword: "StaleLinkPassw0rd333!" });
  assert.deepEqual(result, { ok: false, error: "invalid_or_expired" });
});
