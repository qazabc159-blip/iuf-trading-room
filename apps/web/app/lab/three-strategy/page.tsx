/**
 * /lab/three-strategy page upgraded 2026-05-09
 * Product-grade 3-column cards (Yang ack item 3)
 * Source: athena_truth_board_v1 (2026-05-08)
 *
 * HARD LINES:
 *   - No "已驗證" / "approved" / "可上線" / "strategy approved"
 *   - No caveat truncation
 *   - No fake metrics
 *   - No broker/execution/risk backend touch
 *
 * Three strategies (updated per task spec):
 *   cont_liq_h20_top3  → amber / L9_MARGINAL_PASS
 *   strategy_002_rev   → blue  / PAPER_LIVE_OBSERVING (2026-05-09)
 *   strategy_003_ma200 → violet / BACKTESTED_RAW
 */

import Link from "next/link";
import { PageFrame } from "@/components/PageFrame";

export const dynamic = "force-dynamic";

const TRUTH_BOARD_SOURCE = "athena_truth_board_v1 (2026-05-08)";

type BadgeVariant = "amber" | "blue" | "violet";

type StrategyMeta = {
  strategyId: string;
  displayName: string;
  tagline: string;
  badge: BadgeVariant;
  badgeLabel: string;
  governanceState: string;
  caveat: string;
  metricsLabel: string | null;
  sharpeNote: string | null;
  winRateNote: string | null;
  maxDdNote: string | null;
};

const THREE_STRATEGIES: StrategyMeta[] = [
  {
    strategyId: "cont_liq_h20_top3_market_trail20_gt_5pct",
    displayName: "流動順勢三強",
    tagline: "持有流動性相對強的前三名股票，等市場落後再進場，20 個交易日換倉一次。",
    badge: "amber",
    badgeLabel: "觀察中",
    governanceState: "L9_MARGINAL_PASS + forward observation pending",
    caveat:
      "Bonferroni p=0.048 borderline（非 p<0.001）/ CPCV PBO 18.2% borderline（非 <5%）/ DSR（deflated Sharpe）計算中 / 需 >=12 個 matured h20 forward observation 才算 process pass / 不是已驗證策略 / 僅通過 strict gate，不代表策略已驗證可上線",
    metricsLabel: "research_only / not validated",
    sharpeNote: "待 >=12 obs 後計算",
    winRateNote: "待觀察期完成",
    maxDdNote: "回測僅供參考",
  },
  {
    strategyId: "strategy_002_revenue_yoy_surprise",
    displayName: "營收動能驚喜",
    tagline: "選出營收年增率大幅優於預期的個股，捕捉市場對基本面修正的動能。",
    badge: "blue",
    badgeLabel: "Paper 觀察中",
    governanceState: "PAPER_LIVE_OBSERVING (2026-05-09 起)",
    caveat:
      "2026-05-09 起進入 paper live 觀察階段 / 尚無 matured forward observation / 回測數字僅供研究用，未通過完整 L9 gate / 不是已驗證策略 / 金額不顯示（detail panel 才顯示）",
    metricsLabel: "paper_observing / backtested_raw",
    sharpeNote: "paper 期間累積",
    winRateNote: "paper 期間累積",
    maxDdNote: "回測僅供參考",
  },
  {
    strategyId: "strategy_003_ma200_trend_follow",
    displayName: "200 日均線順勢",
    tagline: "追蹤股價站穩 200 日均線的個股，順大趨勢方向持有，依 cache 換倉。",
    badge: "violet",
    badgeLabel: "回測原始",
    governanceState: "BACKTESTED_RAW + cache 短（尚未 forward test）",
    caveat:
      "僅有回測數字，尚未進行 forward observation / cache 持有期較短，換倉頻率敏感 / 未通過 L9 gate / 不是已驗證策略 / 研究中，下一步需 forward test 設計",
    metricsLabel: "research_only / backtested_raw",
    sharpeNote: "回測僅供參考",
    winRateNote: "回測僅供參考",
    maxDdNote: "回測僅供參考",
  },
];

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
};

const CARD_ACCENT: Record<BadgeVariant, string> = {
  amber: "#ffb800",
  blue: "#60a5fa",
  violet: "#a78bfa",
};

const CARD_GLOW: Record<BadgeVariant, string> = {
  amber: "rgba(255,184,0,0.06)",
  blue: "rgba(59,130,246,0.06)",
  violet: "rgba(139,92,246,0.06)",
};

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

