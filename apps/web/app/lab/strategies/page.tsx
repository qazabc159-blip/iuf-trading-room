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
 *
 * 2026-05-09: added three-strategy truth board banner linking to /lab/three-strategy
 */

import Link from "next/link";
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
    fetchError = friendlyDataError(error, "候選策略暫時無法讀取。");
  }

  return (
    <>
      {/* Three-strategy truth board banner — Athena truth board v1, 2026-05-08 */}
      <div
        style={{
          margin: "0 0 16px 0",
          padding: "12px 18px",
          border: "1px solid rgba(255, 184, 0, 0.45)",
          borderLeft: "3px solid #ffb800",
          background: "rgba(255, 184, 0, 0.04)",
          borderRadius: 4,
          display: "flex",
          alignItems: "center",
          gap: 14,
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: "1 1 auto" }}>
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: "#ffb800",
              letterSpacing: 0.5,
              marginBottom: 4,
            }}
          >
            三條策略真實治理狀態已上線（Athena truth board v1, 2026-05-08）
          </div>
          <div style={{ fontSize: 12, color: "#bbb", lineHeight: 1.5 }}>
            cont_liq 🟡 觀察中 · rs_20_60 ⚪ 研究阻塞 · MAIN 🔴 研究關閉 — caveat 全文顯示，不截斷。
          </div>
        </div>
        <Link
          href="/lab/three-strategy"
          style={{
            display: "inline-block",
            padding: "6px 14px",
            border: "1px solid rgba(255, 184, 0, 0.5)",
            borderRadius: 4,
            fontSize: 12,
            color: "#ffb800",
            textDecoration: "none",
            whiteSpace: "nowrap",
            background: "rgba(255,184,0,0.06)",
          }}
        >
          查看三策略狀態 →
        </Link>
      </div>
      <LabSubPageShell mode="strategies" payload={payload} fetchError={fetchError} />
    </>
  );
}
