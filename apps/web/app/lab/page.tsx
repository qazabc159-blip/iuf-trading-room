/**
 * /lab — entry page redesign 2026-05-09
 *
 * 三層結構:
 *   Top:    3 strategy hero cards (cont_liq_v36 / strategy_002 / strategy_003) + mini sparkline
 *   Middle: Athena live status panel (5/9 凌晨更新)
 *   Bottom: 舊 LabClient collapsed in <details> (deprecated, not deleted)
 *
 * Design: IUF amber/CRT phosphor / operator control-tower style
 * Mobile: 3-col → 1-col responsive
 *
 * HARD LINES:
 *   - No fake metrics / no mock chart
 *   - caveat 不截斷
 *   - 不動 broker / risk / migration
 *   - 不動 globals.css
 *   - 舊 LabClient 只 collapse, 不刪
 *   - Athena 5/9 命名: 流動順勢三強 / 營收動能驚喜 / 200 日均線順勢
 */

import Link from "next/link";
import { LabClient } from "@/app/lab/LabClient";
import { PageFrame } from "@/components/PageFrame";
import { getLabThreeStrategySnapshot } from "@/lib/api";
import { radarLabApi } from "@/lib/radar-lab";
import { friendlyDataError } from "@/lib/friendly-error";

export const dynamic = "force-dynamic";

// ── Sparkline data ─────────────────────────────────────────────────────────────
// cont_liq_v36: real equity curve 13 pts (Athena snapshot_v0 equityCurve)
const CONT_LIQ_SPARKLINE = [
  0.0138, 0.2504, 0.119, 0.2547, 0.6097, 0.491,
  0.8008, 0.967, 0.968, 1.143, 1.3663, 1.8553, 2.2202,
] as const;

// strategy_002 / 003: no chart snapshot yet — dashed placeholder
const PENDING_SPARKLINE = [0, 0.01, 0.005, 0.012, 0.008, 0.015, 0.01, 0.018] as const;

type SpkPoints = readonly number[];

function MiniSparkline({ pts, color, pending }: { pts: SpkPoints; color: string; pending?: boolean }) {
  const W = 280; const H = 44;
  const PAD = 4;
  const iW = W - PAD * 2; const iH = H - PAD * 2;
  const arr = Array.from(pts);
  const mn = Math.min(...arr); const mx = Math.max(...arr);
  const rng = mx - mn || 1;
  const xs = (i: number) => PAD + (i / (arr.length - 1)) * iW;
  const ys = (v: number) => PAD + ((mx - v) / rng) * iH;
  const line = arr.map((v, i) => `${xs(i)},${ys(v)}`).join(" ");
  const area = [
    ...arr.map((v, i) => `${xs(i)},${ys(v)}`),
    `${xs(arr.length - 1)},${PAD + iH}`,
    `${xs(0)},${PAD + iH}`,
  ].join(" ");
  return (
    <div style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: H, display: "block", opacity: pending ? 0.4 : 1 }} aria-hidden="true">
        <polygon points={area} fill={color} fillOpacity={0.1} />
        <polyline points={line} fill="none" stroke={color} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={pending ? "4 3" : undefined} />
      </svg>
      <div style={{ position: "absolute", bottom: 4, right: 6, fontSize: 9, fontFamily: "var(--mono,monospace)", color: pending ? "#555" : color, opacity: 0.85 }}>
        {pending ? "chart pending Task #400" : "點開看完整圖表 →"}
      </div>
    </div>
  );
}

// ── Strategy card data (Athena 5/9 ack 命名) ──────────────────────────────────

type BadgeV = "amber" | "blue" | "violet";

type HeroCard = {
  id: string;
  href: string;
  displayName: string;
  tagline: string;
  badge: BadgeV;
  badgeLabel: string;
  kpi1Label: string; kpi1Value: string;
  kpi2Label: string; kpi2Value: string;
  caveat: string;
  sparkline: SpkPoints;
  pending: boolean;
};