function MetricCell({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 80 }}>
      <span
        style={{
          fontSize: 10,
          color: "#666",
          fontFamily: "var(--mono, monospace)",
          letterSpacing: 0.4,
          textTransform: "uppercase" as const,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 12,
          color: "#a0a0a0",
          fontFamily: "var(--mono, monospace)",
          fontWeight: 600,
        }}
      >
        {value}
      </span>
    </div>
  );
}

function StrategyCard({ s }: { s: StrategyMeta }) {
  const accent = CARD_ACCENT[s.badge];
  const glow = CARD_GLOW[s.badge];

  return (
    <article className="_strat-card" data-badge={s.badge}>
      <div className="_strat-card-inner">
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 2,
            background: "linear-gradient(90deg, " + accent + ", transparent 72%)",
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
                color: "#f0f0f0",
                letterSpacing: -0.3,
                lineHeight: 1.2,
                fontFamily: "var(--sans-tc, sans-serif)",
              }}
            >
              {s.displayName}
            </h2>
          </div>
          <p style={{ margin: "0 0 16px", fontSize: 13, color: "#9aa0ab", lineHeight: 1.6, flexGrow: 1 }}>
            {s.tagline}
          </p>
          <div
            style={{
              display: "flex",
              gap: 20,
              padding: "10px 0",
              borderTop: "1px solid rgba(255,255,255,0.06)",
              borderBottom: "1px solid rgba(255,255,255,0.06)",
              marginBottom: 14,
              flexWrap: "wrap",
            }}
          >
            <MetricCell label="Sharpe" value={s.sharpeNote} />
            <MetricCell label="勝率" value={s.winRateNote} />
            <MetricCell label="Max DD" value={s.maxDdNote} />
            {s.metricsLabel && (
              <span
                style={{
                  alignSelf: "center",
                  marginLeft: "auto",
                  fontSize: 10,
                  fontFamily: "var(--mono, monospace)",
                  color: "#555",
                  letterSpacing: 0.3,
                  whiteSpace: "nowrap",
                }}
              >
                {s.metricsLabel}
              </span>
            )}
          </div>
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
          <Link
            href={"/lab/three-strategy/" + s.strategyId}
            className="_strat-cta"
            style={{ color: accent }}
          >
            進入 detail panel
            <span style={{ marginLeft: 5, fontSize: 14 }}>→</span>
          </Link>
        </div>
      </div>
    </article>
  );
}

export default function LabThreeStrategyPage() {
  return (
    <PageFrame
      code="LAB"
      title="量化研究 / 三條策略狀態"
      sub="Athena truth board v1 / 邊跑邊修"
      note="本頁顯示 IUF Quant Lab 三條策略的真實治理狀態，來源為 Athena truth board v1 (2026-05-08)。所有 caveat 全文顯示，不截斷。不顯示已驗證、approved、可上線或任何背書字樣。"
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
        ._strat-card:hover {
          transform: translateY(-4px);
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,0.04),
            0 18px 48px rgba(0,0,0,0.35);
        }
        ._strat-card[data-badge="amber"]:hover { border-color: rgba(255,184,0,0.3); }
        ._strat-card[data-badge="blue"]:hover  { border-color: rgba(59,130,246,0.3); }
        ._strat-card[data-badge="violet"]:hover{ border-color: rgba(139,92,246,0.28); }
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
          ._strat-card:hover { transform: none; }
          ._strat-cta { transition: none; }
        }
      `}</style>

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
          以下 3 條策略均為{" "}
          <strong style={{ color: "#ffb800" }}>研究狀態，尚未進入任何交易流程</strong>
          。無策略通過完整驗證。不顯示任何勝率、報酬率或配置建議（金額見各策略 detail panel）。
        </div>
        <div style={{ fontSize: 11, color: "#888" }}>
          狀態來源 / {TRUTH_BOARD_SOURCE} · 下次更新 / 2026-05-15 或 Athena 發布新 truth board 時
        </div>
      </section>

      <div className="_strat-grid">
        {THREE_STRATEGIES.map((s) => (
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
        本頁只顯示候選狀態與限制。未驗證績效、配置比例與買賣建議不顯示（金額僅在各策略 detail panel 顯示，限 owner 可見）。治理資料來源：IUF Quant Lab / Athena truth board v1 / dm_2026_05_08_athena_yang_truth_board_v1.md
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
