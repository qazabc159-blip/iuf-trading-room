import Link from "next/link";
import { ArrowRight, Database, ShieldCheck } from "lucide-react";

import { PageFrame, Panel } from "@/components/PageFrame";
import { friendlyDataError } from "@/lib/friendly-error";
import {
  labStatusDisplayWording,
  radarLabApi,
  type LabStrategiesResponse,
  type LabStrategyCandidate,
} from "@/lib/radar-lab";
import styles from "./QuantStrategies.module.css";
import { QUANT_STRATEGIES, type QuantStrategy, type StrategyCurvePoint, type DisplayStatus } from "./strategy-data";
import { QuantSubsPanel } from "./QuantSubsPanel";

export const dynamic = "force-dynamic";

function accentColor(accent: QuantStrategy["accent"]) {
  if (accent === "cyan") return "#5cc8ff";
  if (accent === "green") return "#58d68d";
  return "#e2b85c";
}

function pct(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

const QUANT_SCORE_PENDING_LABEL = "待正式分數";
const QUANT_SCORE_PENDING_HINT = "等待正式資料源";

type StrategyCardView = QuantStrategy & {
  labCandidate?: LabStrategyCandidate;
  labStatusWording?: string;
};

const STRATEGY_LAB_MATCHERS: Record<string, (candidate: LabStrategyCandidate) => boolean> = {
  cont_liq_v36: (candidate) => /cont[_-]?liquidity|cont[_-]?liq/i.test(candidate.strategyId),
  class5_revenue_momentum: (candidate) => /class5|revenue|monthly/i.test(candidate.strategyId),
  family_c_sbl_overlay: (candidate) => /family[_\s-]?c|tdcc|sbl/i.test(candidate.strategyId),
};

function normalizedDisplayStatus(candidate: LabStrategyCandidate, fallback: DisplayStatus): DisplayStatus {
  if (!("displayStatus" in candidate) || candidate.displayStatus == null) return fallback;
  return candidate.displayStatus === "PASS" || candidate.displayStatus === "WATCH" || candidate.displayStatus === "FAIL"
    ? candidate.displayStatus
    : null;
}

function attachLabCandidates(strategies: QuantStrategy[], candidates: LabStrategyCandidate[]): StrategyCardView[] {
  return strategies.map((strategy) => {
    const matcher = STRATEGY_LAB_MATCHERS[strategy.id];
    const labCandidate = matcher ? candidates.find(matcher) : undefined;
    if (!labCandidate) return strategy;

    return {
      ...strategy,
      displayStatus: normalizedDisplayStatus(labCandidate, strategy.displayStatus),
      labCandidate,
      labStatusWording: labStatusDisplayWording(labCandidate.status),
    };
  });
}

function candidateName(candidate: LabStrategyCandidate) {
  if (candidate.strategyId === "MAIN_execution_rank_buffer_top20") return "主排序候選池";
  if (candidate.strategyId === "rs_20_60_low_drawdown__h20__top5") return "20/60 強弱低回撤";
  if (candidate.strategyId.includes("cont_liquidity_relative_strength")) return "連續流動性強弱";
  return candidate.displayName || candidate.strategyId;
}

const LAB_CANDIDATE_NAME_MAX = 72;
const LAB_CANDIDATE_STATUS_MAX = 56;

function compactLabCandidateText(value: string, maxLength: number) {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, Math.max(0, maxLength - 3))}...`;
}

function formatTimestamp(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

const DISPLAY_STATUS_MAP: Record<
  NonNullable<DisplayStatus>,
  { label: string; color: string; border: string; bg: string }
> = {
  PASS: {
    label: "研究閘通過（SIM-only）",
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
    label: "未通過驗證",
    color: "#e63946",
    border: "rgba(230,57,70,0.45)",
    bg: "rgba(230,57,70,0.10)",
  },
};

const NULL_STATUS = {
  label: "研究中",
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
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="74" role="img" aria-label="策略淨值縮圖">
      <polyline points={line} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} stroke="rgba(220,228,240,.14)" />
    </svg>
  );
}

function LabCandidateStrip({
  candidates,
  payload,
  fetchError,
}: {
  candidates: LabStrategyCandidate[];
  payload: LabStrategiesResponse | null;
  fetchError: string | null;
}) {
  const meta = payload?.meta;
  const isSanctioned = meta?.source === "lab_sanctioned" && candidates.length > 0;

  return (
    <div className={isSanctioned ? styles.labSync : `${styles.labSync} ${styles.labSyncMuted}`}>
      <div className={styles.labSyncHead}>
        <div>
          <span className={styles.labSyncKicker}>LAB 核准快照</span>
          <strong>{isSanctioned ? "Athena 候選策略已同步" : "Lab 候選策略暫未同步"}</strong>
        </div>
        <div className={styles.labSyncStats} aria-label="Lab 快照資訊">
          <span>{meta?.sprintId ?? payload?.data?.sprintId ?? "-"}</span>
          <span>{isSanctioned ? `${candidates.length} 組候選` : "本機備援"}</span>
          <span>{formatTimestamp(meta?.collectedAt ?? payload?.data?.collectedAt)}</span>
        </div>
      </div>

      {fetchError ? (
        <p className={styles.labSyncCopy}>{fetchError}</p>
      ) : isSanctioned ? (
        <>
          <p className={styles.labSyncCopy}>
            這裡只讀取 Lab governance 釋出的 research-only snapshot；狀態照 Lab 原文保存，不在前端改名成可交易訊號。
          </p>
          <div className={styles.labCandidateList}>
            {candidates.map((candidate) => {
              const fullName = candidateName(candidate);
              const fullStatus = labStatusDisplayWording(candidate.status);
              const displayName = compactLabCandidateText(fullName, LAB_CANDIDATE_NAME_MAX);
              const displayStatus = compactLabCandidateText(fullStatus, LAB_CANDIDATE_STATUS_MAX);

              return (
                <div
                  key={candidate.strategyId}
                  className={styles.labCandidate}
                  title={`${fullName} / ${fullStatus}`}
                  aria-label={`${fullName}，${fullStatus}`}
                >
                  <span>{displayName}</span>
                  <strong>{displayStatus}</strong>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <p className={styles.labSyncCopy}>
          {meta?.reason ?? "目前沒有可讀取的 Lab sanctioned snapshot；頁面保留本機 SIM-only 策略卡，避免用假資料補量化欄位。"}
        </p>
      )}
    </div>
  );
}

function StrategyCard({ strategy }: { strategy: StrategyCardView }) {
  const color = accentColor(strategy.accent);

  return (
    <article className={`${styles.card} ${styles.cardHoverable}`} style={{ "--accent": color } as React.CSSProperties}>
      <div className={styles.cardBody}>
        <div className={styles.cardHead}>
          <div className={styles.iconMark}>{strategy.shortName.slice(0, 2).toUpperCase()}</div>
          <DisplayStatusBadge status={strategy.displayStatus} />
        </div>

        <h2>{strategy.name}</h2>
        <p className={styles.role}>
          {strategy.role} / {strategy.cadence} / {strategy.basketSize}
        </p>
        <p className={styles.signal}>{strategy.signal}</p>

        {strategy.labCandidate ? (
          <div className={styles.labCardMeta}>
            <Database size={14} strokeWidth={1.9} />
            <div>
              <span>{strategy.labStatusWording}</span>
              <small>候選來源：{candidateName(strategy.labCandidate)}</small>
            </div>
          </div>
        ) : null}

        <div className={styles.metricGrid}>
          <div className={styles.metric}>
            <span>量化分數</span>
            <strong>{QUANT_SCORE_PENDING_LABEL}</strong>
            <small className={styles.metricHint}>{QUANT_SCORE_PENDING_HINT}</small>
          </div>
          <div className={styles.metric}>
            <span>策略定位</span>
            <strong>{strategy.role}</strong>
          </div>
          <div className={styles.metric}>
            <span>回測勝率（研究參考）</span>
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
          <ShieldCheck size={15} strokeWidth={1.9} /> 模擬模式 v1 / {strategy.current.status}
        </div>

        <Link className={styles.cta} href={`/quant-strategies/${strategy.id}`}>
          檢視策略與 SIM 配置 <ArrowRight size={16} strokeWidth={1.9} />
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

  let payload: LabStrategiesResponse | null = null;
  let fetchError: string | null = null;

  try {
    payload = await radarLabApi.strategies();
  } catch (error) {
    fetchError = friendlyDataError(error, "Lab 候選策略暫時無法讀取。");
  }

  const labCandidates = payload?.meta.source === "lab_sanctioned" && payload.data?.candidates
    ? payload.data.candidates
    : [];
  const strategies = attachLabCandidates(QUANT_STRATEGIES, labCandidates);

  return (
    <PageFrame
      code="QNT"
      title="量化策略"
      sub="Athena 訊號 / 模擬模式"
      note="v1 僅顯示模擬執行路徑；正式交易不出現在此頁。量化分數欄位等正式資料服務回傳後才顯示數字。"
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
      `}</style>

      <div className="_qnt-tabs" aria-label="量化策略子頁">
        <Link
          href="/quant-strategies"
          data-active={!isSubsTab ? "true" : "false"}
        >
          策略列表
        </Link>
        <Link
          href="/quant-strategies?tab=subscriptions"
          data-active={isSubsTab ? "true" : "false"}
        >
          我的訂閱
        </Link>
        <Link href="/lab/three-strategy">Athena 三策略</Link>
        <Link href="/lab/strategies">Lab 策略清單</Link>
      </div>

      {isSubsTab ? (
        <Panel code="QNT-SUBS" title="我的訂閱" sub="模擬策略訂閱紀錄">
          <QuantSubsPanel />
        </Panel>
      ) : (
        <Panel code="QNT-01" title="策略列表" sub="策略分數、回測風險與模擬配置。">
          <div className="_qnt-banner">
            <b className="tg gold">模擬帳戶執行中</b> / v1 只開放模擬帳戶，不提供正式交易切換。
          </div>
          <LabCandidateStrip candidates={labCandidates} payload={payload} fetchError={fetchError} />
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