const ACCENT: Record<BadgeV, string> = {
  amber: "#ffb800",
  blue: "#60a5fa",
  violet: "#a78bfa",
};
const BADGE_BG: Record<BadgeV, string> = {
  amber: "rgba(255,184,0,0.12)",
  blue: "rgba(59,130,246,0.12)",
  violet: "rgba(139,92,246,0.12)",
};
const BADGE_BORDER: Record<BadgeV, string> = {
  amber: "rgba(255,184,0,0.52)",
  blue: "rgba(59,130,246,0.52)",
  violet: "rgba(139,92,246,0.48)",
};
const CARD_GLOW: Record<BadgeV, string> = {
  amber: "rgba(255,184,0,0.055)",
  blue: "rgba(59,130,246,0.055)",
  violet: "rgba(139,92,246,0.055)",
};

const HERO_CARDS: HeroCard[] = [
  {
    id: "cont_liquidity_relative_strength__h20__top5__turnover_cap_0.25",
    href: "/lab/three-strategy/cont_liquidity_relative_strength__h20__top5__turnover_cap_0.25",
    displayName: "流動順勢三強",
    tagline: "流動性相對強度選股 h20，前三強等權。9/9 驗證通過 + 四重魯棒確認。",
    badge: "amber",
    badgeLabel: "9/9 PASS",
    kpi1Label: "驗證通過率",
    kpi1Value: "9/9",
    kpi2Label: "魯棒性",
    kpi2Value: "四重確認",
    caveat: "仍需 forward observation / K≥50 流動性股票宇宙為必要條件 / 尚未進入任何交易流程",
    sparkline: CONT_LIQ_SPARKLINE,
    pending: false,
  },
  {
    id: "strategy_002_revenue_yoy_surprise",
    href: "/lab/three-strategy/strategy_002_revenue_yoy_surprise",
    displayName: "營收動能驚喜",
    tagline: "營收年增率超預期選股策略。walk-forward + bootstrap CI 進行中（Task #400）。",
    badge: "blue",
    badgeLabel: "walk-forward",
    kpi1Label: "狀態",
    kpi1Value: "驗證中",
    kpi2Label: "任務",
    kpi2Value: "Task #400",
    caveat: "walk-forward + bootstrap CI 進行中 / 尚無可公開績效 / 不代表驗證通過",
    sparkline: PENDING_SPARKLINE,
    pending: true,
  },
  {
    id: "strategy_003_ma200_trend_follow",
    href: "/lab/three-strategy/strategy_003_ma200_trend_follow",
    displayName: "200 日均線順勢",
    tagline: "200 日均線趨勢跟隨策略。walk-forward + bootstrap CI 進行中（Task #400）。",
    badge: "violet",
    badgeLabel: "walk-forward",
    kpi1Label: "狀態",
    kpi1Value: "驗證中",
    kpi2Label: "任務",
    kpi2Value: "Task #400",
    caveat: "walk-forward + bootstrap CI 進行中 / 尚無可公開績效 / 不代表驗證通過",
    sparkline: PENDING_SPARKLINE,
    pending: true,
  },
];

