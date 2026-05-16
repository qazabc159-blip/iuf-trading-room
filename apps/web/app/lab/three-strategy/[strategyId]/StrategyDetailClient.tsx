"use client";

/**
 * StrategyDetailClient — strategy detail panel
 *
 * Sections:
 *   1. Strategy spec (intro / signal logic / sizing / exit)
 *   2. 8 caveat verdict table (source: athena_lane_e_8_caveat_sweep)
 *   3. Governance stage panel (Owner role only)
 *      - 3-segment: OFF / SIM / candidate
 *      - Candidate stays frontend-disabled while broker-write contract is closed
 *      - Amount input (TWD, integer)
 *   4. SIM observation audit panel (visible after SIM selected)
 *
 * HARD LINES enforced here:
 *   - Not displaying "已驗證" / "approved" / "可上線" / "strategy approved"
 *   - Not truncating caveat
 *   - Owner role only for toggle (checked via apiGetMe)
 *   - No KGI live broker write controls exposed
 *   - No mock quote / no fake metrics
 */

import { useState, useEffect, useRef, useCallback } from "react";
import type { StrategyDetailData, CaveatEntry } from "./page";
import { apiGetMe } from "@/lib/auth-client";
import { StrategyChartPanel } from "./StrategyChartPanel";
import type { LabStrategySnapshot } from "@/lib/api";

