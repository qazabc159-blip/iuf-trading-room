import Link from "next/link";
import { ArrowRight, ShieldCheck } from "lucide-react";

import { PageFrame, Panel } from "@/components/PageFrame";
import styles from "./QuantStrategies.module.css";
import { QUANT_STRATEGIES, type QuantStrategy, type StrategyCurvePoint } from "./strategy-data";

export const dynamic = "force-dynamic";

function accentColor(accent: QuantStrategy["accent"]) {
  if (accent === "cyan") return "#5cc8ff";
  if (accent === "green") return "#58d68d";
  return "#e2b85c";
}

function pct(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function MiniSpark({ points, color }: { points: StrategyCurvePoint[]; color: string }) {
  const width = 260;
  const height = 74;
  const pad = 8;
  const values = points.map((point) => point.value);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 1);
  const range = max - min || 1;
  const line = points
    .map((point, index) => {
      const x = pad + (index / Math.max(points.length - 1, 1)) * (width - pad * 2);
      const y = height - pad - ((point.value - min) / range) * (height - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="74" role="img" aria-label="策略淨值縮圖">
      <polyline points={line} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} stroke="rgba(220,228,240,.14)" />
    </svg>
  );
}

function StrategyCard({ strategy }: { strategy: QuantStrategy }) {
  const color = accentColor(strategy.accent);
  const gateLabel = strategy.metrics.sharpe === null ? "WATCH" : "SIM OBS";

  return (
    <article className={styles.card} style={{ "--accent": color } as React.CSSProperties}>
      <div className={styles.cardBody}>
        <div className={styles.cardHead}>
          <div className={styles.iconMark}>{strategy.shortName.slice(0, 2).toUpperCase()}</div>
          <span className={styles.tag}>{gateLabel}</span>
        </div>

        <h2>{strategy.name}</h2>
        <p className={styles.role}>
          {strategy.role} / {strategy.cadence} / {strategy.basketSize}
        </p>
        <p className={styles.signal}>{strategy.signal}</p>

        <div className={styles.metricGrid}>
          <div className={styles.metric}>
            <span>量化分數</span>
            <strong>同步中</strong>
          </div>
          <div className={styles.metric}>
            <span>Regime</span>
            <strong>{strategy.role}</strong>
          </div>
          <div className={styles.metric}>
            <span>回測勝率</span>
            <strong>{pct(strategy.metrics.hitRatePct)}</strong>
          </div>
          <div className={styles.metric}>
            <span>最大回撤</span>
            <strong>{pct(strategy.metrics.maxDrawdownPct)}</strong>
          </div>
        </div>

        <div className={styles.spark}>
          <MiniSpark points={strategy.curve} color={color} />
        </div>

        <div className={styles.notice} style={{ marginBottom: 12 }}>
          <ShieldCheck size={15} strokeWidth={1.9} /> SIM-only v1 / {strategy.current.status}
        </div>

        <Link className={styles.cta} href={`/quant-strategies/${strategy.id}`}>
          檢視策略與 SIM 配置 <ArrowRight size={16} strokeWidth={1.9} />
        </Link>
      </div>
    </article>
  );
}

export default function QuantStrategiesPage() {
  return (
    <PageFrame
      code="QNT"
      title="量化策略"
      sub="Athena 訊號 / SIM-only"
      note="v1 僅顯示 SIM 執行路徑；正式交易 lane 不出現在此頁。量化分數欄位等 Jason endpoint 回傳後才顯示數字。"
    >
      <style>{`
        ._qnt-tabs {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-bottom: 16px;
        }
        ._qnt-tabs a {
          min-height: 36px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border: 1px solid var(--tac-line);
          border-radius: 6px;
          padding: 0 12px;
          color: var(--tac-fg-1);
          background: rgba(8, 11, 16, 0.52);
          font: 800 11px/1 var(--mono);
          text-decoration: none;
        }
        ._qnt-tabs a:hover {
          color: var(--tac-fg-0);
          border-color: rgba(200, 148, 63, 0.42);
          background: rgba(200, 148, 63, 0.08);
        }
        ._qnt-banner {
          margin: 0 16px 14px;
          border: 1px solid rgba(220, 143, 55, 0.34);
          border-left: 3px solid var(--tac-warn);
          border-radius: 8px;
          padding: 11px 13px;
          color: var(--tac-fg-1);
          background: rgba(220, 143, 55, 0.075);
          font-size: 12px;
          line-height: 1.55;
        }
        ._qnt-grid-wrap {
          padding: 0 16px 16px;
        }
      `}</style>

      <div className="_qnt-tabs" aria-label="量化策略子頁">
        <Link href="/lab/three-strategy">Athena 三策略</Link>
        <Link href="/lab/strategies">Lab 策略清單</Link>
      </div>

      <Panel code="QNT-01" title="策略列表" sub="策略分數、回測風險與 SIM-only 配置。">
        <div className="_qnt-banner">
          <b className="tg gold">SIM 帳戶執行中</b> / v1 只開放模擬帳戶，不提供正式交易切換。
        </div>
        <div className="_qnt-grid-wrap">
          <div className={styles.grid}>
            {QUANT_STRATEGIES.map((strategy) => (
              <StrategyCard key={strategy.id} strategy={strategy} />
            ))}
          </div>
        </div>
      </Panel>
    </PageFrame>
  );
}
