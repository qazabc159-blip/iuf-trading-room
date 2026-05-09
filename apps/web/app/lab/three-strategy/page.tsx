/**
 * /lab/three-strategy page — Stage 1 live endpoint wiring
 * 2026-05-09: 拔 hardcode → 改打 /api/v1/lab/three-strategy/snapshot
 *
 * Data layer:
 *   Primary: getLabThreeStrategySnapshot() → /api/v1/lab/three-strategy/snapshot
 *   Overlay: Athena 5/9 morning truth (cont_liq v36 9/9 PASS + 四重魯棒; rs_20_60 RETIRED;
 *            strategy_002/003 walk-forward in progress)
 *   Fallback: if endpoint fails → hardcode Athena 5/9 morning data with source label
 *
 * Stage 2 (DEFER): equity curve / monthly bar / drawdown / Sharpe / win rate / sample trades
 *   → pending Athena schema ship
 *
 * HARD LINES:
 *   - No "已驗證" / "approved" / "可上線" / "strategy approved"
 *   - No caveat truncation
 *   - No fake metrics
 *   - No broker/execution/risk backend touch
 *   - Endpoint error → show specific reason, not generic "載入中"
 */

import Link from "next/link";
import { PageFrame } from "@/components/PageFrame";
import { getLabThreeStrategySnapshot } from "@/lib/api";
import type { LabThreeStrategyEntry } from "@/lib/api";

export const dynamic = "force-dynamic";

// ── Athena 5/9 morning truth overlay ──────────────────────────────────────────
// Source: athena morning 5/9 chat update
// Applied on top of endpoint data (which may reflect 5/7 stale state)

const ATHENA_5_9_SOURCE = "athena_morning_5_9_chat_update";
const ATHENA_5_9_DATE = "2026-05-09";

type BadgeVariant = "amber" | "blue" | "violet" | "gray";

type StrategyDisplayCard = {
  strategyId: string;
  displayName: string;
  tagline: string;
  badge: BadgeVariant;
  badgeLabel: string;
  governanceState: string;
  caveat: string;
  metricsLabel: string;
  isRetired: boolean;
  retiredReason?: string;
  dataSource: string;
};

// ── 5/9 override registry ──────────────────────────────────────────────────────
// These overrides reflect Athena 5/9 morning truth.
// When the endpoint ships updated schema, these will be replaced by live data.

type OverrideEntry = Omit<StrategyDisplayCard, "strategyId">;

const ATHENA_5_9_OVERRIDES: Record<string, OverrideEntry> = {
  // cont_liq v36 — 9/9 PASS + 四重魯棒
  cont_liquidity_relative_strength__h20__top5__turnover_cap_0.25: {
    displayName: "流動強勢延續策略 v36",
    tagline: "流動性相對強度選股，h20 持有期框架，前五名等權。v36 通過 9/9 驗證項目 + 四重魯棒性確認。",
    badge: "amber",
    badgeLabel: "9/9 PASS",
    governanceState: "cont_liq_v36 · 9/9 PASS + 四重魯棒 · forward observation 進行中",
    caveat:
      "9/9 驗證項目通過（截至 2026-05-09 Athena morning update）/ 四重魯棒：Horizon ±5d NEAR_PASS / Regime ±2% FULL_PASS / Cost 40-250bps script done / Universe K=68→20 PARTIAL（K≥50 liquid universe required）/ 仍需完整 forward observation 才算 process pass / 不是已驗證可上線策略 / capacity note: K≥50 流動性股票宇宙必要條件",
    metricsLabel: "research_only / 9/9 pass / forward obs pending",
    isRetired: false,
    dataSource: ATHENA_5_9_SOURCE,
  },
  // rs_20_60 — RETIRED (sector-pinned, family-level no-edge)
  rs_20_60_low_drawdown__h20__top5: {
    displayName: "穩健強勢低回撤策略",
    tagline: "rs_20_60 family — 因 sector-pinned 特性，family 層面 no-edge 確認，已退場。",
    badge: "gray",
    badgeLabel: "RETIRED",
    governanceState: "RETIRED · sector-pinned · family-level no-edge 2026-05-09",
    caveat:
      "rs_20_60 family 已於 2026-05-09 Athena morning update 正式退場（RETIRED）/ 根本原因：sector-pinned — 策略表現高度依賴特定板塊曝險，非獨立 alpha 來源 / family-level no-edge 確認 / 不再進行任何 forward observation 或 paper trade / 此 slot 未來由 Athena 新候選策略填補",
    metricsLabel: "RETIRED / no further observation",
    isRetired: true,
    retiredReason: "sector-pinned · family-level no-edge",
    dataSource: ATHENA_5_9_SOURCE,
  },
  // MAIN — unchanged from 5/7 (no specific 5/9 update)
  MAIN_execution_rank_buffer_top20: {
    displayName: "主控排序緩衝策略",
    tagline: "MAIN core research candidate — 執行強度排序緩衝，20 股候選池，sector/regime dependent。",
    badge: "blue",
    badgeLabel: "研究候選",
    governanceState: "MAIN · RESEARCH_CANDIDATE · core pilot role · strategy_002/003 walk-forward in progress (Task #400)",
    caveat:
      "MAIN 策略保持 RESEARCH_CANDIDATE 狀態 / strategy_002 + strategy_003 walk-forward + bootstrap CI 進行中（Task #400）/ 尚未進入 forward observation / sector/regime dependent — 非 clean stock-picking claim / 不是已驗證策略 / cash_order_path: BLOCKED_until_Yang_final_manual_ACK",
    metricsLabel: "research_only / not validated",
    isRetired: false,
    dataSource: ATHENA_5_9_SOURCE,
  },
};

