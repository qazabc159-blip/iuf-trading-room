// Central role-rank helper — permission matrix v1, PR-A (2026-07-04).
//
// Design: reports/permission_matrix/PERMISSION_MATRIX_v1.md §2 D1/D2.
// D1 strict ladder model: Viewer < Trader < Analyst < Admin < Owner. Higher
// ranks fully cover lower-rank capabilities — no cross-matrix exceptions
// (e.g. no "Trader with research access but no order rights"). If a real
// need for an exception ever appears, open a separate exception table
// instead of bending this ladder.
//
// PR-A scope: additive only. No existing inline `role !== "X"` / role-set
// check in server.ts is rewired to call this yet — that migration happens
// endpoint-group by endpoint-group in PR-B / PR-B2 / PR-C / PR-D, each with
// its own matrix-test rows. Importing this file has zero effect on any
// existing route until a follow-up PR calls it from a handler.

import type { AppSession } from "@iuf-trading-room/contracts";

/** Role name as carried on `AppSession.user.role` (see packages/contracts/src/workspace.ts). */
export type Role = AppSession["user"]["role"];

/**
 * Rank table for the D1 strict ladder. Higher number = more capability.
 * Keep in sync with `userRoleEnum` (packages/db/src/schema.ts) and
 * `sessionUserSchema` (packages/contracts/src/workspace.ts) — both currently
 * list the same five roles, this is just the ordering + numeric rank.
 */
export const ROLE_RANK: Record<Role, number> = {
  Viewer: 0,
  Trader: 1,
  Analyst: 2,
  Admin: 3,
  Owner: 4
};

/** Every role name, ordered lowest → highest rank. Handy for test matrices. */
export const ROLES_BY_RANK: readonly Role[] = (
  Object.keys(ROLE_RANK) as Role[]
).sort((a, b) => ROLE_RANK[a] - ROLE_RANK[b]);

/**
 * True when `session`'s role rank is >= `minRole`'s rank on the D1 ladder.
 *
 * Boolean-return (not throw) on purpose: every existing inline check in
 * server.ts is `if (!SOME_ROLES.has(role)) return c.json({ error: "forbidden_role" }, 403)`
 * — callers own the HTTP response. This helper is meant to be dropped in as
 * the condition of that same `if`, e.g.:
 *
 *   if (!requireMinRole(session, "Analyst")) {
 *     return c.json({ error: "forbidden_role" }, 403);
 *   }
 *
 * `session` accepts `null | undefined` defensively (some existing call
 * sites guard `!session` before the role check) and returns `false` in
 * that case, matching the existing `!session || role !== "X"` pattern.
 */
export function requireMinRole(
  session: Pick<AppSession, "user"> | null | undefined,
  minRole: Role
): boolean {
  if (!session) return false;
  return ROLE_RANK[session.user.role] >= ROLE_RANK[minRole];
}
