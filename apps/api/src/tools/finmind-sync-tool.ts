/**
 * finmind-sync-tool.ts
 *
 * ToolCenter Phase B — finmind_sync tool wrap.
 * Wraps the FinMind trading-flow sync functions (institutional buysell + margin/short)
 * so each invocation gets a tool_calls audit record.
 *
 * Allowed datasets (whitelist — Brain ReAct must not trigger arbitrary FinMind datasets):
 *   - institutional_buysell  → runInstitutionalBuySellSync
 *   - margin_short           → runMarginShortSync
 *
 * callerType: "pipeline" | "admin_action" | "llm"
 */

import { callTool } from "./tool-registry-store.js";

export type FinMindSyncDataset = "institutional_buysell" | "margin_short";

export interface FinMindSyncInput {
  dataset: FinMindSyncDataset;
  tickers: Array<{ ticker: string }>;
  startDate?: string;
  endDate?: string;
}

export interface FinMindSyncOutput {
  dataset: string;
  skipped: boolean;
  skipReason: string | null;
  rowsUpserted: number;
  tickersAttempted: number;
  tickersSuccess: number;
  tickersFailed: number;
}

/**
 * triggerFinMindSyncTracked — callTool-wrapped FinMind incremental sync.
 * Supports "institutional_buysell" and "margin_short" datasets (whitelist).
 */
export async function triggerFinMindSyncTracked(
  input: FinMindSyncInput,
  workspaceId?: string | null,
  callerType: string = "admin_action"
): Promise<FinMindSyncOutput> {
  return callTool(
    "finmind_sync",
    callerType,
    workspaceId ?? null,
    input,
    async (i: FinMindSyncInput): Promise<FinMindSyncOutput> => {
      if (i.dataset === "institutional_buysell") {
        const { runInstitutionalBuySellSync } = await import(
          "../jobs/trading-flow-finmind-sync.js"
        );
        const result = await runInstitutionalBuySellSync(i.tickers, {
          startDate: i.startDate,
          endDate: i.endDate
        });
        return {
          dataset: i.dataset,
          skipped: result.skipped,
          skipReason: result.skipReason,
          rowsUpserted: result.rowsUpserted,
          tickersAttempted: result.tickersAttempted,
          tickersSuccess: result.tickersSuccess,
          tickersFailed: result.tickersFailed
        };
      }

      if (i.dataset === "margin_short") {
        const { runMarginShortSync } = await import(
          "../jobs/trading-flow-finmind-sync.js"
        );
        const result = await runMarginShortSync(i.tickers, {
          startDate: i.startDate,
          endDate: i.endDate
        });
        return {
          dataset: i.dataset,
          skipped: result.skipped,
          skipReason: result.skipReason,
          rowsUpserted: result.rowsUpserted,
          tickersAttempted: result.tickersAttempted,
          tickersSuccess: result.tickersSuccess,
          tickersFailed: result.tickersFailed
        };
      }

      // Exhaustive — should never reach here due to TS type narrowing
      const _never: never = i.dataset;
      throw new Error("[finmind-sync-tool] unknown dataset: " + String(_never));
    }
  );
}
