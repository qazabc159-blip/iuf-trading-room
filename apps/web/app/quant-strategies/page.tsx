import Link from "next/link";
import { ArrowRight, ShieldCheck } from "lucide-react";
import type { CSSProperties } from "react";

import { PageFrame, Panel } from "@/components/PageFrame";
import { TrackRecordDisclosure } from "@/components/TrackRecordDisclosure";
import styles from "./QuantStrategies.module.css";
import { loadQuantStrategies } from "./live-strategy-data";
import type { DisplayStatus, QuantStrategy, StrategyCurvePoint } from "./strategy-data";
import { QuantSubsPanel } from "./QuantSubsPanel";

export const dynamic = "force-dynamic";

function accentColor(accent: QuantStrategy["accent"]) {
  if (accent === "cyan") return "#5cc8ff";
  if (accent === "green") return "#58d68d";
  return "#e2b85c";
}

function pct(value: number | null) {
  if (value == null) return "--";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

const DISPLAY_STATUS_MAP: Record<
  NonNullable<DisplayStatus>,
  { label: string; color: string; border: string; bg: string }
> = {
  PASS: {
    label: "可執行",
    color: "#58d68d",
    border: "rgba(88,214,141,0.45)",
    bg: "rgba(88,214,141,0.10)",
  },
  WATCH: {
    label: "觀察中",
    color: "#e2b85c",
    border: "rgba(226,184,92,0.45)",
    bg: "rgba(226,184,92,0.10)",
  },
  FAIL: {
    label: "暫停",
    color: "#e63946",
    border: "rgba(230,57,70,0.45)",
    bg: "rgba(230,57,70,0.10)",
  },
};

const NULL_STATUS = {
  label: "未定",
  color: "#8899aa",
  border: "rgba(136,153,170,0.35)",
  bg: "rgba(136,153,170,0.08)",
};

function DisplayStatusBadge({ status }: { status: DisplayStatus }) {
  const s = status !== null ? DISPLAY_STATUS_MAP[status] : NULL_STATUS;
  return (
    <span
      style={{
        border: `1px solid ${s.border}`,
        borderRadius: 999,
        color: s.color,
        background: s.bg,
        fontFamily: "var(--mono)",
        fontSize: 11,
        padding: "4px 8px",
        whiteSpace: "nowrap",
        fontWeight: 700,
      }}
    >
      {s.label}
    </span>
  );
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
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="74" role="img" aria-label="S1 forward observation curve">
      <polyline points={line} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} stroke="rgba(220,228,240,.14)" />
    </svg>
  );
}