function HeroStrategyCard({ c }: { c: HeroCard }) {
  const accent = ACCENT[c.badge];
  const glow = CARD_GLOW[c.badge];
  return (
    <article className="_lab-hero-card" data-badge={c.badge}>
      {/* Top accent bar */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg,${accent},transparent 70%)`, borderRadius: "10px 10px 0 0", opacity: 0.85 }} />
      {/* Radial glow bg */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 130, background: `radial-gradient(ellipse at 50% 0%,${glow},transparent 65%)`, pointerEvents: "none" }} />
      <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", height: "100%" }}>
        {/* Badge row */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <span style={{ display: "inline-flex", alignItems: "center", padding: "3px 10px", borderRadius: 4, fontSize: 11, fontWeight: 700, letterSpacing: 0.6, background: BADGE_BG[c.badge], border: `1px solid ${BADGE_BORDER[c.badge]}`, color: accent }}>
            {c.badgeLabel}
          </span>
          <span style={{ fontSize: 9, fontFamily: "var(--mono,monospace)", color: "#455", maxWidth: 110, textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }} title={c.id}>
            {c.id}
          </span>
        </div>
        {/* Display name */}
        <h2 style={{ margin: "0 0 8px", fontSize: 26, fontWeight: 850, color: "#f2f2f2", letterSpacing: -0.4, lineHeight: 1.15, fontFamily: "var(--sans-tc,sans-serif)" }}>
          {c.displayName}
        </h2>
        {/* Tagline */}
        <p style={{ margin: "0 0 14px", fontSize: 12.5, color: "#8a90a0", lineHeight: 1.65, flexGrow: 1 }}>
          {c.tagline}
        </p>
        {/* KPI row */}
        <div style={{ display: "flex", gap: 12, marginBottom: 14, borderTop: "1px solid rgba(255,255,255,0.055)", borderBottom: "1px solid rgba(255,255,255,0.055)", padding: "10px 0" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 9, fontFamily: "var(--mono,monospace)", color: "#555", letterSpacing: 0.4, marginBottom: 3 }}>{c.kpi1Label}</div>
            <div style={{ fontSize: 22, fontWeight: 800, fontFamily: "var(--mono,monospace)", color: c.pending ? "#66748a" : accent, fontVariantNumeric: "tabular-nums" }}>{c.kpi1Value}</div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 9, fontFamily: "var(--mono,monospace)", color: "#555", letterSpacing: 0.4, marginBottom: 3 }}>{c.kpi2Label}</div>
            <div style={{ fontSize: 22, fontWeight: 800, fontFamily: "var(--mono,monospace)", color: c.pending ? "#66748a" : accent, fontVariantNumeric: "tabular-nums" }}>{c.kpi2Value}</div>
          </div>
        </div>
        {/* Mini sparkline */}
        <div style={{ marginBottom: 14, borderRadius: 5, overflow: "hidden" }}>
          <MiniSparkline pts={c.sparkline} color={accent} pending={c.pending} />
        </div>
        {/* Caveat (full, no truncate) */}
        <div style={{ padding: "8px 10px", marginBottom: 14, background: "rgba(255,200,0,0.03)", border: "1px solid rgba(255,184,0,0.15)", borderRadius: 5, fontSize: 11, color: "#aaa", lineHeight: 1.65 }}>
          <span style={{ fontFamily: "var(--mono,monospace)", color: "#ffb80099", fontSize: 9, fontWeight: 700, letterSpacing: 0.4, display: "block", marginBottom: 3 }}>注意事項</span>
          {c.caveat}
        </div>
        {/* CTA */}
        <Link href={c.href} className="_lab-hero-cta" style={{ color: accent }} data-badge={c.badge}>
          進入 detail panel <span style={{ marginLeft: 4 }}>→</span>
        </Link>
      </div>
    </article>
  );
}

// ── Athena status panel ────────────────────────────────────────────────────────

type AthenaTruth = {
  strategyId: string;
  label: string;
  status: string;
  statusColor: string;
  note: string;
};

const ATHENA_TRUTH_BOARD: AthenaTruth[] = [
  {
    strategyId: "cont_liq_v36",
    label: "流動順勢三強",
    status: "RESEARCH_FORWARD_OBSERVATION",
    statusColor: "#ffb800",
    note: "9/9 PASS · 四重魯棒 · K≥50 capacity 必要條件 · forward obs 進行中",
  },
  {
    strategyId: "rs_20_60",
    label: "穩健強勢低回撤（已退場）",
    status: "RETIRED",
    statusColor: "#666",
    note: "sector-pinned · family-level no-edge 確認 · 2026-05-09 退場",
  },
  {
    strategyId: "strategy_002_003",
    label: "營收動能驚喜 / 200 日均線順勢",
    status: "WALK_FORWARD_IN_PROGRESS",
    statusColor: "#60a5fa",
    note: "walk-forward + bootstrap CI 進行中（Task #400）",
  },
];

function AthenaTruthPanel() {
  return (
    <section className="_lab-athena-panel">
      <div className="_lab-athena-header">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 10, fontFamily: "var(--mono,monospace)", color: "#ffb800", fontWeight: 700, letterSpacing: 0.7 }}>LAB CEO</span>
          <span style={{ fontSize: 15, fontWeight: 700, color: "#eee" }}>Athena 即時狀態</span>
          <span style={{ fontSize: 10, color: "#555", fontFamily: "var(--mono,monospace)" }}>5/9 凌晨 truth board 更新</span>
        </div>
        <span style={{ fontSize: 10, color: "#555", fontFamily: "var(--mono,monospace)", letterSpacing: 0.3 }}>IUF Quant Lab v15</span>
      </div>

      <div className="_lab-athena-rows">
        {ATHENA_TRUTH_BOARD.map((row) => (
          <div key={row.strategyId} className="_lab-athena-row">
            <div style={{ flex: "0 0 140px" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#ccc", marginBottom: 2 }}>{row.label}</div>
              <div style={{ fontSize: 9, fontFamily: "var(--mono,monospace)", color: "#555" }}>{row.strategyId}</div>
            </div>
            <div style={{ flex: "0 0 auto" }}>
              <span style={{ display: "inline-block", padding: "2px 9px", borderRadius: 4, fontSize: 10, fontWeight: 700, fontFamily: "var(--mono,monospace)", letterSpacing: 0.5, background: row.statusColor + "18", border: `1px solid ${row.statusColor}55`, color: row.statusColor }}>
                {row.status}
              </span>
            </div>
            <div style={{ flex: 1, fontSize: 11, color: "#7a8295", lineHeight: 1.55 }}>{row.note}</div>
          </div>
        ))}
      </div>

      {/* Capacity caveat banner — red, prominent */}
      <div style={{ marginTop: 14, padding: "9px 14px", background: "rgba(220,50,50,0.06)", border: "1px solid rgba(220,50,50,0.3)", borderLeft: "3px solid #dc3535", borderRadius: 5, fontSize: 11, color: "#f87171", lineHeight: 1.65 }}>
        <strong style={{ color: "#ef4444", fontFamily: "var(--mono,monospace)", fontSize: 10, letterSpacing: 0.5 }}>CAPACITY CAVEAT</strong>
        {" "}cont_liq_v36 的 K≥50 流動性股票宇宙為必要條件。目前 K=68→20 PARTIAL。在 K 值穩定在 50 以上之前，不具備量產規模部署條件。所有策略均處研究狀態，尚未進入任何實際交易流程。
      </div>
    </section>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default async function LabPage() {
  // Fetch radarLab bundles for deprecated section (keep backend compat)
  let bundles: import("@/lib/radar-lab").LabSignalBundle[] = [];
  let bundleError: string | null = null;
  try {
    bundles = await radarLabApi.bundles();
  } catch (err) {
    bundleError = friendlyDataError(err, "量化研究資料暫時無法讀取。");
  }

  // Also hit three-strategy snapshot to show live caveat status
  const snapshot = await getLabThreeStrategySnapshot();
  const snapshotStale = !snapshot || !snapshot.created_at_taipei?.startsWith("2026-05-09");

  return (
    <PageFrame
      code="LAB"
      title="IUF Quant Lab"
      sub="量化研究候選策略 / Athena truth board"
      note="本頁顯示 Lab 三條候選策略狀態。所有策略均處研究狀態，尚未進入任何交易流程。不顯示勝率、配置建議或已驗證字樣。"
    >
      <style>{`
        /* ── Lab entry page CSS — prefix _lab-* ─────────────────────────── */
        ._lab-disclaimer {
          padding: 10px 16px;
          margin-bottom: 20px;
          background: rgba(220,60,60,0.04);
          border: 1px solid rgba(220,60,60,0.32);
          border-left: 3px solid #e05050;
          border-radius: 6px;
          font-size: 12px;
          color: #ddd;
          line-height: 1.6;
        }
        ._lab-disclaimer-label {
          display: block;
          font-size: 10px;
          font-weight: 700;
          color: #e05050;
          font-family: var(--mono, monospace);
          letter-spacing: 0.6px;
          text-transform: uppercase;
          margin-bottom: 4px;
        }
        /* Hero grid */
        ._lab-hero-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 20px;
          margin-bottom: 28px;
        }
        @media (max-width: 1024px) {
          ._lab-hero-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }
        @media (max-width: 640px) {
          ._lab-hero-grid { grid-template-columns: 1fr; gap: 14px; }
        }
        /* Hero card */
        ._lab-hero-card {
          position: relative;
          border-radius: 10px;
          border: 1px solid rgba(220,228,240,0.09);
          background: rgba(11,16,23,0.90);
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,0.026),
            0 8px 28px rgba(0,0,0,0.24);
          overflow: hidden;
          padding: 20px 20px 18px;
          box-sizing: border-box;
          display: flex;
          flex-direction: column;
          transition: transform 0.18s cubic-bezier(.2,.8,.2,1),
                      box-shadow 0.18s cubic-bezier(.2,.8,.2,1),
                      border-color 0.18s;
        }
        ._lab-hero-card::before {
          content: "";
          position: absolute;
          inset: 0;
          pointer-events: none;
          background:
            linear-gradient(rgba(220,228,240,0.016) 1px, transparent 1px),
            linear-gradient(90deg, rgba(220,228,240,0.016) 1px, transparent 1px);
          background-size: 32px 32px;
          opacity: 0.6;
          z-index: 0;
        }
        ._lab-hero-card:hover {
          transform: translateY(-4px);
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,0.04),
            0 18px 48px rgba(0,0,0,0.38);
        }
        ._lab-hero-card[data-badge="amber"]:hover { border-color: rgba(255,184,0,0.28); }
        ._lab-hero-card[data-badge="blue"]:hover   { border-color: rgba(59,130,246,0.28); }
        ._lab-hero-card[data-badge="violet"]:hover { border-color: rgba(139,92,246,0.26); }
        ._lab-hero-cta {
          display: inline-flex;
          align-items: center;
          font-size: 12px;
          font-weight: 700;
          font-family: var(--mono, monospace);
          letter-spacing: 0.5px;
          text-decoration: none;
          border-bottom: 1px solid currentColor;
          padding-bottom: 1px;
          margin-top: auto;
          transition: opacity 0.14s;
        }
        ._lab-hero-cta:hover { opacity: 0.7; }
        @media (prefers-reduced-motion: reduce) {
          ._lab-hero-card { transition: none; }
          ._lab-hero-card:hover { transform: none; }
          ._lab-hero-cta { transition: none; }
        }
        /* Section label */
        ._lab-section-label {
          font-size: 10px;
          font-weight: 700;
          font-family: var(--mono, monospace);
          letter-spacing: 0.8px;
          text-transform: uppercase;
          color: #445;
          margin-bottom: 12px;
        }
        /* Athena panel */
        ._lab-athena-panel {
          background: rgba(11,16,23,0.80);
          border: 1px solid rgba(220,228,240,0.08);
          border-radius: 10px;
          padding: 18px 20px;
          margin-bottom: 28px;
          box-shadow: 0 4px 16px rgba(0,0,0,0.18);
        }
        ._lab-athena-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 14px;
          padding-bottom: 10px;
          border-bottom: 1px solid rgba(255,255,255,0.06);
        }
        ._lab-athena-rows {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        ._lab-athena-row {
          display: flex;
          align-items: flex-start;
          gap: 14px;
          padding: 8px 10px;
          border-radius: 6px;
          background: rgba(255,255,255,0.018);
          border: 1px solid rgba(255,255,255,0.04);
          flex-wrap: wrap;
        }
        @media (max-width: 640px) {
          ._lab-athena-row { flex-direction: column; gap: 6px; }
        }
        /* Deprecated section */
        ._lab-deprecated-details {
          margin-bottom: 20px;
        }
        ._lab-deprecated-summary {
          cursor: pointer;
          user-select: none;
          list-style: none;
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 14px;
          background: rgba(11,16,23,0.55);
          border: 1px solid rgba(100,100,100,0.18);
          border-radius: 6px;
          font-size: 11px;
          font-family: var(--mono, monospace);
          color: #555;
          letter-spacing: 0.4px;
          transition: background 0.15s;
        }
        ._lab-deprecated-summary:hover {
          background: rgba(11,16,23,0.75);
          color: #888;
        }
        ._lab-deprecated-summary::before {
          content: "▶";
          font-size: 8px;
          color: #445;
          transition: transform 0.15s;
        }
        details[open] ._lab-deprecated-summary::before {
          transform: rotate(90deg);
        }
        ._lab-deprecated-body {
          margin-top: 8px;
          border: 1px solid rgba(100,100,100,0.14);
          border-radius: 6px;
          padding: 14px;
          background: rgba(8,12,18,0.6);
        }
        ._lab-snapshot-note {
          padding: 7px 12px;
          margin-bottom: 16px;
          background: rgba(59,130,246,0.04);
          border: 1px solid rgba(59,130,246,0.16);
          border-left: 3px solid #3b82f6;
          border-radius: 5px;
          font-size: 11px;
          color: "#60a5fa";
          line-height: 1.6;
        }
      `}</style>

      {/* Global disclaimer */}
      <div className="_lab-disclaimer">
        <span className="_lab-disclaimer-label">重要聲明</span>
        以下策略均為{" "}
        <strong style={{ color: "#ffb800" }}>研究狀態，尚未進入任何交易流程</strong>。
        無策略通過完整驗證。不顯示任何勝率、報酬率或配置建議。
        狀態來源：Athena truth board 2026-05-09 凌晨更新。
      </div>

      {/* Snapshot stale note */}
      {snapshotStale && (
        <div className="_lab-snapshot-note">
          lab snapshot endpoint 資料仍為 5/7 版本 — 套用 Athena 5/9 覆蓋層。等 endpoint 更新後自動同步。
        </div>
      )}

      {/* ── Top: Hero strategy cards ─── */}
      <div className="_lab-section-label">策略候選 / 三條研究線</div>
      <div className="_lab-hero-grid">
        {HERO_CARDS.map((c) => (
          <HeroStrategyCard key={c.id} c={c} />
        ))}
      </div>

      {/* ── Middle: Athena live status ─── */}
      <div className="_lab-section-label">Athena CEO 即時狀態</div>
      <AthenaTruthPanel />

      {/* ── Bottom: Deprecated LabClient collapsed ─── */}
      <details className="_lab-deprecated-details">
        <summary className="_lab-deprecated-summary">
          舊 lab bundle 系統（已 deprecate）— 點擊展開
          <span style={{ marginLeft: "auto", fontSize: 9, color: "#3a3a4a" }}>admin / bundle audit 用途</span>
        </summary>
        <div className="_lab-deprecated-body">
          <div style={{ fontSize: 11, color: "#555", fontFamily: "var(--mono,monospace)", marginBottom: 12 }}>
            此區塊為舊版 radarLab bundle 列表系統。已於 2026-05-09 移至次要位置。不代表 IUF Quant Lab 正式策略候選。
          </div>
          <LabClient initialBundles={bundles} initialBlockedReason={bundleError ?? undefined} />
        </div>
      </details>

      {/* Footer nav */}
      <div style={{ display: "flex", gap: 16, paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.05)", fontSize: 11, fontFamily: "var(--mono,monospace)" }}>
        <Link href="/lab/three-strategy" style={{ color: "#888", textDecoration: "underline" }}>
          三策略列表頁
        </Link>
        <Link href="/lab/strategies" style={{ color: "#888", textDecoration: "underline" }}>
          策略候選總列表
        </Link>
      </div>
    </PageFrame>
  );
}
