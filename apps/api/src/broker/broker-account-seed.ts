/**
 * broker-account-seed.ts — default broker_accounts seeding
 *
 * Unified order flow PR-2 (D6): every workspace needs a baseline "paper" and
 * "kgi" broker_accounts row before GET /uta/accounts has anything to return
 * (empty list = nothing for the account picker to select). This is a lean
 * idempotent upsert, not a broker adapter integration — no credentials, no
 * live-order behavior. See
 * reports/epic_trading_desk_20260702/S1_UNIFIED_ORDER_FLOW_DESIGN_v1.md D6.
 *
 * account_ref is a fixed constant per adapter ("default" / "sim") because
 * Phase A only supports a single account per adapter per workspace (see
 * broker-account-resolver.ts). Real per-user KGI account_ref binding is a
 * later phase, unrelated to this seed (this just guarantees a routable row
 * exists so the picker + trading-service.ts resolution never sees a gap).
 *
 * Idempotent via ON CONFLICT (workspace_id, adapter_key, account_ref) DO
 * NOTHING — safe to call on every GET /uta/accounts request; a no-op after
 * the first successful insert for a workspace.
 *
 * Lane: broker/ (Jason) — cross-lane approval granted 2026-07-04 for the
 * unified-order-flow PR-2 slice (see S1_UNIFIED_ORDER_FLOW_DESIGN_v1.md §4).
 */

import { isDatabaseMode, getDb } from "@iuf-trading-room/db";
import { sql as drizzleSql } from "drizzle-orm";

export const DEFAULT_PAPER_ACCOUNT_REF = "default";
export const DEFAULT_KGI_SIM_ACCOUNT_REF = "sim";

/**
 * Ensures workspaceId has at least one active "paper" and one active "kgi"
 * broker_accounts row. No-ops in non-database mode (matches the rest of the
 * uta/* handlers' graceful-degrade convention) and never throws — a seed
 * failure should not block the accounts list from rendering whatever rows
 * already exist.
 */
export async function ensureDefaultBrokerAccounts(workspaceId: string): Promise<void> {
  if (!workspaceId) return;
  if (!isDatabaseMode()) return;

  let db: ReturnType<typeof getDb> | null = null;
  try {
    db = getDb();
  } catch {
    return;
  }
  if (!db) return;

  try {
    await db.execute(drizzleSql`
      INSERT INTO broker_accounts (workspace_id, adapter_key, account_ref, account_label, is_primary, is_active)
      VALUES
        (${workspaceId}::uuid, 'paper', ${DEFAULT_PAPER_ACCOUNT_REF}, 'Paper Trading', TRUE, TRUE),
        (${workspaceId}::uuid, 'kgi',   ${DEFAULT_KGI_SIM_ACCOUNT_REF}, 'KGI SIM', FALSE, TRUE)
      ON CONFLICT (workspace_id, adapter_key, account_ref) DO NOTHING
    `);
  } catch {
    // Seed is best-effort; GET /uta/accounts still renders whatever rows exist.
  }
}
