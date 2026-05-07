/**
 * /lab/strategies — 列出 IUF Quant Lab 釋出的 RESEARCH_ONLY 候選策略
 *
 * BLOCK #8 Lane D (2026-05-07).
 * Per Lab/TR Alignment Lock 2026-05-07:
 *   - read-only consume of GET /api/v1/lab/strategies
 *   - cookie forwarded via radarLabApi (PR #276 pattern)
 *   - all candidates marked RESEARCH_ONLY · awaiting Athena/Bruce gates
 *   - no Sharpe / equity / win-rate / allocation % displayed
 *   - blocked state when source=unavailable
 */

import { LabSubPageShell } from "@/components/LabSubPageShell";
import { friendlyDataError } from "@/lib/friendly-error";
import { radarLabApi, type LabStrategiesResponse } from "@/lib/radar-lab";

export const dynamic = "force-dynamic";

export default async function LabStrategiesPage() {
  let payload: LabStrategiesResponse | null = null;
  let fetchError: string | null = null;
  try {
    payload = await radarLabApi.strategies();
  } catch (error) {
    fetchError = friendlyDataError(error, "量化研究 /strategies API 暫時無法讀取。");
  }

  return <LabSubPageShell mode="strategies" payload={payload} fetchError={fetchError} />;
}
