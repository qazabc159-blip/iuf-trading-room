/**
 * /lab/candidates — Lab 研究候選名單（與 /lab/strategies 同來源；未來可分流）
 *
 * BLOCK #8 Lane D (2026-05-07).
 * Per Lab/TR Alignment Lock 2026-05-07:
 *   - read-only consume of GET /api/v1/lab/strategies
 *   - alias view emphasising review pipeline / awaiting gates
 *   - no Sharpe / equity / win-rate / allocation % displayed
 */

import { LabSubPageShell } from "@/components/LabSubPageShell";
import { friendlyDataError } from "@/lib/friendly-error";
import { radarLabApi, type LabStrategiesResponse } from "@/lib/radar-lab";

export const dynamic = "force-dynamic";

export default async function LabCandidatesPage() {
  let payload: LabStrategiesResponse | null = null;
  let fetchError: string | null = null;
  try {
    payload = await radarLabApi.strategies();
  } catch (error) {
    fetchError = friendlyDataError(error, "量化研究 /candidates API 暫時無法讀取。");
  }

  return <LabSubPageShell mode="candidates" payload={payload} fetchError={fetchError} />;
}
