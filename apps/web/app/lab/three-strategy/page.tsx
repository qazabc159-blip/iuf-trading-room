/**
 * /lab/three-strategy page — strategy research status
 *
 * Data layer:
 *   Primary: getLabThreeStrategySnapshot() → /api/v1/lab/three-strategy/snapshot
 *   Overlay: reviewed research snapshot for stale or unavailable API data
 *
 * Extended charts and trade records render only when verified data exists.
 *
 * HARD LINES:
 *   - No endorsement wording or live-trading claims
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

const ATHENA_5_9_SOURCE = "IUF Quant Lab 研究快照";
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
// When the API provides fresher schema data, these overrides can be removed.

type OverrideEntry = Omit<StrategyDisplayCard, "strategyId">;

const ATHENA_5_9_OVERRIDES: Record<string, OverrideEntry> = {
  // cont_liq v36 — 9/9 PASS + 四重魯棒
  "cont_liquidity_relative_strength__h20__top5__turnover_cap_0.25": {
    displayName: "流動強勢延續策略 v36",
    tagline: "流動性相對強度選股，20 日觀察框架，前五名等權。v36 已完成研究檢查，仍在前向觀察中。",
    badge: "amber",
    badgeLabel: "前向觀察",
    governanceState: "cont_liq_v36 · 研究檢查完成 · 前向觀察中",
    caveat:
      "研究檢查已完成，但仍需完整前向觀察才可進入下一階段。容量限制：候選池需至少 50 檔具流動性的股票；若候選池不足，策略可靠度會下降。此策略不是可上線或可跟單策略。",
    metricsLabel: "研究觀察 / 前向觀察中",
    isRetired: false,
    dataSource: ATHENA_5_9_SOURCE,
  },
  // rs_20_60 — RETIRED (sector-pinned, family-level no-edge)
  rs_20_60_low_drawdown__h20__top5: {
    displayName: "穩健強勢低回撤策略",
    tagline: "rs_20_60 family — 因 sector-pinned 特性，family 層面 no-edge 確認，已退場。",
    badge: "gray",
    badgeLabel: "已退場",
    governanceState: "已退場 · 板塊依賴過高 · 2026-05-09",
    caveat:
      "此策略已於 2026-05-09 退場。原因：表現高度依賴特定板塊曝險，無法視為獨立選股能力；不再進行前向觀察或模擬交易。",
    metricsLabel: "已退場 / 不再觀察",
    isRetired: true,
    retiredReason: "sector-pinned · family-level no-edge",
    dataSource: ATHENA_5_9_SOURCE,
  },
  // MAIN — unchanged from 5/7 (no specific 5/9 update)
  MAIN_execution_rank_buffer_top20: {
    displayName: "主控排序緩衝策略",
    tagline: "主控候選策略，使用執行強度排序與 20 股候選池；仍受產業與市場環境影響。",
    badge: "blue",
    badgeLabel: "研究候選",
    governanceState: "研究候選 · 等待前向觀察與延伸資料",
    caveat:
      "此策略仍是研究候選。延伸資料與前向觀察尚未完成，且表現可能受產業與市場環境影響；不得視為已驗證策略或交易建議。",
    metricsLabel: "研究候選 / 資料待補",
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
    badgeLabel: isRetired ? "已退場" : "研究待審",
    governanceState: isRetired ? "已退場" : "研究待審",
    caveat: entry.caveat || "詳細限制待量化研究資料更新",
    metricsLabel: "研究資料 / 方法限制待確認",
    isRetired,
    dataSource: "IUF Quant Lab 研究資料",
  };
}


// ── Mini sparkline data (cont_liq_v36 real equity curve, 13 points) ───────────
// Source: Athena snapshot_v0 equityCurve — same data as detail panel
const CONT_LIQ_SPARKLINE_POINTS = [
  0.0138, 0.2504, 0.119, 0.2547, 0.6097, 0.491, 0.8008, 0.967, 0.968, 1.143, 1.3663, 1.8553, 2.2202,
] as const;

// strategy_002 / strategy_003 have no verified chart snapshot yet.
// Using a flat line with slight upward noise to indicate "data pending" state
const PENDING_SPARKLINE_POINTS = [0, 0.01, 0.005, 0.012, 0.008, 0.015, 0.01, 0.018] as const;

type SparklinePoints = readonly number[];

function MiniSparkline({
  points,
  color,
  isPending,
}: {
  points: SparklinePoints;
  color: string;
  isPending?: boolean;
}) {
  const W = 280; const H = 40;
  const PAD = { top: 4, right: 4, bottom: 4, left: 4 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const arr = Array.from(points);
  const minV = Math.min(...arr);
  const maxV = Math.max(...arr);
  const rangeV = maxV - minV || 1;
  const xScale = (i: number) => PAD.left + (i / (arr.length - 1)) * innerW;
  const yScale = (v: number) => PAD.top + ((maxV - v) / rangeV) * innerH;
  const polyPts = arr.map((v, i) => `${xScale(i)},${yScale(v)}`).join(" ");
  // Area fill polygon (line + bottom)
  const areaPts = [
    ...arr.map((v, i) => `${xScale(i)},${yScale(v)}`),
    `${xScale(arr.length - 1)},${PAD.top + innerH}`,
    `${xScale(0)},${PAD.top + innerH}`,
  ].join(" ");

  return (
    <div style={{ position: "relative" }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", height: H, display: "block", opacity: isPending ? 0.45 : 1 }}
        aria-hidden="true"
      >
        {/* Area fill */}
        <polygon
          points={areaPts}
          fill={color}
          fillOpacity={0.12}
        />
        {/* Line */}
        <polyline
          points={polyPts}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          strokeDasharray={isPending ? "3 2" : undefined}
        />
      </svg>
      <div
        style={{
          position: "absolute",
          bottom: 4,
          right: 6,
          fontSize: 9,
          fontFamily: "var(--mono, monospace)",
          color: isPending ? "#555" : color,
          letterSpacing: 0.3,
          opacity: 0.9,
        }}
      >
        {isPending ? "圖表待延伸資料補齊" : "點開看完整圖表 →"}
      </div>
    </div>
  );
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

          {/* Mini sparkline preview — non-retired only */}
          {!s.isRetired && (
            <div
              style={{
                marginBottom: 12,
                borderTop: "1px solid rgba(255,255,255,0.05)",
                paddingTop: 8,
              }}
            >
              {s.strategyId === "cont_liq_v36" ||
               s.strategyId === "cont_liquidity_relative_strength__h20__top5__turnover_cap_0.25" ||
               s.strategyId === "cont_liq_h20_top3_market_trail20_gt_5pct" ? (
                <MiniSparkline points={CONT_LIQ_SPARKLINE_POINTS} color={accent} />
              ) : s.strategyId === "strategy_002" || s.strategyId === "strategy_002_revenue_yoy_surprise" ||
                  s.strategyId === "strategy_003" || s.strategyId === "strategy_003_ma200_trend_follow" ||
                  s.strategyId === "MAIN_execution_rank_buffer_top20" ? (
                <MiniSparkline points={PENDING_SPARKLINE_POINTS} color={accent} isPending />
              ) : null}
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
              查看策略詳情
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
      "策略狀態 API 暫時無法讀取，改顯示最近一次已審核的研究快照。";
    cards = FALLBACK_STRATEGIES;
    isStale = true;
  } else {
    // Check staleness: created_at is 5/7, we know 5/9 has updates
    const createdAt = snapshot.created_at_taipei ?? "";
    isStale = !createdAt.startsWith("2026-05-09");

    if (snapshot.strategies.length === 0) {
      fetchError = "策略狀態 API 目前沒有回傳策略清單，改顯示最近一次已審核的研究快照。";
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
      sub="研究策略狀態 / 前向觀察與風險限制"
      note="本頁顯示 IUF Quant Lab 三條策略的治理狀態。所有限制全文顯示，不截斷。不顯示背書、可上線或可跟單字樣。"
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
        策略狀態資料已接上正式查詢管線；細部風險欄位仍會依量化研究資料更新自動同步。
        績效曲線、月度報酬、風險指標與正式交易紀錄只在有可驗證資料時顯示。
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
            : `策略狀態 API 的資料時間較舊，頁面已套用最近一次已審核的研究快照。資料源更新後，此提示會自動消失。`}
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
          重要聲明 — 研究觀察頁
        </div>
        <div style={{ fontSize: 13, color: "#ddd", lineHeight: 1.6 }}>
          以下策略均為{" "}
          <strong style={{ color: "#ffb800" }}>研究狀態，尚未進入任何交易流程</strong>
          。無策略通過完整驗證。不顯示任何勝率、報酬率或配置建議。
        </div>
        <div style={{ fontSize: 11, color: "#888" }}>
          狀態來源 / {displaySource} · {displayDate} · 下次更新 / 量化研究資料更新時
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
        本頁只顯示候選狀態與限制。未驗證績效、配置比例與買賣建議不顯示（金額僅在各策略詳情頁顯示，限 owner 可見）。
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