// ── Fallback hardcode (used if endpoint fails entirely) ───────────────────────
// Source: athena_morning_5_9_chat_update

const FALLBACK_STRATEGIES: StrategyDisplayCard[] = [
  {
    strategyId: "cont_liquidity_relative_strength__h20__top5__turnover_cap_0.25",
    ...ATHENA_5_9_OVERRIDES["cont_liquidity_relative_strength__h20__top5__turnover_cap_0.25"],
  },
  {
    strategyId: "MAIN_execution_rank_buffer_top20",
    ...ATHENA_5_9_OVERRIDES["MAIN_execution_rank_buffer_top20"],
  },
  {
    strategyId: "rs_20_60_low_drawdown__h20__top5",
    ...ATHENA_5_9_OVERRIDES["rs_20_60_low_drawdown__h20__top5"],
  },
];

// ── Map endpoint strategy entry to display card ───────────────────────────────

function mapEntryToCard(entry: LabThreeStrategyEntry): StrategyDisplayCard {
  const override = ATHENA_5_9_OVERRIDES[entry.strategy_id];
  if (override) {
    return {
      strategyId: entry.strategy_id,
      ...override,
    };
  }

  // No override — use raw endpoint data with conservative display
  const isRetired =
    entry.pilot_status === "RETIRED" ||
    entry.latest_state?.toLowerCase().includes("retired");

  return {
    strategyId: entry.strategy_id,
    displayName: entry.display_name_zh || entry.strategy_id,
    tagline: entry.latest_state || "—",
    badge: isRetired ? "gray" : "amber",
    badgeLabel: isRetired ? "RETIRED" : entry.pilot_status ?? "READINESS_REVIEW",
    governanceState: entry.pilot_status ?? "READINESS_REVIEW_ONLY",
    caveat: entry.caveat || "詳細 caveat 待 Athena 更新",
    metricsLabel: "research_only / not validated",
    isRetired,
    dataSource: "embedded_lab_fixture",
  };
}

// ── CSS ────────────────────────────────────────────────────────────────────────

const BADGE_STYLES: Record<BadgeVariant, React.CSSProperties> = {
  amber: {
    background: "rgba(255, 184, 0, 0.13)",
    border: "1px solid rgba(255, 184, 0, 0.55)",
    color: "#ffb800",
  },
  blue: {
    background: "rgba(59, 130, 246, 0.13)",
    border: "1px solid rgba(59, 130, 246, 0.55)",
    color: "#60a5fa",
  },
  violet: {
    background: "rgba(139, 92, 246, 0.13)",
    border: "1px solid rgba(139, 92, 246, 0.5)",
    color: "#a78bfa",
  },
  gray: {
    background: "rgba(100, 100, 100, 0.12)",
    border: "1px solid rgba(140, 140, 140, 0.35)",
    color: "#888888",
  },
};

const CARD_ACCENT: Record<BadgeVariant, string> = {
  amber: "#ffb800",
  blue: "#60a5fa",
  violet: "#a78bfa",
  gray: "#666666",
};