// ── Embedded snapshot — cont_liq_v36 (Athena snapshot_v0, 2026-05-09) ─────────
// Jason per-strategy endpoint (/api/v1/lab/strategy/:strategyId/snapshot) is now
// shipped on this branch (commit 85a1132). Frontend uses embedded fallback data
// until LAB_SNAPSHOT_BASE_URL is confirmed live in production environment.
const CONT_LIQ_V36_SNAPSHOT: LabStrategySnapshot = {
  schema: "lab_tr_strategy_snapshot_v0",
  strategyId: "cont_liq_v36",
  displayName: "Continuous Liquidity Relative Strength",
  displayName_zh: "\u6301\u7e8c\u6d41\u52d5\u6027 + \u76f8\u5c0d\u5f37\u5f31",
  status: "RESEARCH_FORWARD_OBSERVATION",
  displayMode: "research_only",
  orderState: "blocked",
  brokerWriteAllowed: false,
  realOrderAllowed: false,
  registryChangeAllowed: false,
  headlineMetrics: {
    strategyNetAbsoluteReturnPct: 400.89,
    benchmark0050ReturnPct: 95.25,
    excessVs0050Pp: 305.64,
    hitRatePct: 0.9231,
    maxDrawdownNetPct: -0.1051,
    maxDrawdownInternalExcessPct: -0.0737,
    estimatedEntryTicketCount: 4,
    // v47 explicit strategy / benchmark / excess fields only.
    sharpeAnnualized: 3.027, sortinoAnnualized: 3.912,
    maxDrawdown: -0.1051, maxDrawdownDate: "2025-05-29",
    winRate: 0.8462, hitRate: 0.9231, averageHoldingDays: 20,
    robustness: {
      horizonSweep: "NEAR_PASS_v37", regimeBandSweep: "FULL_PASS_v38",
      costStressSweep: "PASS_AT_60_120_BPS_v39", universeShrinkage: "PARTIAL_K_GE_50_REQUIRED_v40",
    },
  },
  equityCurve: { points: [
    { date: "2024-05-30", cumReturn: 0.0138, drawdown: 0.0 },
    { date: "2024-06-28", cumReturn: 0.2504, drawdown: 0.0 },
    { date: "2025-05-29", cumReturn: 0.119, drawdown: -0.1051 },
    { date: "2025-06-27", cumReturn: 0.2547, drawdown: 0.0 },
    { date: "2025-07-25", cumReturn: 0.6097, drawdown: 0.0 },
    { date: "2025-08-22", cumReturn: 0.491, drawdown: -0.0737 },
    { date: "2025-09-19", cumReturn: 0.8008, drawdown: 0.0 },
    { date: "2025-10-22", cumReturn: 0.967, drawdown: 0.0 },
    { date: "2025-11-20", cumReturn: 0.968, drawdown: 0.0 },
    { date: "2025-12-18", cumReturn: 1.143, drawdown: 0.0 },
    { date: "2026-01-19", cumReturn: 1.3663, drawdown: 0.0 },
    { date: "2026-02-25", cumReturn: 1.8553, drawdown: 0.0 },
    { date: "2026-03-26", cumReturn: 2.2202, drawdown: 0.0 },
  ]},
  monthlyReturns: { bars: [
    { yearMonth: "2024-05", monthReturn: 0.0138, tradeCount: 1 },
    { yearMonth: "2024-06", monthReturn: 0.2333, tradeCount: 1 },
    { yearMonth: "2025-05", monthReturn: -0.1051, tradeCount: 1 },
    { yearMonth: "2025-06", monthReturn: 0.1213, tradeCount: 1 },
    { yearMonth: "2025-07", monthReturn: 0.2829, tradeCount: 1 },
    { yearMonth: "2025-08", monthReturn: -0.0737, tradeCount: 1 },
    { yearMonth: "2025-09", monthReturn: 0.2078, tradeCount: 1 },
    { yearMonth: "2025-10", monthReturn: 0.0923, tradeCount: 1 },
    { yearMonth: "2025-11", monthReturn: 0.0005, tradeCount: 1 },
    { yearMonth: "2025-12", monthReturn: 0.0889, tradeCount: 1 },
    { yearMonth: "2026-01", monthReturn: 0.1042, tradeCount: 1 },
    { yearMonth: "2026-02", monthReturn: 0.2067, tradeCount: 1 },
    { yearMonth: "2026-03", monthReturn: 0.1278, tradeCount: 1 },
  ]},
  drawdownSeries: { points: [
    { date: "2024-05-30", drawdown: 0.0, underwaterDays: 0 },
    { date: "2024-06-28", drawdown: 0.0, underwaterDays: 0 },
    { date: "2025-05-29", drawdown: -0.1051, underwaterDays: 0 },
    { date: "2025-06-27", drawdown: 0.0, underwaterDays: 0 },
    { date: "2025-07-25", drawdown: 0.0, underwaterDays: 0 },
    { date: "2025-08-22", drawdown: -0.0737, underwaterDays: 0 },
    { date: "2025-09-19", drawdown: 0.0, underwaterDays: 0 },
    { date: "2025-10-22", drawdown: 0.0, underwaterDays: 0 },
    { date: "2025-11-20", drawdown: 0.0, underwaterDays: 0 },
    { date: "2025-12-18", drawdown: 0.0, underwaterDays: 0 },
    { date: "2026-01-19", drawdown: 0.0, underwaterDays: 0 },
    { date: "2026-02-25", drawdown: 0.0, underwaterDays: 0 },
    { date: "2026-03-26", drawdown: 0.0, underwaterDays: 0 },
  ]},
  sampleTrades: { entries: [
    { rebalanceDate: "2025-08-22", exitDateApprox: "2025-08-22", holdingDays: 20, holdingCount: 4, turnover: 1.0, grossReturn: 0.0373, netReturn120bps: 0.0253, benchmarkReturn: 0.0991, excessReturn120bps: -0.0737, rationale: "Top-N by score", source: "mock_for_demo", uiLabel_zh: "\u793a\u7bc4\u4ea4\u6613\uff08\u975e\u771f\u5be6\u6210\u4ea4\uff09" },
    { rebalanceDate: "2025-09-19", exitDateApprox: "2025-09-19", holdingDays: 20, holdingCount: 4, turnover: 1.0, grossReturn: 0.2655, netReturn120bps: 0.2535, benchmarkReturn: 0.0457, excessReturn120bps: 0.2078, rationale: "Top-N by score", source: "mock_for_demo", uiLabel_zh: "\u793a\u7bc4\u4ea4\u6613\uff08\u975e\u771f\u5be6\u6210\u4ea4\uff09" },
    { rebalanceDate: "2025-10-22", exitDateApprox: "2025-10-22", holdingDays: 20, holdingCount: 4, turnover: 0.75, grossReturn: 0.1447, netReturn120bps: 0.1357, benchmarkReturn: 0.0434, excessReturn120bps: 0.0923, rationale: "Top-N by score", source: "mock_for_demo", uiLabel_zh: "\u793a\u7bc4\u4ea4\u6613\uff08\u975e\u771f\u5be6\u6210\u4ea4\uff09" },
    { rebalanceDate: "2025-11-20", exitDateApprox: "2025-11-20", holdingDays: 20, holdingCount: 4, turnover: 1.0, grossReturn: 0.0401, netReturn120bps: 0.0281, benchmarkReturn: 0.0275, excessReturn120bps: 0.0005, rationale: "Top-N by score", source: "mock_for_demo", uiLabel_zh: "\u793a\u7bc4\u4ea4\u6613\uff08\u975e\u771f\u5be6\u6210\u4ea4\uff09" },
    { rebalanceDate: "2025-12-18", exitDateApprox: "2025-12-18", holdingDays: 20, holdingCount: 4, turnover: 1.0, grossReturn: 0.3667, netReturn120bps: 0.3547, benchmarkReturn: 0.2658, excessReturn120bps: 0.0889, rationale: "Top-N by score", source: "mock_for_demo", uiLabel_zh: "\u793a\u7bc4\u4ea4\u6613\uff08\u975e\u771f\u5be6\u6210\u4ea4\uff09" },
    { rebalanceDate: "2026-01-19", exitDateApprox: "2026-01-19", holdingDays: 20, holdingCount: 4, turnover: 0.75, grossReturn: 0.2672, netReturn120bps: 0.2582, benchmarkReturn: 0.154, excessReturn120bps: 0.1042, rationale: "Top-N by score", source: "mock_for_demo", uiLabel_zh: "\u793a\u7bc4\u4ea4\u6613\uff08\u975e\u771f\u5be6\u6210\u4ea4\uff09" },
    { rebalanceDate: "2026-02-25", exitDateApprox: "2026-02-25", holdingDays: 20, holdingCount: 4, turnover: 0.75, grossReturn: 0.2285, netReturn120bps: 0.2195, benchmarkReturn: 0.0128, excessReturn120bps: 0.2067, rationale: "Top-N by score", source: "mock_for_demo", uiLabel_zh: "\u793a\u7bc4\u4ea4\u6613\uff08\u975e\u771f\u5be6\u6210\u4ea4\uff09" },
    { rebalanceDate: "2026-03-26", exitDateApprox: "2026-03-26", holdingDays: 20, holdingCount: 4, turnover: 0.75, grossReturn: 0.3139, netReturn120bps: 0.3049, benchmarkReturn: 0.1772, excessReturn120bps: 0.1278, rationale: "Top-N by score", source: "mock_for_demo", uiLabel_zh: "\u793a\u7bc4\u4ea4\u6613\uff08\u975e\u771f\u5be6\u6210\u4ea4\uff09" },
  ]},
  spec: {
    capacityCaveat: "Requires liquid pool >= 50 names by 20d dollar volume; alpha degrades sharply below K=40 (v40 evidence).",
    commonWindowStart: "2025-04-10",  // v47 canonical common-window
    commonWindowEnd: "2026-03-06",  // v47 canonical common-window
  },
  uiCopyHints: {
    warningBanner_zh: "策略需 ≥50 檔流動性 universe；資金過度集中於 <40 檔時 alpha 失效",
    commonWindowCaveat_zh: "基準為 0050，common-window：2025-04-10 → 2026-03-06（11 個月）。三大策略共用同一時間窗口比較基準。0050 同窗 +95.25%（Codex v47 Athena Codex v46 confirmed）。",
  },
};
const STAGE2_SNAPSHOTS: Record<string, LabStrategySnapshot> = {
  // Long canonical ID
  "cont_liquidity_relative_strength__h20__top5__turnover_cap_0.25": CONT_LIQ_V36_SNAPSHOT,
  // Athena canonical short ID
  cont_liq_v36: CONT_LIQ_V36_SNAPSHOT,
  // Legacy short alias
  cont_liq_h20_top3_market_trail20_gt_5pct: CONT_LIQ_V36_SNAPSHOT,
  // strategy_002 and strategy_003 have no chart snapshot yet (BACKTESTED_RAW, Task #400 pending)
  // They will be added when Athena ships snapshot schema for these strategies
};


