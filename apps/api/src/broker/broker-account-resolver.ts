/**
 * broker-account-resolver.ts — account ID → brokerKind lookup
 *
 * Resolves the brokerKind ("kgi" | "paper") for a given accountId by querying
 * the broker_accounts table. Falls back to "paper" when:
 *   - DB is unavailable (non-database mode)
 *   - accountId is missing / empty
 *   - no matching row found
 *
 * This is the single source of truth for the accountId → brokerKind mapping
 * that feeds trading-service.ts's resolveBrokerKind().
 *
 * Phase constraints:
 *   - adapterKey "kgi" is allowed to route but callers MUST apply the
 *     SIM/prod_write_blocked guard before touching any KGI write path.
 *   - adapterKey "manual" (if registered) also maps to "paper" for order
 *     routing purposes (no live order path exists for manual).
 *
 * Lane: broker/ (Jason)
 */

import type { BrokerKind } from "@iuf-trading-room/contracts";
import { isDatabaseMode, getDb } from "@iuf-trading-room/db";
import { sql as drizzleSql } from "drizzle-orm";

/** Maps raw adapter_key strings from DB to our BrokerKind contract enum. */
export function adapterKeyToBrokerKind(adapterKey: string): BrokerKind {
  if (adapterKey === "kgi") return "kgi";
  // "paper" and anything unrecognised → paper (safe default)
  return "paper";
}

/**
 * Resolve the brokerKind for a given order accountId within a workspace.
 *
 * Lookup order:
 *   1. Query broker_accounts WHERE id = accountId AND workspace_id = workspaceId
 *      AND is_active = TRUE
 *   2. Map adapterKey → BrokerKind
 *   3. Default "paper" on any failure / not found
 *
 * Never throws — returns "paper" on any error so the paper path remains stable.
 */
export async function resolveBrokerKindForAccount(
  accountId: string | undefined | null,
  workspaceId: string | undefined | null
): Promise<BrokerKind> {
  if (!accountId || !workspaceId) return "paper";
  if (!isDatabaseMode()) return "paper";

  let db: ReturnType<typeof getDb> | null = null;
  try {
    db = getDb();
  } catch {
    return "paper";
  }
  if (!db) return "paper";

  try {
    // Use raw SQL to avoid importing brokerAccounts table at module level
    // (keeps the import footprint minimal and avoids circular dep risk)
    type Row = { adapter_key: string };
    const rows = await db.execute(drizzleSql<Row[]>`
      SELECT adapter_key
      FROM broker_accounts
      WHERE id = ${accountId}::uuid
        AND workspace_id = ${workspaceId}::uuid
        AND is_active = TRUE
      LIMIT 1
    `);

    // postgres.js returns raw array; execRows normalizer not available here
    // so handle both shapes: plain array or { rows: [...] }
    const rowsArray: unknown[] = Array.isArray(rows)
      ? rows
      : Array.isArray((rows as { rows?: unknown[] }).rows)
        ? (rows as { rows: unknown[] }).rows
        : [];

    const first = rowsArray[0] as Row | undefined;
    if (!first || typeof first.adapter_key !== "string") return "paper";
    return adapterKeyToBrokerKind(first.adapter_key);
  } catch {
    // DB query failure → safe default
    return "paper";
  }
}
