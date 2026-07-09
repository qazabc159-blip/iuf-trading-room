/**
 * broker-account-ownership.ts — G-SELF resource ownership check (PR-D, 2026-07-09)
 *
 * Design: reports/permission_matrix/PERMISSION_MATRIX_v1.md §2 D3 (G-SELF row)
 * and §4 (PR-D row). Central helper so every "self resource" endpoint that
 * takes a broker_accounts id (gateway pair-token issue, gateway revoke,
 * account disconnect) checks ownership the SAME way instead of re-deriving
 * the WHERE clause per handler — mirrors the D2 "central helper" pattern
 * already used for role checks (require-min-role.ts).
 *
 * Threat model: today there is a single workspace in prod, so this is inert
 * in practice — but Phase III opens multiple workspaces (separate customer
 * tenants), each with their own KGI/broker connections and gateway pairings.
 * An accountId is a plain path/body param; without this check, any
 * authenticated user in ANY workspace could pair/revoke/disconnect ANOTHER
 * workspace's broker connection just by guessing or enumerating its uuid.
 *
 * Least-disclosure: returns `null` whether the accountId doesn't exist at all
 * OR exists but belongs to a different workspace — callers must turn a null
 * into a flat 404 (`account_not_found`), never a 403, so the response can't be
 * used to distinguish "doesn't exist" from "not yours" (PERMISSION_MATRIX_v1.md
 * §4 PR-D: "非 owner → 403/404，洩漏最少原則，查不到就 404 不 403").
 */

import { execRows as dbExecRows } from "@iuf-trading-room/db";
import { sql as drizzleSql } from "drizzle-orm";

/** Minimal shape of the drizzle db handle this helper needs — matches
 *  `getDb()`'s return type without importing it (keeps this file mockable in
 *  unit tests with a plain `{ execute }` stub, no real Postgres required). */
export interface OwnershipDb {
  execute(query: unknown): Promise<unknown>;
}

/**
 * Looks up a `broker_accounts` row by id, scoped to `workspaceId`. Returns
 * the row's id if — and only if — it exists AND belongs to that workspace.
 */
export async function findOwnedBrokerAccount(
  db: OwnershipDb,
  accountId: string,
  workspaceId: string
): Promise<{ id: string } | null> {
  if (!accountId || !workspaceId) return null;
  const row = dbExecRows<{ id: string }>(
    await db.execute(drizzleSql`
      SELECT id FROM broker_accounts
      WHERE id = ${accountId} AND workspace_id = ${workspaceId}
      LIMIT 1
    `)
  )[0];
  return row ?? null;
}