// ── Types ──────────────────────────────────────────────────────────────────────

type ToggleMode = "OFF" | "PAPER" | "LIVE";

type ToggleApiState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; mode: ToggleMode }
  | { status: "error"; message: string };

function modeDisplayLabel(mode: ToggleMode) {
  if (mode === "PAPER") return "SIM 觀察";
  if (mode === "LIVE") return "上線候選（券商寫入關閉）";
  return "研究關閉";
}

// ── Strategy mode call ─────────────────────────────────────────────────────────

const API_BASE =
  (process.env.NEXT_PUBLIC_API_BASE_URL as string | undefined) ??
  (typeof window !== "undefined" && window.location.port === "3000"
    ? "http://localhost:3001"
    : "");

async function postStrategyToggle(
  strategyId: string,
  mode: ToggleMode,
  capitalTwd: number | null,
  yangExplicitAck?: boolean,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${API_BASE}/api/v1/strategy/${encodeURIComponent(strategyId)}/toggle-mode`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode,
        capital_twd: capitalTwd ?? 0,
        yang_explicit_ack: yangExplicitAck ?? false,
      }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: body.error ?? `server_error_${res.status}` };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "network_error" };
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function CaveatIcon({ icon }: { icon: CaveatEntry["icon"] }) {
  if (icon === "pass") return <span style={{ color: "#2ecc71", fontSize: 14, marginRight: 6 }}>✓</span>;
  if (icon === "warn") return <span style={{ color: "#ffb800", fontSize: 14, marginRight: 6 }}>⚠</span>;
  return <span style={{ color: "#e05050", fontSize: 14, marginRight: 6 }}>✗</span>;
}

function SectionHead({ title }: { title: string }) {
  return (
    <div
      style={{
        fontSize: 10,
        fontWeight: 700,
        color: "#888",
        letterSpacing: 1.2,
        textTransform: "uppercase" as const,
        fontFamily: "var(--mono, monospace)",
        marginBottom: 10,
        paddingBottom: 6,
        borderBottom: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      {title}
    </div>
  );
}

function SpecRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "110px 1fr",
        gap: 12,
        marginBottom: 10,
        alignItems: "flex-start",
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: "#666",
          letterSpacing: 0.4,
          textTransform: "uppercase" as const,
          fontFamily: "var(--mono, monospace)",
          paddingTop: 2,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 13, color: "#c8c8c8", lineHeight: 1.65 }}>{value}</div>
    </div>
  );
}

// ── Confirm Modal ──────────────────────────────────────────────────────────────

function ConfirmModal({
  strategyName,
  amountTwd,
  onConfirm,
  onCancel,
}: {
  strategyName: string;
  amountTwd: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [checkedAudit, setCheckedAudit] = useState(false);
  const [checkedLoss, setCheckedLoss] = useState(false);

  const canConfirm = checkedAudit && checkedLoss;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(0,0,0,0.72)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        style={{
          maxWidth: 480,
          width: "100%",
          background: "#0c1118",
          border: "1px solid rgba(230,57,70,0.5)",
          borderTop: "3px solid #e63946",
          borderRadius: 8,
          padding: "24px 24px 20px",
          boxShadow: "0 24px 64px rgba(0,0,0,0.55)",
        }}
        role="dialog"
        aria-modal="true"
        aria-label="上線候選檢查確認"
      >
        {/* Warning header */}
        <div style={{ marginBottom: 18 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 800,
              color: "#e63946",
              letterSpacing: 1,
              textTransform: "uppercase" as const,
              fontFamily: "var(--mono, monospace)",
              marginBottom: 6,
            }}
          >
            正式券商寫入未開放
          </div>
          <h2
            style={{
              margin: 0,
              fontSize: 17,
              fontWeight: 850,
              color: "#f0f0f0",
              lineHeight: 1.3,
            }}
          >
            此動作僅標記上線候選檢查，不會送出券商委託
          </h2>
        </div>

        {/* Risk box */}
        <div
          style={{
            padding: "12px 14px",
            background: "rgba(230,57,70,0.08)",
            border: "1px solid rgba(230,57,70,0.3)",
            borderRadius: 5,
            marginBottom: 18,
          }}
        >
          <div style={{ fontSize: 12, color: "#ffaaaa", lineHeight: 1.7 }}>
            <strong style={{ color: "#e63946" }}>策略：</strong>{strategyName}
            <br />
            <strong style={{ color: "#e63946" }}>SIM 分配參考：</strong>
            {amountTwd.toLocaleString("zh-TW")} 元 TWD
            <br />
            <strong style={{ color: "#e63946" }}>交接狀態：</strong>SIM 觀察 / 正式券商寫入關閉
            <br />
            <strong style={{ color: "#e63946" }}>風控：</strong>4 層風控僅供候選檢查，不代表策略可正式交易。
          </div>
        </div>

        {/* Checkboxes */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 22 }}>
          <label
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              cursor: "pointer",
              fontSize: 13,
              color: "#d0d0d0",
              lineHeight: 1.5,
            }}
          >
            <input
              type="checkbox"
              checked={checkedAudit}
              onChange={(e) => setCheckedAudit(e.target.checked)}
              style={{ marginTop: 2, accentColor: "#e63946", flexShrink: 0, width: 16, height: 16 }}
            />
            我已閱讀策略 detail panel 中的 8 caveat 燈號表格，了解此策略尚未通過完整驗證。
          </label>
          <label
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              cursor: "pointer",
              fontSize: 13,
              color: "#d0d0d0",
              lineHeight: 1.5,
            }}
          >
            <input
              type="checkbox"
              checked={checkedLoss}
              onChange={(e) => setCheckedLoss(e.target.checked)}
              style={{ marginTop: 2, accentColor: "#e63946", flexShrink: 0, width: 16, height: 16 }}
            />
            我了解此頁不會啟用正式券商寫入，也不代表策略可上線交易。
          </label>
        </div>

        {/* Buttons */}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button
            onClick={onCancel}
            style={{
              padding: "8px 18px",
              background: "transparent",
              border: "1px solid rgba(255,255,255,0.15)",
              borderRadius: 4,
              color: "#888",
              fontSize: 12,
              fontFamily: "var(--mono, monospace)",
              cursor: "pointer",
            }}
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            disabled={!canConfirm}
            style={{
              padding: "8px 20px",
              background: canConfirm ? "#e63946" : "rgba(230,57,70,0.18)",
              border: "1px solid rgba(230,57,70,0.5)",
              borderRadius: 4,
              color: canConfirm ? "#fff" : "#884",
              fontSize: 12,
              fontWeight: 700,
              fontFamily: "var(--mono, monospace)",
              cursor: canConfirm ? "pointer" : "not-allowed",
              transition: "background 0.14s",
            }}
          >
            確認候選檢查
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Segmented control ─────────────────────────────────────────────────────────

function SegmentedControl({
  value,
  liveDisabled,
  liveDisabledReason,
  onChange,
}: {
  value: ToggleMode;
  liveDisabled: boolean;
  liveDisabledReason: string;
  onChange: (v: ToggleMode) => void;
}) {
  const segments: { key: ToggleMode; label: string; color: string }[] = [
    { key: "OFF", label: "研究", color: "#888" },
    { key: "PAPER", label: "SIM", color: "#60a5fa" },
    { key: "LIVE", label: "候選", color: "#ffb800" },
  ];

  return (
    <div
      style={{
        display: "inline-flex",
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: 6,
        padding: 3,
        gap: 2,
      }}
      role="group"
      aria-label="策略治理階段切換（SIM-only）"
    >
      {segments.map(({ key, label, color }) => {
        const isActive = value === key;
        const isDisabled = key === "LIVE" && liveDisabled;

        return (
          <button
            key={key}
            onClick={() => !isDisabled && onChange(key)}
            title={isDisabled ? liveDisabledReason : undefined}
            aria-pressed={isActive}
            disabled={isDisabled}
            style={{
              padding: "6px 18px",
              borderRadius: 4,
              border: "none",
              background: isActive
                ? key === "OFF"
                  ? "rgba(255,255,255,0.1)"
                  : key === "PAPER"
                    ? "rgba(59,130,246,0.2)"
                    : "rgba(255,184,0,0.18)"
                : "transparent",
              color: isDisabled ? "rgba(255,255,255,0.2)" : isActive ? color : "#666",
              fontSize: 11,
              fontWeight: isActive ? 800 : 600,
              fontFamily: "var(--mono, monospace)",
              letterSpacing: 0.8,
              cursor: isDisabled ? "not-allowed" : "pointer",
              transition: "background 0.12s, color 0.12s",
              outline: isActive ? `1px solid ${color}30` : "none",
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

// ── SIM observation panel ─────────────────────────────────────────────────────

function PaperObservationPanel({
  data,
  currentMode,
}: {
  data: StrategyDetailData;
  currentMode: ToggleMode;
}) {
  if (currentMode !== "PAPER" && data.paperObservation.status !== "in_progress") return null;
  if (currentMode === "OFF" && data.paperObservation.status === "not_started") return null;

  const { startDate, expectedUnlockDate, status } = data.paperObservation;

  return (
    <div
      style={{
        marginTop: 20,
        padding: "14px 16px",
        background: "rgba(59,130,246,0.05)",
        border: "1px solid rgba(59,130,246,0.25)",
        borderLeft: "3px solid #60a5fa",
        borderRadius: 5,
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: "#60a5fa",
          letterSpacing: 0.8,
          textTransform: "uppercase" as const,
          fontFamily: "var(--mono, monospace)",
          marginBottom: 8,
        }}
      >
        SIM 觀察期狀態
      </div>

      {status === "not_started" && (
        <div style={{ fontSize: 13, color: "#9aa0ab", lineHeight: 1.6 }}>
          切換至 SIM 後，系統將開始記錄模擬成交。至少 1 個交易日後可檢視 audit summary；正式券商寫入仍維持關閉。
        </div>
      )}

      {status === "in_progress" && startDate && expectedUnlockDate && (
        <div style={{ fontSize: 13, color: "#c8c8c8", lineHeight: 1.7 }}>
          <div>
            <span style={{ color: "#888" }}>觀察開始：</span>
            <strong>{startDate}</strong>
          </div>
          <div>
            <span style={{ color: "#888" }}>預計完成 SIM 觀察：</span>
            <strong style={{ color: "#60a5fa" }}>
              {expectedUnlockDate} 收盤後
            </strong>
          </div>
          <div style={{ marginTop: 8, fontSize: 12, color: "#777" }}>
            觀察期間系統持續紀錄：模擬成交筆數 / 模擬 P&L / kill switch 觸發紀錄 / 4 層風控觸發紀錄。audit summary 產生後可在此查看；正式券商寫入需另行後端契約與風控驗收。
          </div>
        </div>
      )}

      {status === "completed" && (
        <div style={{ fontSize: 13, color: "#2ecc71", lineHeight: 1.6 }}>
          SIM 觀察完成。Audit summary 已產生；仍不可啟用正式券商寫入。
        </div>
      )}

      {/* Info fields placeholder — backend event: paper_observation_complete */}
      <div
        style={{
          marginTop: 12,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
          gap: 10,
        }}
      >
        {[
          { label: "模擬成交筆數", value: status === "in_progress" ? "觀察中..." : "—" },
          { label: "模擬 P&L", value: status === "in_progress" ? "觀察中..." : "—" },
          { label: "Kill switch 觸發", value: status === "in_progress" ? "觀察中..." : "—" },
          { label: "4 層風控觸發", value: status === "in_progress" ? "觀察中..." : "—" },
        ].map(({ label, value }) => (
          <div
            key={label}
            style={{
              padding: "8px 10px",
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.06)",
              borderRadius: 4,
            }}
          >
            <div style={{ fontSize: 10, color: "#666", marginBottom: 3, fontFamily: "var(--mono, monospace)" }}>
              {label}
            </div>
            <div style={{ fontSize: 12, color: "#9aa0ab" }}>{value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main client component ──────────────────────────────────────────────────────

export function StrategyDetailClient({ data }: { data: StrategyDetailData }) {
  // Role check
  const [isOwner, setIsOwner] = useState<boolean | null>(null);

  // Toggle state
  const [currentMode, setCurrentMode] = useState<ToggleMode>("OFF");
  const [pendingMode, setPendingMode] = useState<ToggleMode | null>(null);
  const [amountTwd, setAmountTwd] = useState<string>("");
  const [toggleState, setToggleState] = useState<ToggleApiState>({ status: "idle" });
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const amountInputRef = useRef<HTMLInputElement>(null);

  // Candidate/live broker-write is intentionally closed in this frontend lane.
  const liveDisabled = true;
  const liveDisabledReason =
    "正式券商寫入關閉；目前只允許研究與 SIM 觀察，候選交接需 Jason/風控另行開啟後端契約。";

  // Load user role
  useEffect(() => {
    apiGetMe().then((result) => {
      if (result.ok) {
        setIsOwner(result.user.role === "Owner");
      } else {
        setIsOwner(false);
      }
    });
  }, []);

  const handleModeRequest = useCallback(
    (mode: ToggleMode) => {
      if (mode === currentMode) return;

      if (mode === "LIVE") {
        setToggleState({
          status: "error",
          message: "正式券商寫入關閉；此頁目前不能切換正式券商模式。",
        });
        return;
      }

      // OFF / SIM — confirm-free
      applyMode(mode);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentMode],
  );

  async function applyMode(mode: ToggleMode, yangExplicitAck?: boolean) {
    setToggleState({ status: "loading" });
    const amtNum = amountTwd.trim() ? parseInt(amountTwd.replace(/,/g, ""), 10) : null;

    const result = await postStrategyToggle(data.strategyId, mode, amtNum, yangExplicitAck);
    if (result.ok) {
      setCurrentMode(mode);
      setToggleState({ status: "success", mode });
    } else {
      setToggleState({
        status: "error",
        message:
          result.error === "network_error"
            ? "網路錯誤，請稍後再試。"
            : result.error === "forbidden"
              ? "權限不足，僅 Owner 可操作。"
              : `切換失敗：${result.error ?? "unknown"}`,
      });
    }
  }

  function handleConfirmLive() {
    setShowConfirmModal(false);
    if (pendingMode) {
      // Pass yang_explicit_ack=true — this is the explicit owner ack from the confirm modal
      applyMode(pendingMode, true);
      setPendingMode(null);
    }
  }

  function handleCancelModal() {
    setShowConfirmModal(false);
    setPendingMode(null);
  }

  const accentColor =
    data.badgeVariant === "amber"
      ? "#ffb800"
      : data.badgeVariant === "blue"
        ? "#60a5fa"
        : "#a78bfa";

  const badgeStyle: React.CSSProperties =
    data.badgeVariant === "amber"
      ? {
          background: "rgba(255,184,0,0.12)",
          border: "1px solid rgba(255,184,0,0.5)",
          color: "#ffb800",
        }
      : data.badgeVariant === "blue"
        ? {
            background: "rgba(59,130,246,0.12)",
            border: "1px solid rgba(59,130,246,0.5)",
            color: "#60a5fa",
          }
        : {
            background: "rgba(139,92,246,0.12)",
            border: "1px solid rgba(139,92,246,0.45)",
            color: "#a78bfa",
          };

  return (
    <>
      {/* ── Hero header ─────────────────────────────────────────────────── */}
      <div
        style={{
          padding: "20px 22px 18px",
          marginBottom: 20,
          background: "rgba(11,16,23,0.88)",
          border: "1px solid rgba(220,228,240,0.09)",
          borderTop: `3px solid ${accentColor}`,
          borderRadius: 8,
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 140,
            background: `radial-gradient(ellipse at 40% 0%, ${
              data.badgeVariant === "amber"
                ? "rgba(255,184,0,0.06)"
                : data.badgeVariant === "blue"
                  ? "rgba(59,130,246,0.06)"
                  : "rgba(139,92,246,0.06)"
            }, transparent 65%)`,
            pointerEvents: "none",
          }}
        />
        <div style={{ position: "relative", zIndex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "3px 10px",
                borderRadius: 4,
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: 0.6,
                ...badgeStyle,
              }}
            >
              {data.badgeLabel}
            </span>
            <span style={{ fontSize: 10, color: "#555", fontFamily: "var(--mono, monospace)" }}>
              {data.strategyId}
            </span>
          </div>
          <h1
            style={{
              margin: "0 0 8px",
              fontSize: 28,
              fontWeight: 850,
              color: "#f0f0f0",
              letterSpacing: -0.4,
              fontFamily: "var(--sans-tc, sans-serif)",
            }}
          >
            {data.displayName}
          </h1>
          <p style={{ margin: 0, fontSize: 14, color: "#8a9ab0", lineHeight: 1.6 }}>
            {data.tagline}
          </p>
          <div style={{ marginTop: 10, fontSize: 11, color: "#555", fontFamily: "var(--mono, monospace)" }}>
            治理狀態 / {data.governanceState}
          </div>
        </div>
      </div>

      {/* ── Section 1: Strategy spec ─────────────────────────────────────── */}
      <div
        style={{
          padding: "18px 20px",
          marginBottom: 16,
          background: "rgba(11,16,23,0.82)",
          border: "1px solid rgba(220,228,240,0.07)",
          borderRadius: 8,
        }}
      >
        <SectionHead title="策略設計規格" />
        <SpecRow label="概述" value={data.spec.intro} />
        <SpecRow label="訊號邏輯" value={data.spec.signalLogic} />
        <SpecRow label="部位規模" value={data.spec.sizing} />
        <SpecRow label="退出條件（研究規格）" value={data.spec.exitRule} />
      </div>

      {/* ── Full caveat ──────────────────────────────────────────────────── */}
      <div
        style={{
          padding: "14px 16px",
          marginBottom: 16,
          background: "rgba(255,200,0,0.04)",
          border: "1px solid rgba(255,184,0,0.22)",
          borderLeft: "3px solid #ffb800",
          borderRadius: 5,
        }}
      >
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: "#ffb800",
            letterSpacing: 0.8,
            textTransform: "uppercase" as const,
            fontFamily: "var(--mono, monospace)",
            marginBottom: 8,
          }}
        >
          Athena 注意事項全文（不截斷）
        </div>
        <div style={{ fontSize: 13, color: "#d4d4d4", lineHeight: 1.8 }}>
          {data.fullCaveat}
        </div>
      </div>

      {/* ── Section 2: 8 caveat verdict table ───────────────────────────── */}
      <div
        style={{
          padding: "18px 20px",
          marginBottom: 16,
          background: "rgba(11,16,23,0.82)",
          border: "1px solid rgba(220,228,240,0.07)",
          borderRadius: 8,
        }}
      >
        <SectionHead title="8 項治理燈號（athena_lane_e_8_caveat_sweep）" />
        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          {data.caveatVerdicts.map((v, idx) => (
            <div
              key={idx}
              style={{
                display: "grid",
                gridTemplateColumns: "22px 180px 1fr",
                gap: "0 10px",
                padding: "9px 0",
                borderBottom:
                  idx < data.caveatVerdicts.length - 1
                    ? "1px solid rgba(255,255,255,0.04)"
                    : "none",
                alignItems: "flex-start",
              }}
            >
              <div style={{ paddingTop: 1 }}>
                <CaveatIcon icon={v.icon} />
              </div>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: "#c0c0c0",
                  lineHeight: 1.5,
                }}
              >
                {v.label}
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: "#9aa0ab",
                  lineHeight: 1.6,
                }}
              >
                {v.detail}
              </div>
            </div>
          ))}
        </div>
        <div
          style={{
            marginTop: 14,
            fontSize: 10,
            color: "#555",
            fontFamily: "var(--mono, monospace)",
          }}
        >
          來源 / athena_lane_e_8_caveat_sweep · athena_truth_board_v1 (2026-05-08)
        </div>
      </div>


      {/* ── Section 3 [Stage 2]: Chart panel (cont_liq_v36 only) ─────────── */}
      {STAGE2_SNAPSHOTS[data.strategyId] !== undefined && (
        <StrategyChartPanel snapshot={STAGE2_SNAPSHOTS[data.strategyId]!} />
      )}

      {/* ── Section 3: Owner-only toggle area ───────────────────────────── */}
      {isOwner === null && (
        <div
          style={{
            padding: "14px 16px",
            marginBottom: 16,
            background: "rgba(18,18,22,0.5)",
            border: "1px solid rgba(100,100,100,0.15)",
            borderRadius: 5,
            fontSize: 12,
            color: "#666",
          }}
        >
          載入中…
        </div>
      )}

      {isOwner === false && (
        <div
          style={{
            padding: "14px 16px",
            marginBottom: 16,
            background: "rgba(18,18,22,0.5)",
            border: "1px solid rgba(100,100,100,0.15)",
            borderRadius: 5,
          }}
        >
          <div
            style={{
              fontSize: 11,
              color: "#555",
              fontFamily: "var(--mono, monospace)",
              marginBottom: 4,
            }}
          >
            OWNER ONLY
          </div>
          <div style={{ fontSize: 13, color: "#666" }}>
            策略治理階段控制僅限 Owner 角色使用；目前不提供正式券商寫入。
          </div>
        </div>
      )}

      {isOwner === true && (
        <div
          style={{
            padding: "20px 22px",
            marginBottom: 16,
            background: "rgba(11,16,23,0.88)",
            border: "1px solid rgba(220,228,240,0.09)",
            borderRadius: 8,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
            <SectionHead title="策略治理階段（Owner / SIM-only）" />
          </div>

          {/* Mode indicator */}
          <div
            style={{
              fontSize: 11,
              fontFamily: "var(--mono, monospace)",
              color:
                currentMode === "LIVE"
                  ? "#ffb800"
                  : currentMode === "PAPER"
                    ? "#60a5fa"
                    : "#666",
              marginBottom: 14,
              letterSpacing: 0.4,
            }}
          >
            目前階段：<strong>{modeDisplayLabel(currentMode)}</strong>
            {currentMode === "LIVE" && (
              <span style={{ marginLeft: 8, color: "#ffb800" }}>候選交接 · 券商寫入關閉</span>
            )}
            {currentMode === "PAPER" && (
              <span style={{ marginLeft: 8, color: "#60a5fa" }}>SIM 模擬觀察</span>
            )}
          </div>

          {/* Segmented control */}
          <div style={{ marginBottom: 18 }}>
            <SegmentedControl
              value={currentMode}
              liveDisabled={liveDisabled}
              liveDisabledReason={liveDisabledReason}
              onChange={handleModeRequest}
            />
            {liveDisabled && (
              <div
                style={{
                  marginTop: 6,
                  fontSize: 11,
                  color: "#555",
                  fontFamily: "var(--mono, monospace)",
                }}
              >
                ⓘ {liveDisabledReason}
              </div>
            )}
          </div>

          {/* Amount input — visible for SIM or candidate review only. */}
          {(currentMode === "PAPER" || currentMode === "LIVE") && (
            <div style={{ marginBottom: 16 }}>
              <label
                htmlFor="strategy-amount"
                style={{
                  display: "block",
                  fontSize: 10,
                  fontWeight: 700,
                  color: "#888",
                  letterSpacing: 0.5,
                  textTransform: "uppercase" as const,
                  fontFamily: "var(--mono, monospace)",
                  marginBottom: 6,
                }}
              >
                SIM 分配金額（TWD 整數，非正式送單）
              </label>
              <input
                id="strategy-amount"
                ref={amountInputRef}
                type="text"
                inputMode="numeric"
                value={amountTwd}
                onChange={(e) => {
                  const raw = e.target.value.replace(/[^0-9]/g, "");
                  setAmountTwd(raw);
                }}
                placeholder="例：500000"
                style={{
                  width: 200,
                  padding: "8px 12px",
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.14)",
                  borderRadius: 4,
                  color: "#e0e0e0",
                  fontSize: 14,
                  fontFamily: "var(--mono, monospace)",
                  outline: "none",
                }}
              />
              {amountTwd && (
                <div style={{ marginTop: 4, fontSize: 11, color: "#888" }}>
                  {parseInt(amountTwd, 10).toLocaleString("zh-TW")} 元
                </div>
              )}
            </div>
          )}

          {/* API status feedback */}
          {toggleState.status === "loading" && (
            <div style={{ fontSize: 12, color: "#888", marginBottom: 10 }}>處理中…</div>
          )}
          {toggleState.status === "success" && (
            <div
              style={{
                fontSize: 12,
                color: "#2ecc71",
                marginBottom: 10,
                fontFamily: "var(--mono, monospace)",
              }}
            >
              已切換至 {modeDisplayLabel(toggleState.mode)}
            </div>
          )}
          {toggleState.status === "error" && (
            <div
              style={{
                fontSize: 12,
                color: "#e63946",
                marginBottom: 10,
              }}
            >
              {toggleState.message}
            </div>
          )}

          {/* SIM observation panel */}
          <PaperObservationPanel data={data} currentMode={currentMode} />
        </div>
      )}

      {/* Confirm modal */}
      {showConfirmModal && pendingMode === "LIVE" && (
        <ConfirmModal
          strategyName={data.displayName}
          amountTwd={parseInt(amountTwd || "0", 10)}
          onConfirm={handleConfirmLive}
          onCancel={handleCancelModal}
        />
      )}
    </>
  );
}