function StrategyCard({ strategy }: { strategy: QuantStrategy }) {
  const color = accentColor(strategy.accent);
  const hasCurve = strategy.curve.length > 0;

  return (
    <article className={`${styles.card} ${styles.cardHoverable}`} style={{ "--accent": color } as CSSProperties}>
      <div className={styles.cardBody}>
        <div className={styles.cardHead}>
          <div className={styles.iconMark}>{strategy.shortName}</div>
          <DisplayStatusBadge status={strategy.displayStatus} />
        </div>

        <h2>{strategy.name}</h2>
        <p className={styles.role}>
          {strategy.role} / {strategy.cadence} / {strategy.basketSize}
        </p>
        <p className={styles.signal}>{strategy.signal}</p>

        {strategy.realSimReturnPct != null && (
          <div
            className={styles.metric}
            style={{ marginBottom: 10, borderColor: "rgba(220,228,240,0.14)" }}
          >
            <span>S1 F-AUTO 實盤模擬（含成本）</span>
            <strong style={{ color: strategy.realSimReturnPct >= 0 ? "var(--tw-up-bright)" : "var(--tw-dn-bright)", fontSize: 20 }}>
              {pct(strategy.realSimReturnPct)}
            </strong>
            <small className={styles.metricHint}>KGI SIM 實際下單累積損益，非回測示意。</small>
          </div>
        )}

        <div className={styles.metricGrid}>
          <div className={styles.metric}>
            <span>產品狀態</span>
            <strong>S1 Only</strong>
            <small className={styles.metricHint}>目前正式量化只開 S1，不再混入其他研究策略。</small>
          </div>
          <div className={styles.metric}>
            <span>SIM 資金</span>
            <strong>{strategy.current.primaryReadout.split(" / ")[0]}</strong>
            <small className={styles.metricHint}>{strategy.current.primaryReadout}</small>
          </div>
          <div className={styles.metric}>
            <span>命中率（研究回測）</span>
            <strong>{pct(strategy.metrics.hitRatePct)}</strong>
          </div>
          <div className={styles.metric}>
            <span>最大回撤（研究回測）</span>
            <strong>{pct(strategy.metrics.maxDrawdownPct)}</strong>
          </div>
        </div>

        {(strategy.metrics.hitRatePct != null || strategy.metrics.maxDrawdownPct != null) && (
          <TrackRecordDisclosure
            isLiveVerifiedTrackRecord={strategy.trackRecord.isLiveVerifiedTrackRecord}
            headlineDisclosureZh={strategy.trackRecord.headlineDisclosureZh}
            compact
          />
        )}

        {hasCurve ? (
          <div className={styles.spark}>
            <MiniSpark points={strategy.curve} color={color} />
          </div>
        ) : (
          <div className={styles.notice}>核准研究曲線目前無法讀取，頁面不顯示示意數字。</div>
        )}

        <div className={styles.notice} style={{ marginBottom: 12 }}>
          <ShieldCheck size={15} strokeWidth={1.9} /> SIM-only / real order disabled / KGI SIM observation.
        </div>
        <div className={styles.notice} style={{ marginBottom: 12 }}>
          <strong>{strategy.current.dataState}</strong> / {strategy.current.sourceLabel}
          {strategy.current.asOf ? ` / 最新 basket ${strategy.current.asOf}` : ""}
          {strategy.current.researchWindow ? ` / 研究窗 ${strategy.current.researchWindow}` : ""}
        </div>

        <Link className={styles.cta} href={`/quant-strategies/${strategy.id}`}>
          設定 S1 SIM 資金 <ArrowRight size={16} strokeWidth={1.9} />
        </Link>
      </div>
    </article>
  );
}

export default async function QuantStrategiesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const tab = typeof params.tab === "string" ? params.tab : "strategies";
  const isSubsTab = tab === "subscriptions";
  const strategies = isSubsTab ? [] : await loadQuantStrategies();

  return (
    <PageFrame
      code="QNT"
      title="量化策略"
      sub="S1 F-AUTO / KGI SIM"
      note="目前正式產品只開 S1。其他研究策略先留在 Lab，不混進正式量化頁。"
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
        ._qnt-tabs a[data-active="true"] {
          color: #e2b85c;
          border-color: rgba(200, 148, 63, 0.55);
          background: rgba(200, 148, 63, 0.13);
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
        /* Mobile M3 (2026-07-09): 36px tab links are under the 44px touch
           target baseline on 390px phones. */
        @media (max-width: 480px) {
          ._qnt-tabs a {
            min-height: 44px;
          }
        }
      `}</style>

      <div className="_qnt-tabs" aria-label="量化策略分頁">
        <Link href="/quant-strategies" data-active={!isSubsTab ? "true" : "false"}>
          S1 策略
        </Link>
        <Link href="/quant-strategies?tab=subscriptions" data-active={isSubsTab ? "true" : "false"}>
          資金配置紀錄
        </Link>
        <Link href="/ops/f-auto">
          開啟 F-AUTO 持倉與損益
        </Link>
      </div>

      {isSubsTab ? (
        <Panel code="QNT-SUBS" title="S1 資金配置紀錄" sub="從後端 audit log 讀取最新 SIM-only 設定">
          <QuantSubsPanel />
        </Panel>
      ) : (
        <Panel code="QNT-01" title="S1 F-AUTO" sub="唯一正式量化策略，接 KGI SIM 觀察線">
          <div className="_qnt-banner">
            <b className="tg gold">SIM-only guard</b> / 這裡配置的是 F-AUTO/S1 的模擬資金，不會開啟真實委託。資金會由後端 S1 runner 讀取並用於下一次 basket sizing。
          </div>
          <div className="_qnt-grid-wrap">
            <div className={styles.grid}>
              {strategies.map((strategy) => (
                <StrategyCard key={strategy.id} strategy={strategy} />
              ))}
            </div>
          </div>
        </Panel>
      )}
    </PageFrame>
  );
}