const CARD_GLOW: Record<BadgeVariant, string> = {
  amber: "rgba(255,184,0,0.06)",
  blue: "rgba(59,130,246,0.06)",
  violet: "rgba(139,92,246,0.06)",
  gray: "rgba(100,100,100,0.04)",
};

// ── Sub-components ─────────────────────────────────────────────────────────────

function GovernanceBadge({ variant, label }: { variant: BadgeVariant; label: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "3px 10px",
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: 0.6,
        ...BADGE_STYLES[variant],
      }}
    >
      {label}
    </span>
  );
}

function RetiredBanner({ reason }: { reason?: string }) {
  return (
    <div
      style={{
        padding: "8px 12px",
        background: "rgba(140,140,140,0.06)",
        border: "1px solid rgba(140,140,140,0.22)",
        borderRadius: 5,
        marginBottom: 14,
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: "#888",
          letterSpacing: 0.5,
          marginBottom: 3,
          textTransform: "uppercase" as const,
          fontFamily: "var(--mono, monospace)",
        }}
      >
        策略已退場
      </div>
      <div style={{ fontSize: 12, color: "#666", lineHeight: 1.6 }}>
        {reason ?? "此策略已從候選名單中移除，不再進行觀察或 paper trade。"}
      </div>
    </div>
  );
}

function StrategyCard({ s }: { s: StrategyDisplayCard }) {
  const accent = CARD_ACCENT[s.badge];
  const glow = CARD_GLOW[s.badge];

  return (
    <article className="_strat-card" data-badge={s.badge} data-retired={s.isRetired ? "true" : "false"}>
      <div className="_strat-card-inner">
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 2,
            background: s.isRetired
              ? "rgba(140,140,140,0.25)"
              : "linear-gradient(90deg, " + accent + ", transparent 72%)",
            borderRadius: "8px 8px 0 0",
            opacity: 0.85,
          }}
        />
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 120,
            background: "radial-gradient(ellipse at 50% 0%, " + glow + ", transparent 65%)",
            pointerEvents: "none",
          }}
        />
        <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", height: "100%" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <GovernanceBadge variant={s.badge} label={s.badgeLabel} />
            <span
              style={{
                fontSize: 9,
                fontFamily: "var(--mono, monospace)",
                color: "#555",
                letterSpacing: 0.3,
                maxWidth: 120,
                textAlign: "right",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={s.strategyId}
            >
              {s.strategyId}
            </span>
          </div>
          <div style={{ marginBottom: 8 }}>
            <h2
              style={{
                margin: 0,
                fontSize: 22,
                fontWeight: 850,
                color: s.isRetired ? "#666" : "#f0f0f0",
                letterSpacing: -0.3,
                lineHeight: 1.2,
                fontFamily: "var(--sans-tc, sans-serif)",
                textDecoration: s.isRetired ? "line-through" : "none",
              }}
            >
              {s.displayName}
            </h2>
          </div>
          <p style={{ margin: "0 0 12px", fontSize: 13, color: s.isRetired ? "#555" : "#9aa0ab", lineHeight: 1.6, flexGrow: 1 }}>
            {s.tagline}
          </p>

          {s.isRetired && <RetiredBanner reason={s.retiredReason} />}

          <div
            style={{
              display: "flex",
              gap: 8,
              padding: "8px 0",
              borderTop: "1px solid rgba(255,255,255,0.06)",
              borderBottom: "1px solid rgba(255,255,255,0.06)",
              marginBottom: 12,
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            <span
              style={{
                fontSize: 10,
                fontFamily: "var(--mono, monospace)",
                color: "#555",
                letterSpacing: 0.3,
              }}
            >
              {s.metricsLabel}
            </span>
          </div>

          {!s.isRetired && (
            <div
              style={{
                padding: "10px 12px",
                background: "rgba(255,200,0,0.04)",
                border: "1px solid rgba(255,184,0,0.2)",
                borderRadius: 5,
                marginBottom: 16,
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: "#ffb800",
                  letterSpacing: 0.5,
                  marginBottom: 5,
                  textTransform: "uppercase" as const,
                  fontFamily: "var(--mono, monospace)",
                }}
              >
                注意事項（全文）
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: "#c8c8c8",
                  lineHeight: 1.75,
                  whiteSpace: "normal" as const,
                  overflow: "visible" as const,
                }}
              >
                {s.caveat}
              </div>
            </div>
          )}

          {s.isRetired ? (
            <div
              style={{
                fontSize: 11,
                fontFamily: "var(--mono, monospace)",
                color: "#555",
                borderTop: "1px solid rgba(255,255,255,0.05)",
                paddingTop: 8,
                marginTop: "auto",
              }}
            >
              退場 caveat
              <div
                style={{
                  fontSize: 11,
                  color: "#666",
                  lineHeight: 1.7,
                  marginTop: 4,
                  whiteSpace: "normal" as const,
                }}
              >
                {s.caveat}
              </div>
            </div>
          ) : (
            <Link
              href={"/lab/three-strategy/" + s.strategyId}
              className="_strat-cta"
              style={{ color: accent }}
            >
              進入 detail panel
              <span style={{ marginLeft: 5, fontSize: 14 }}>→</span>
            </Link>
          )}
        </div>
      </div>
    </article>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default async function LabThreeStrategyPage() {
  // Fetch from live endpoint
  let snapshot = await getLabThreeStrategySnapshot();
  let fetchError: string | null = null;
  let isStale = false;
  let cards: StrategyDisplayCard[];

  if (!snapshot) {
    fetchError =
      "lab snapshot endpoint 未回應或回傳 ok=false。顯示 Athena 5/9 morning fallback 資料。";
    cards = FALLBACK_STRATEGIES;
    isStale = true;
  } else {
    // Check staleness: created_at is 5/7, we know 5/9 has updates
    const createdAt = snapshot.created_at_taipei ?? "";
    isStale = !createdAt.startsWith("2026-05-09");

    if (snapshot.strategies.length === 0) {
      fetchError = "endpoint 回傳 strategies: [] (空陣列)。顯示 Athena 5/9 morning fallback 資料。";
      cards = FALLBACK_STRATEGIES;
    } else {
      // Map endpoint entries → display cards (with Athena 5/9 overlay)
      cards = snapshot.strategies.map(mapEntryToCard);
    }
  }

  const displaySource = isStale || !snapshot
    ? ATHENA_5_9_SOURCE
    : (snapshot?.meta?.schemaVersion ?? "embedded_lab_fixture");

  const displayDate = ATHENA_5_9_DATE;

  return (
    <PageFrame
      code="LAB"
      title="量化研究 / 三條策略狀態"
      sub="Athena truth board v1 / 邊跑邊修"
      note="本頁顯示 IUF Quant Lab 三條策略的真實治理狀態。所有 caveat 全文顯示，不截斷。不顯示已驗證、approved、可上線或任何背書字樣。"
    >
      <style>{`
        ._strat-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 20px;
          margin-bottom: 24px;
        }
        @media (max-width: 1024px) {
          ._strat-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }
        @media (max-width: 640px) {
          ._strat-grid { grid-template-columns: 1fr; gap: 14px; }
        }
        ._strat-card {
          position: relative;
          border-radius: 10px;
          border: 1px solid rgba(220,228,240,0.09);
          background: rgba(11,16,23,0.88);
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,0.028),
            0 8px 28px rgba(0,0,0,0.22);
          overflow: hidden;
          transition: transform 0.18s cubic-bezier(.2,.8,.2,1),
                      box-shadow 0.18s cubic-bezier(.2,.8,.2,1),
                      border-color 0.18s;
        }
        ._strat-card[data-retired="true"] {
          opacity: 0.52;
          filter: grayscale(0.7);
        }
        ._strat-card:not([data-retired="true"]):hover {
          transform: translateY(-4px);
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,0.04),
            0 18px 48px rgba(0,0,0,0.35);
        }
        ._strat-card[data-badge="amber"]:not([data-retired="true"]):hover { border-color: rgba(255,184,0,0.3); }
        ._strat-card[data-badge="blue"]:not([data-retired="true"]):hover  { border-color: rgba(59,130,246,0.3); }
        ._strat-card[data-badge="violet"]:not([data-retired="true"]):hover{ border-color: rgba(139,92,246,0.28); }
        ._strat-card::before {
          content: "";
          position: absolute;
          inset: 0;
          pointer-events: none;
          background:
            linear-gradient(rgba(220,228,240,0.018) 1px, transparent 1px),
            linear-gradient(90deg, rgba(220,228,240,0.018) 1px, transparent 1px);
          background-size: 32px 32px;
          opacity: 0.65;
          z-index: 0;
        }
        ._strat-card-inner {
          position: relative;
          padding: 20px 20px 18px;
          height: 100%;
          box-sizing: border-box;
          display: flex;
          flex-direction: column;
        }
        ._strat-cta {
          display: inline-flex;
          align-items: center;
          font-size: 12px;
          font-weight: 700;
          font-family: var(--mono, monospace);
          letter-spacing: 0.5px;
          text-decoration: none;
          border-bottom: 1px solid currentColor;
          padding-bottom: 1px;
          transition: opacity 0.14s;
          margin-top: auto;
        }
        ._strat-cta:hover { opacity: 0.72; }
        @media (prefers-reduced-motion: reduce) {
          ._strat-card { transition: none; }
          ._strat-card:not([data-retired="true"]):hover { transform: none; }
          ._strat-cta { transition: none; }
        }
      `}</style>

      {/* Stage 2 sync banner */}
      <div
        style={{
          padding: "8px 14px",
          marginBottom: 16,
          background: "rgba(59,130,246,0.04)",
          border: "1px solid rgba(59,130,246,0.18)",
          borderLeft: "3px solid #3b82f6",
          borderRadius: 5,
          fontSize: 11,
          color: "#60a5fa",
          lineHeight: 1.6,
        }}
      >
        Stage 1 live wiring 完成（2026-05-09）— 等 Athena Stage 1 contract ship 後將自動同步 caveat_verdicts 欄位。
        Stage 2（equity curve / monthly bar / Sharpe / win rate / sample trades）pending Athena schema ship。
      </div>

      {/* Fetch error / stale banner */}
      {(fetchError || isStale) && (
        <div
          style={{
            padding: "8px 14px",
            marginBottom: 16,
            background: "rgba(255,150,0,0.04)",
            border: "1px solid rgba(255,150,0,0.25)",
            borderLeft: "3px solid #f97316",
            borderRadius: 5,
            fontSize: 11,
            color: "#fb923c",
            lineHeight: 1.6,
          }}
        >
          {fetchError
            ? `資料層：${fetchError}`
            : `endpoint 資料為 5/7 版本（stale）— 套用 Athena 5/9 morning 覆蓋層 (${ATHENA_5_9_SOURCE})。等 endpoint 更新至 5/9 後 banner 將消失。`}
        </div>
      )}

      {/* Main disclaimer */}
      <section
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          padding: "12px 16px",
          marginBottom: 24,
          border: "1px solid rgba(220,60,60,0.35)",
          borderLeft: "3px solid #e05050",
          background: "rgba(220,60,60,0.04)",
          borderRadius: 5,
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: "#e05050",
            letterSpacing: 0.6,
            textTransform: "uppercase" as const,
            fontFamily: "var(--mono, monospace)",
          }}
        >
          重要聲明 — 此頁為邊跑邊修狀態
        </div>
        <div style={{ fontSize: 13, color: "#ddd", lineHeight: 1.6 }}>
          以下策略均為{" "}
          <strong style={{ color: "#ffb800" }}>研究狀態，尚未進入任何交易流程</strong>
          。無策略通過完整驗證。不顯示任何勝率、報酬率或配置建議。
        </div>
        <div style={{ fontSize: 11, color: "#888" }}>
          狀態來源 / {displaySource} · {displayDate} · 下次更新 / Athena 發布新 truth board 時
        </div>
      </section>

      <div className="_strat-grid">
        {cards.map((s) => (
          <StrategyCard key={s.strategyId} s={s} />
        ))}
      </div>

      <div
        style={{
          padding: "10px 14px",
          background: "rgba(18,18,22,0.5)",
          border: "1px solid rgba(100,100,100,0.18)",
          borderRadius: 5,
          fontSize: 11,
          color: "#666",
          lineHeight: 1.6,
          marginBottom: 16,
        }}
      >
        本頁只顯示候選狀態與限制。未驗證績效、配置比例與買賣建議不顯示（金額僅在各策略 detail panel 顯示，限 owner 可見）。
        治理資料來源：IUF Quant Lab / Athena / {displaySource}
      </div>

      <Link
        href="/lab/strategies"
        style={{ fontSize: 12, color: "#888", textDecoration: "underline" }}
      >
        ← 量化研究候選策略列表
      </Link>
    </PageFrame>
  );
}
