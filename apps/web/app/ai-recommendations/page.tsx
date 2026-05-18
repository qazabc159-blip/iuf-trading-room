import Link from "next/link";
import {
  recommendationActionSchema,
  recommendationDirectionSchema,
  recommendationPositionSuggestionSchema,
  recommendationTimeHorizonSchema,
  type StockRecommendation,
} from "@iuf-trading-room/contracts";
import { ArrowRight, Database, FileSearch, Gauge, ShieldAlert, Target } from "lucide-react";

import { PageFrame, Panel } from "@/components/PageFrame";
import { MarketStateBanner } from "@/components/MarketStateBanner";
import { getAiRecommendationsV3, getRecommendationsToday, type AiRecommendationV3Response, type RecommendationListResponse } from "@/lib/api";
import {
  buildRecommendationPrefillHref,
  handoffLabelForDirection,
  INVALID_AI_HANDOFF_TICKER_MESSAGE,
} from "@/lib/ai-recommendation-handoff";
import { RecommendationFeedbackActions } from "./RecommendationFeedbackActions";
import { RecommendationHandoffLink, RecommendationHandoffPreview, RecommendationHandoffUnavailable } from "./RecommendationHandoffLink";
import { formatRecommendationSourceMode } from "./source-mode-label";
import { formatRecommendationTimestamp, formatSourceTimestamp } from "./source-trail-time";
import { MarketStateBadge, MarketStateBadgePlaceholder } from "./MarketStateBadge";
import { ReactTracePanel } from "./ReactTracePanel";
import { StockRecCard, type StockRecCardData } from "./StockRecCard";
import { buildV3PanelState, getV3MarketScores, mapV3ItemToStockRecCard, mapV3TraceSteps } from "./v3-view";

export const dynamic = "force-dynamic";

type BucketValue = StockRecommendation["action"];

const ACTION_VALUES = recommendationActionSchema.options as readonly BucketValue[];
const DIRECTION_VALUES = recommendationDirectionSchema.options as readonly StockRecommendation["direction"][];
const TIME_HORIZON_VALUES = recommendationTimeHorizonSchema.options as readonly StockRecommendation["timeHorizon"][];
const POSITION_VALUES = recommendationPositionSuggestionSchema.options as readonly StockRecommendation["positionSizing"]["suggestion"][];

const BUCKETS: Array<{
  value: BucketValue;
  label: string;
  range: string;
  primary: boolean;
  tone: "ok" | "warn" | "bad";
  emptyMessage: string;
}> = [
  {
    value: ACTION_VALUES[0],
    label: "積極觀察",
    range: "80+",
    primary: true,
    tone: "ok",
    emptyMessage: "目前沒有達到積極觀察門檻的標的。",
  },
  {
    value: ACTION_VALUES[1],
    label: "觀察名單",
    range: "70-79",
    primary: true,
    tone: "warn",
    emptyMessage: "目前沒有適合列入觀察名單的標的。",
  },
  {
    value: ACTION_VALUES[2],
    label: "小量追蹤",
    range: "60-69",
    primary: true,
    tone: "warn",
    emptyMessage: "目前沒有適合小量追蹤的標的。",
  },
  {
    value: ACTION_VALUES[3],
    label: "暫不進場",
    range: "<60",
    primary: false,
    tone: "bad",
    emptyMessage: "目前沒有被系統明確排除的標的。",
  },
  {
    value: ACTION_VALUES[4],
    label: "資料不足",
    range: "MISSING",
    primary: false,
    tone: "bad",
    emptyMessage: "目前沒有因資料不足而保留的標的。",
  },
];

const REASON_GROUPS: Array<{
  key: keyof StockRecommendation["reasons"];
  label: string;
}> = [
  { key: "technical", label: "技術面" },
  { key: "chip", label: "籌碼" },
  { key: "news", label: "新聞" },
  { key: "theme", label: "主題" },
  { key: "quant", label: "量化" },
  { key: "macro", label: "總經" },
];

const DIRECTION_LABELS = new Map<StockRecommendation["direction"], string>([
  [DIRECTION_VALUES[0], "偏多"],
  [DIRECTION_VALUES[1], "偏空"],
  [DIRECTION_VALUES[2], "中性"],
]);

const TIME_HORIZON_LABELS = new Map<StockRecommendation["timeHorizon"], string>([
  [TIME_HORIZON_VALUES[0], "短線 / 波段"],
  [TIME_HORIZON_VALUES[1], "1-2 週"],
  [TIME_HORIZON_VALUES[2], "中期觀察"],
]);

const POSITION_LABELS = new Map<StockRecommendation["positionSizing"]["suggestion"], string>([
  [POSITION_VALUES[0], "標準部位"],
  [POSITION_VALUES[1], "半碼觀察"],
  [POSITION_VALUES[2], "高風險小量"],
]);

function asPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatPrice(value: number | null) {
  if (value === null) return "-";
  return value.toLocaleString("zh-TW", { maximumFractionDigits: 2 });
}

function formatDirection(value: StockRecommendation["direction"]) {
  return DIRECTION_LABELS.get(value) ?? "中性";
}

function formatTimeHorizon(value: StockRecommendation["timeHorizon"]) {
  return TIME_HORIZON_LABELS.get(value) ?? String(value);
}

function formatPositionSuggestion(value: StockRecommendation["positionSizing"]["suggestion"]) {
  return POSITION_LABELS.get(value) ?? "依風控調整";
}

function qualityTone(value: string) {
  if (value === "OK") return "ok";
  if (value === "MISSING") return "bad";
  return "warn";
}

function qualityStatusLabel(value: string) {
  if (value === "OK") return "完整";
  if (value === "STALE") return "過期";
  if (value === "MISSING") return "缺資料";
  if (value === "WEAK") return "偏弱";
  return value;
}

function gateTone(value: StockRecommendation["quant"]["gateStatus"]) {
  if (value === "PASS") return "ok";
  if (value === "FAIL") return "bad";
  return "warn";
}

function targetLabel(value: StockRecommendation["targets"][number]["label"]) {
  if (value === "TP1" || value === "TP2") return value;
  return "移動停利";
}

function scoreBucket(item: StockRecommendation) {
  if (item.dataQuality.quote === "MISSING" && item.dataQuality.kbar === "MISSING") return BUCKETS[4];
  if (item.totalScore >= 80) return BUCKETS[0];
  if (item.totalScore >= 70) return BUCKETS[1];
  if (item.totalScore >= 60) return BUCKETS[2];
  return BUCKETS[3];
}

function bucketForItem(item: StockRecommendation) {
  return BUCKETS.find((bucket) => bucket.value === item.action) ?? scoreBucket(item);
}

function groupByBucket(items: StockRecommendation[]) {
  const groups = new Map<BucketValue, StockRecommendation[]>();
  for (const bucket of BUCKETS) groups.set(bucket.value, []);

  for (const item of items) {
    const bucket = bucketForItem(item);
    groups.get(bucket.value)?.push(item);
  }

  for (const values of groups.values()) {
    values.sort((a, b) => a.rank - b.rank);
  }
  return groups;
}

function safeMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("403") || message.includes("forbidden_role")) {
    return "需要 Owner 權限才能讀取正式推薦。";
  }
  if (message.includes("401") || message.includes("unauthenticated")) {
    return "請先登入 IUF 帳號，再查看 AI 推薦。";
  }
  return "Recommendation Orchestrator 暫時無法讀取資料。";
}

async function loadRecommendations(): Promise<{
  data: RecommendationListResponse | null;
  error: string | null;
}> {
  try {
    return { data: await getRecommendationsToday(), error: null };
  } catch (error) {
    return { data: null, error: safeMessage(error) };
  }
}

async function loadRecommendationsV3(): Promise<{
  data: AiRecommendationV3Response | null;
  error: string | null;
}> {
  try {
    return { data: await getAiRecommendationsV3(), error: null };
  } catch (error) {
    return { data: null, error: safeMessage(error) };
  }
}

function QualityBadges({ rec }: { rec: StockRecommendation }) {
  const items: Array<[string, string]> = [
    ["報價", rec.dataQuality.quote],
    ["K 線", rec.dataQuality.kbar],
    ["籌碼", rec.dataQuality.chip],
    ["新聞", rec.dataQuality.news],
    ["量化", rec.dataQuality.quant],
  ];
  const penaltyPct = Math.round(rec.dataQuality.confidencePenalty * 100);
  const weakItems = items
    .filter(([, value]) => value !== "OK")
    .map(([label, value]) => `${label}${qualityStatusLabel(value)}`);
  const summary = weakItems.length > 0
    ? `資料品質弱項：${weakItems.join("、")}；信心折減 ${penaltyPct}%`
    : `資料品質完整；信心折減 ${penaltyPct}%`;

  return (
    <div className="_rec-quality" aria-label={summary} title={summary}>
      {items.map(([label, value]) => (
        <span key={label} data-tone={qualityTone(value)}>
          <b>{label}</b>
          {qualityStatusLabel(value)}
        </span>
      ))}
      <span data-tone={rec.dataQuality.confidencePenalty > 0 ? "warn" : "ok"}>
        <b>信心折減</b>
        {penaltyPct}%
      </span>
    </div>
  );
}

function RecommendationCard({ rec }: { rec: StockRecommendation }) {
  const prefillHref = buildRecommendationPrefillHref(rec);
  const bucket = bucketForItem(rec);
  const positionLabel = formatPositionSuggestion(rec.positionSizing.suggestion);
  const directionLabel = formatDirection(rec.direction);

  return (
    <article className="_rec-card" data-tone={bucket.tone}>
      <div className="_rec-card-head">
        <div>
          <span className="_rec-rank">#{rec.rank}</span>
          <h3>
            <span>{rec.ticker}</span>
            {rec.companyName}
          </h3>
        </div>
        <div className="_rec-badges">
          <span data-tone={bucket.tone}>{bucket.label}</span>
          <span>{directionLabel}</span>
          <span>{formatTimeHorizon(rec.timeHorizon)}</span>
        </div>
      </div>

      <div className="_rec-score-grid">
        <div className="_rec-score">
          <div>
            <Gauge size={16} strokeWidth={1.9} />
            <span>總分</span>
            <b>{rec.totalScore}</b>
          </div>
          <i style={{ width: `${rec.totalScore}%` }} />
        </div>
        <div className="_rec-score">
          <div>
            <Target size={16} strokeWidth={1.9} />
            <span>信心</span>
            <b>{asPercent(rec.confidence)}</b>
          </div>
          <i style={{ width: `${Math.round(rec.confidence * 100)}%` }} />
        </div>
      </div>

      <div className="_rec-quant">
        <span data-tone={gateTone(rec.quant.gateStatus)}>{rec.quant.gateStatus}</span>
        <b>Quant {rec.quant.score}</b>
        <small>{rec.quant.strategySource}</small>
      </div>

      <p className="_rec-research-note">AI 推薦只做研究與 SIM 演練，不代表實單建議。</p>
      <div className="_rec-trade-grid">
        <div>
          <span>進場區間</span>
          <b>{rec.entryZone.primary || "資料尚未提供"}</b>
          {rec.entryZone.secondary && <small>{rec.entryZone.secondary}</small>}
          <p>{rec.entryZone.reason || "尚無進場理由"}</p>
        </div>
        <div>
          <span>失效條件 / 停損</span>
          <b>{formatPrice(rec.invalidation.price)}</b>
          <p>{rec.invalidation.rule || "尚無失效條件"}</p>
        </div>
        <div>
          <span>部位建議</span>
          <b data-risk={positionLabel === "高風險小量" ? "hot" : undefined}>
            {positionLabel}
          </b>
          <p>單筆最大風險 {rec.positionSizing.maxRiskPct}%</p>
        </div>
      </div>

      <div className="_rec-targets">
        {rec.targets.map((target) => (
          <span key={`${rec.recommendationId}-${target.label}`}>
            <b>{targetLabel(target.label)}</b>
            {formatPrice(target.price)}
            <small>{target.reason}</small>
          </span>
        ))}
      </div>

      <details className="_rec-details" open>
        <summary>推薦理由</summary>
        <div className="_rec-reasons">
          {REASON_GROUPS.map((group) => {
            const reasons = rec.reasons[group.key];
            return (
              <section key={group.key}>
                <b>{group.label}</b>
                {reasons.length > 0 ? (
                  <ul>
                    {reasons.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                ) : (
                  <span>-</span>
                )}
              </section>
            );
          })}
        </div>
      </details>

      <details className="_rec-details">
        <summary>
          <ShieldAlert size={14} strokeWidth={1.9} />
          風險
        </summary>
        {rec.risks.length > 0 ? (
          <ul className="_rec-risks">
            {rec.risks.map((risk) => (
              <li key={risk}>{risk}</li>
            ))}
          </ul>
        ) : (
          <p className="_rec-empty-text">尚無額外風險說明。</p>
        )}
      </details>

      <QualityBadges rec={rec} />

      <details className="_rec-source">
        <summary>
          <Database size={14} strokeWidth={1.9} />
          資料來源
        </summary>
        <div>
          {rec.sourceTrail.length > 0 ? (
            rec.sourceTrail.map((source) => (
              <span key={`${source.type}-${source.source}-${source.timestamp}`}>
                <b>{source.type}</b>
                {source.source}
                <small title={source.timestamp} aria-label={`資料來源時間 ${source.timestamp}`}>
                  {formatSourceTimestamp(source.timestamp)}
                </small>
              </span>
            ))
          ) : (
            <p className="_rec-empty-text">尚無來源紀錄。</p>
          )}
        </div>
      </details>

      <Link className="_rec-detail-link" href={`/ai-recommendations/${encodeURIComponent(rec.recommendationId)}`}>
        <FileSearch size={16} strokeWidth={1.9} />
        查看詳情
      </Link>

      {prefillHref ? (
        <>
          <RecommendationHandoffPreview href={prefillHref} recommendationId={rec.recommendationId} />
          <RecommendationHandoffLink
            href={prefillHref}
            recommendationId={rec.recommendationId}
            directionLabel={handoffLabelForDirection(rec.direction)}
          >
            <ArrowRight size={16} strokeWidth={1.9} />
            帶入模擬委託
          </RecommendationHandoffLink>
        </>
      ) : (
        <RecommendationHandoffUnavailable reason={INVALID_AI_HANDOFF_TICKER_MESSAGE}>
          <ShieldAlert size={16} strokeWidth={1.9} />
          無法帶入模擬委託
        </RecommendationHandoffUnavailable>
      )}
      <RecommendationFeedbackActions recommendationId={rec.recommendationId} />
    </article>
  );
}

function EmptyBucket({ message }: { message: string }) {
  return (
    <div className="_rec-empty">
      <b>尚無標的</b>
      <p>{message}</p>
    </div>
  );
}

function RecommendationListEmptyState({ error }: { error: string | null }) {
  return (
    <div className="_rec-empty _rec-empty-single">
      <b>推薦清單目前沒有可顯示標的</b>
      <p>
        {error
          ? "今日推薦清單 endpoint 尚未通過目前 session 權限；前端不補假股票，也不把 strategy ideas 冒充 AI 推薦。"
          : "今日推薦清單目前回傳 0 檔；等待 v3 refresh 或正式候選通過資料品質門檻。"}
      </p>
      <dl>
        <div>
          <dt>Endpoint</dt>
          <dd>GET /api/v1/recommendations/today</dd>
        </div>
        <div>
          <dt>Owner</dt>
          <dd>Elva/Jason + Bruce owner-session verify</dd>
        </div>
        <div>
          <dt>Next</dt>
          <dd>用 owner session 驗證推薦清單；若仍為 0 檔，觸發 v3 refresh 並檢查資料品質門檻。</dd>
        </div>
      </dl>
    </div>
  );
}

function BucketSection({
  bucket,
  items,
  error,
}: {
  bucket: (typeof BUCKETS)[number];
  items: StockRecommendation[];
  error: string | null;
}) {
  const body = (
    <div className="_rec-card-grid">
      {items.length > 0 ? (
        items.map((rec) => <RecommendationCard key={rec.recommendationId} rec={rec} />)
      ) : (
        <EmptyBucket message={error ?? bucket.emptyMessage} />
      )}
    </div>
  );

  if (!bucket.primary) {
    return (
      <details className="_rec-section _rec-section-collapsed">
        <summary>
          <span>{bucket.label}</span>
          <b>{items.length}</b>
        </summary>
        {body}
      </details>
    );
  }

  return (
    <section className="_rec-section">
      <div className="_rec-section-head">
        <h2>{bucket.label}</h2>
        <span>{items.length} 檔</span>
      </div>
      {body}
    </section>
  );
}

export default async function AiRecommendationsPage() {
  const [todayResult, v3Result] = await Promise.all([
    loadRecommendations(),
    loadRecommendationsV3(),
  ]);
  const { data, error } = todayResult;
  const items = data?.items ?? [];
  const grouped = groupByBucket(items);
  const v3Items = v3Result.data?.items ?? [];
  const v3Cards = v3Items
    .map(mapV3ItemToStockRecCard)
    .filter((card): card is StockRecCardData => Boolean(card));
  const v3PanelState = buildV3PanelState({
    data: v3Result.data,
    error: v3Result.error,
    visibleCount: v3Cards.length,
  });
  const hasPrimaryV3Cards = v3Cards.length >= 5;
  const v3MarketScores = getV3MarketScores(v3Items);
  const v3TraceSteps = mapV3TraceSteps(v3Result.data?.reactTrace);
  const sourceMode = formatRecommendationSourceMode({
    hasData: Boolean(data),
    isMock: Boolean(data?._mock),
  });
  const generatedAtLabel = formatRecommendationTimestamp(data?.generatedAt);
  const v3GeneratedAtLabel = formatRecommendationTimestamp(v3Result.data?.generatedAt);

  return (
    <PageFrame
      code="AI"
      title="AI 推薦"
      sub="Recommendation Orchestrator"
      note="推薦頁只呈現研究與模擬交易前置資訊；正式券商寫入仍關閉。分數、進場、停損、部位都必須再經 SIM 流程與風控確認。"
    >
      <MarketStateBanner />
      {v3MarketScores ? <MarketStateBadge scores={v3MarketScores} /> : <MarketStateBadgePlaceholder />}
      <style>{`
        ._rec-tabs {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-bottom: 16px;
        }
        ._rec-tabs a,
        ._rec-prefill {
          min-height: 36px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
          border: 1px solid var(--tac-line);
          border-radius: 6px;
          padding: 0 12px;
          color: var(--tac-fg-1);
          background: rgba(8, 11, 16, 0.52);
          font: 800 11px/1 var(--mono);
          text-decoration: none;
        }
        ._rec-tabs a:hover,
        ._rec-prefill:hover:not(._rec-prefill-disabled) {
          color: var(--tac-fg-0);
          border-color: rgba(200, 148, 63, 0.42);
          background: rgba(200, 148, 63, 0.08);
        }
        ._rec-prefill-disabled {
          color: var(--tac-fg-3);
          border-style: dashed;
          border-color: rgba(230, 57, 70, 0.28);
          background: rgba(230, 57, 70, 0.05);
          cursor: not-allowed;
        }
        ._rec-prefill-side {
          border-left: 1px solid rgba(200, 148, 63, 0.28);
          padding-left: 7px;
          color: var(--tac-brand);
          font-weight: 900;
          white-space: nowrap;
        }
        ._rec-bucket-grid {
          display: grid;
          grid-template-columns: repeat(5, minmax(0, 1fr));
          gap: 10px;
          padding: 16px;
        }
        ._rec-bucket {
          min-height: 118px;
          border: 1px solid rgba(200, 148, 63, 0.18);
          border-radius: 8px;
          background:
            linear-gradient(180deg, rgba(200, 148, 63, 0.055), transparent 72%),
            rgba(9, 14, 20, 0.82);
          padding: 13px;
        }
        ._rec-bucket span,
        ._rec-rank,
        ._rec-trade-grid span,
        ._rec-section-head span {
          color: var(--tac-brand);
          font: 900 10px/1 var(--mono);
        }
        ._rec-bucket b {
          display: block;
          margin-top: 10px;
          color: var(--tac-fg-0);
          font: 850 15px/1.25 var(--sans-tc);
        }
        ._rec-bucket small {
          display: block;
          margin-top: 9px;
          color: var(--tac-fg-3);
          font: 700 11px/1.5 var(--sans-tc);
        }
        ._rec-section {
          padding: 0 16px 18px;
        }
        ._rec-section + ._rec-section,
        ._rec-section + ._rec-section-collapsed {
          border-top: 1px solid var(--tac-line);
          padding-top: 16px;
        }
        ._rec-section-head,
        ._rec-section-collapsed > summary {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 12px;
        }
        ._rec-section-head h2 {
          margin: 0;
          color: var(--tac-fg-0);
          font: 850 18px/1.25 var(--sans-tc);
        }
        ._rec-section-collapsed {
          border-top: 1px solid var(--tac-line);
        }
        ._rec-section-collapsed > summary {
          min-height: 48px;
          cursor: pointer;
          color: var(--tac-fg-0);
          font: 850 14px/1.25 var(--sans-tc);
          list-style: none;
        }
        ._rec-section-collapsed > summary::-webkit-details-marker {
          display: none;
        }
        ._rec-section-collapsed > summary b {
          color: var(--tac-brand);
          font: 900 12px/1 var(--mono);
        }
        ._rec-card-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(330px, 1fr));
          gap: 12px;
        }
        ._rec-card {
          display: grid;
          gap: 13px;
          min-width: 0;
          border: 1px solid rgba(220, 228, 240, 0.1);
          border-left: 3px solid rgba(200, 148, 63, 0.78);
          border-radius: 8px;
          padding: 15px;
          background:
            linear-gradient(135deg, rgba(200, 148, 63, 0.055), transparent 42%),
            rgba(4, 8, 13, 0.42);
        }
        ._rec-card[data-tone="bad"] {
          border-left-color: rgba(230, 57, 70, 0.78);
        }
        ._rec-card[data-tone="ok"] {
          border-left-color: rgba(46, 204, 113, 0.68);
        }
        ._rec-card-head {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          align-items: start;
        }
        ._rec-card h3 {
          margin: 6px 0 0;
          color: var(--tac-fg-0);
          font: 850 18px/1.25 var(--sans-tc);
        }
        ._rec-card h3 span {
          margin-right: 8px;
          color: var(--tac-brand);
          font-family: var(--mono);
        }
        ._rec-badges,
        ._rec-quality,
        ._rec-targets {
          display: flex;
          flex-wrap: wrap;
          gap: 7px;
        }
        ._rec-badges span,
        ._rec-quality span,
        ._rec-quant span {
          min-height: 24px;
          display: inline-flex;
          align-items: center;
          gap: 5px;
          border: 1px solid var(--tac-line);
          border-radius: 5px;
          padding: 0 8px;
          color: var(--tac-fg-2);
          background: rgba(8, 11, 16, 0.5);
          font: 800 10px/1 var(--sans-tc);
          white-space: nowrap;
        }
        ._rec-badges span[data-tone="ok"],
        ._rec-quality span[data-tone="ok"],
        ._rec-quant span[data-tone="ok"] {
          color: var(--tac-ok);
          border-color: rgba(46, 204, 113, 0.34);
          background: rgba(46, 204, 113, 0.06);
        }
        ._rec-badges span[data-tone="warn"],
        ._rec-quality span[data-tone="warn"],
        ._rec-quant span[data-tone="warn"] {
          color: var(--tac-warn);
          border-color: rgba(200, 148, 63, 0.34);
          background: rgba(200, 148, 63, 0.06);
        }
        ._rec-badges span[data-tone="bad"],
        ._rec-quality span[data-tone="bad"],
        ._rec-quant span[data-tone="bad"] {
          color: var(--tac-bad);
          border-color: rgba(230, 57, 70, 0.34);
          background: rgba(230, 57, 70, 0.06);
        }
        ._rec-score-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
        }
        ._rec-score {
          min-width: 0;
          border: 1px solid var(--tac-line);
          border-radius: 6px;
          padding: 10px;
          background: rgba(8, 11, 16, 0.38);
        }
        ._rec-score div {
          display: flex;
          align-items: center;
          gap: 8px;
          color: var(--tac-fg-2);
          font: 800 11px/1 var(--sans-tc);
        }
        ._rec-score b {
          margin-left: auto;
          color: var(--tac-fg-0);
          font: 900 18px/1 var(--mono);
        }
        ._rec-score i {
          display: block;
          height: 4px;
          margin-top: 10px;
          border-radius: 99px;
          background: linear-gradient(90deg, var(--tac-brand), var(--tac-ok));
        }
        ._rec-quant {
          display: flex;
          align-items: center;
          gap: 9px;
          min-width: 0;
        }
        ._rec-quant b {
          color: var(--tac-fg-0);
          font: 900 13px/1 var(--mono);
        }
        ._rec-quant small {
          min-width: 0;
          color: var(--tac-fg-3);
          font: 800 11px/1 var(--mono);
          overflow-wrap: anywhere;
        }
        ._rec-research-note {
          margin: 0;
          color: var(--tac-fg-3);
          font-size: 12px;
          line-height: 1.58;
        }
        ._rec-trade-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 10px;
        }
        ._rec-trade-grid > div {
          min-width: 0;
          border-top: 1px solid var(--tac-line);
          padding-top: 10px;
        }
        ._rec-trade-grid b {
          display: block;
          margin-top: 7px;
          color: var(--tac-fg-0);
          font: 850 14px/1.35 var(--sans-tc);
          overflow-wrap: anywhere;
        }
        ._rec-trade-grid b[data-risk="hot"] {
          color: var(--tac-bad);
        }
        ._rec-trade-grid small,
        ._rec-trade-grid p,
        ._rec-targets small,
        ._rec-empty-text {
          margin: 6px 0 0;
          color: var(--tac-fg-3);
          font-size: 12px;
          line-height: 1.58;
        }
        ._rec-targets span {
          display: grid;
          gap: 4px;
          min-width: 104px;
          border: 1px solid var(--tac-line);
          border-radius: 6px;
          padding: 9px;
          color: var(--tac-fg-0);
          background: rgba(8, 11, 16, 0.34);
          font: 900 13px/1 var(--mono);
        }
        ._rec-targets b {
          color: var(--tac-brand);
          font-size: 10px;
        }
        ._rec-details,
        ._rec-source {
          border-top: 1px solid var(--tac-line);
          padding-top: 10px;
        }
        ._rec-details summary,
        ._rec-source summary {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          cursor: pointer;
          color: var(--tac-fg-0);
          font: 850 12px/1 var(--sans-tc);
        }
        ._rec-reasons {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
          margin-top: 10px;
        }
        ._rec-reasons section {
          min-width: 0;
          border: 1px solid var(--tac-line);
          border-radius: 6px;
          padding: 9px;
          background: rgba(8, 11, 16, 0.34);
        }
        ._rec-reasons b {
          color: var(--tac-brand);
          font: 900 10px/1 var(--mono);
        }
        ._rec-reasons ul,
        ._rec-risks {
          margin: 8px 0 0;
          padding-left: 17px;
          color: var(--tac-fg-2);
          font-size: 12px;
          line-height: 1.62;
        }
        ._rec-reasons span {
          display: block;
          margin-top: 8px;
          color: var(--tac-fg-3);
          font: 800 12px/1 var(--mono);
        }
        ._rec-quality span {
          display: inline-grid;
          grid-template-columns: 1fr;
          gap: 4px;
          min-height: 38px;
          align-items: center;
        }
        ._rec-quality b {
          color: var(--tac-fg-3);
          font: 900 9px/1 var(--mono);
        }
        ._rec-source div {
          display: grid;
          gap: 7px;
          margin-top: 10px;
        }
        ._rec-source div span {
          display: grid;
          grid-template-columns: 70px minmax(0, 1fr);
          gap: 8px;
          color: var(--tac-fg-2);
          font: 12px/1.45 var(--mono);
          overflow-wrap: anywhere;
        }
        ._rec-source b {
          color: var(--tac-brand);
        }
        ._rec-source small {
          grid-column: 2;
          color: var(--tac-fg-3);
        }
        ._rec-prefill {
          justify-self: start;
          color: var(--tac-brand);
        }
        ._rec-detail-link {
          justify-self: start;
          min-height: 34px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
          border: 1px solid var(--tac-line);
          border-radius: 6px;
          padding: 0 11px;
          color: var(--tac-fg-2);
          background: rgba(8, 11, 16, 0.46);
          font: 850 12px/1 var(--sans-tc);
          text-decoration: none;
        }
        ._rec-detail-link:hover {
          color: var(--tac-fg-0);
          border-color: rgba(200, 148, 63, 0.5);
          background: rgba(200, 148, 63, 0.1);
        }
        ._rec-handoff-preview {
          display: grid;
          gap: 8px;
          border: 1px solid rgba(46, 204, 113, 0.24);
          border-radius: 6px;
          padding: 10px;
          background:
            linear-gradient(135deg, rgba(46, 204, 113, 0.07), transparent 64%),
            rgba(8, 11, 16, 0.42);
        }
        ._rec-handoff-preview-head,
        ._rec-handoff-preview-items {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 7px;
        }
        ._rec-handoff-preview-head b {
          color: var(--tac-fg-0);
          font: 900 12px/1 var(--sans-tc);
        }
        ._rec-handoff-preview-head span {
          min-height: 22px;
          display: inline-flex;
          align-items: center;
          border: 1px solid rgba(46, 204, 113, 0.28);
          border-radius: 5px;
          padding: 0 7px;
          color: var(--tac-ok);
          background: rgba(46, 204, 113, 0.06);
          font: 900 10px/1 var(--sans-tc);
        }
        ._rec-handoff-preview-items span {
          min-height: 24px;
          display: inline-flex;
          align-items: center;
          gap: 5px;
          border: 1px solid var(--tac-line);
          border-radius: 5px;
          padding: 0 8px;
          color: var(--tac-fg-2);
          background: rgba(8, 11, 16, 0.5);
          font: 800 10px/1 var(--sans-tc);
          white-space: nowrap;
        }
        ._rec-handoff-preview-items b {
          color: var(--tac-brand);
          font: 900 9px/1 var(--sans-tc);
        }
        ._rec-handoff-preview p {
          margin: 0;
          color: var(--tac-fg-3);
          font-size: 12px;
          line-height: 1.55;
        }
        ._rec-feedback {
          display: grid;
          gap: 7px;
          border-top: 1px solid var(--tac-line);
          padding-top: 10px;
        }
        ._rec-feedback div {
          display: flex;
          flex-wrap: wrap;
          gap: 7px;
        }
        ._rec-feedback button {
          min-height: 32px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          border: 1px solid var(--tac-line);
          border-radius: 6px;
          padding: 0 10px;
          color: var(--tac-fg-2);
          background: rgba(8, 11, 16, 0.5);
          font: 850 11px/1 var(--sans-tc);
          cursor: pointer;
        }
        ._rec-feedback button:hover:not(:disabled),
        ._rec-feedback button[data-active="true"] {
          color: var(--tac-fg-0);
          border-color: rgba(200, 148, 63, 0.44);
          background: rgba(200, 148, 63, 0.1);
        }
        ._rec-feedback button:disabled {
          cursor: wait;
          opacity: 0.64;
        }
        ._rec-feedback > span {
          color: var(--tac-fg-3);
          font: 800 11px/1 var(--mono);
        }
        ._rec-feedback[data-status="saved"] > span {
          color: var(--tac-ok);
        }
        ._rec-feedback[data-status="failed"] > span {
          color: var(--tac-warn);
        }
        ._rec-empty {
          min-height: 170px;
          display: grid;
          align-content: center;
          justify-items: center;
          gap: 8px;
          border: 1px dashed rgba(200, 148, 63, 0.24);
          border-radius: 8px;
          color: var(--tac-fg-3);
          background: rgba(8, 11, 16, 0.28);
          text-align: center;
          padding: 22px;
        }
        ._rec-empty b {
          color: var(--tac-fg-0);
          font: 850 14px/1.35 var(--sans-tc);
        }
        ._rec-empty p {
          margin: 0;
          max-width: 360px;
          font-size: 12px;
          line-height: 1.65;
        }
        ._rec-empty-single {
          justify-items: stretch;
          text-align: left;
          min-height: 0;
        }
        ._rec-empty-single p {
          max-width: 760px;
        }
        ._rec-empty-single dl {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 10px;
          margin: 10px 0 0;
        }
        ._rec-empty-single dl > div {
          min-width: 0;
          border: 1px solid rgba(220, 228, 240, 0.1);
          border-radius: 6px;
          padding: 10px;
          background: rgba(3, 7, 12, 0.42);
        }
        ._rec-empty-single dt {
          color: var(--tac-brand);
          font: 900 10px/1 var(--mono);
          margin-bottom: 6px;
        }
        ._rec-empty-single dd {
          margin: 0;
          color: var(--tac-fg-2);
          font: 800 11px/1.45 var(--sans-tc);
          overflow-wrap: anywhere;
        }
        ._rec-v3-preview {
          display: grid;
          gap: 10px;
          padding: 12px;
          border: 1px dashed rgba(200,148,63,0.24);
          border-radius: 8px;
          background: rgba(8,11,16,0.28);
          margin-bottom: 14px;
          overflow-x: auto;
        }
        ._rec-v3-preview-title {
          color: var(--tac-brand);
          font: 900 10px/1 var(--mono);
        }
        ._rec-v3-preview table {
          width: 100%;
          min-width: 680px;
          border-collapse: collapse;
          font: 800 11px/1 var(--mono);
        }
        ._rec-v3-preview th {
          padding: 5px 6px;
          color: var(--tac-brand);
          text-align: center;
          border-bottom: 1px solid var(--tac-line);
          font-size: 10px;
          white-space: nowrap;
        }
        ._rec-v3-preview td {
          padding: 6px;
          text-align: center;
          color: var(--tac-fg-3);
          font-size: 12px;
        }
        ._rec-v3-state {
          display: grid;
          gap: 10px;
          border: 1px solid var(--tac-line);
          border-left: 3px solid rgba(200, 148, 63, 0.72);
          border-radius: 8px;
          padding: 14px;
          margin-bottom: 14px;
          background: rgba(8, 11, 16, 0.42);
        }
        ._rec-v3-state[data-tone="live"] {
          border-left-color: rgba(46, 204, 113, 0.7);
        }
        ._rec-v3-state[data-tone="blocked"],
        ._rec-v3-state[data-tone="degraded"] {
          border-left-color: rgba(230, 57, 70, 0.72);
        }
        ._rec-v3-state b {
          color: var(--tac-fg-0);
          font: 850 14px/1.35 var(--sans-tc);
        }
        ._rec-v3-state p {
          margin: 0;
          color: var(--tac-fg-2);
          font-size: 12px;
          line-height: 1.65;
        }
        ._rec-v3-state dl {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 8px;
          margin: 0;
        }
        ._rec-v3-state div {
          min-width: 0;
        }
        ._rec-v3-state dt {
          color: var(--tac-brand);
          font: 900 10px/1 var(--mono);
        }
        ._rec-v3-state dd {
          margin: 6px 0 0;
          color: var(--tac-fg-2);
          font: 800 11px/1.5 var(--sans-tc);
          overflow-wrap: anywhere;
        }
        ._rec-v3-card-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(330px, 1fr));
          gap: 12px;
        }
        @media (max-width: 1180px) {
          ._rec-bucket-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
          ._rec-trade-grid { grid-template-columns: 1fr; }
        }
        @media (max-width: 760px) {
          ._rec-bucket-grid,
          ._rec-card-grid,
          ._rec-v3-card-grid,
          ._rec-score-grid,
          ._rec-reasons,
          ._rec-empty-single dl,
          ._rec-v3-state dl {
            grid-template-columns: 1fr;
          }
          ._rec-card-head {
            display: grid;
          }
        }
      `}</style>

      <div className="_rec-tabs" aria-label="AI 推薦導覽">
        <Link href="/runs">策略執行紀錄</Link>
        <Link href="/signals">訊號中心</Link>
      </div>

      <Panel
        code="AI-01"
        title={hasPrimaryV3Cards ? "v3 正式推薦清單" : "推薦清單"}
        sub={hasPrimaryV3Cards
          ? `產生時間 ${v3GeneratedAtLabel || "-"} / v3 SOP / ${v3PanelState.label}`
          : `交易日 ${data?.date ?? "-"} / 產生時間 ${generatedAtLabel || "-"} / ${sourceMode}`}
        right={`${hasPrimaryV3Cards ? v3Cards.length : items.length} 檔`}
      >
        {hasPrimaryV3Cards ? (
          <div style={{ padding: "16px" }}>
            <div className="_rec-v3-state" data-tone={v3PanelState.tone}>
              <b>今日 AI 推薦已由 v3 SOP 回傳 {v3Cards.length} 檔</b>
              <p>
                這裡使用 `GET /api/v1/ai-recommendations/v3` 的真實回傳，不用 strategy ideas 補位。
                若卡片標示降級補值，代表 LLM 敘事不足、由已驗證技術資料補齊結構化欄位，仍只作 SIM 研究候選。
              </p>
              <dl>
                <div>
                  <dt>Endpoint</dt>
                  <dd>{v3PanelState.endpoint}</dd>
                </div>
                <div>
                  <dt>Owner</dt>
                  <dd>{v3PanelState.owner}</dd>
                </div>
                <div>
                  <dt>Next</dt>
                  <dd>Bruce 驗 entry / TP / SL 與交易室 handoff；Elva/Jason 繼續補完整 AI 敘事與新聞/題材來源。</dd>
                </div>
              </dl>
            </div>
            <div className="_rec-v3-card-grid">
              {v3Cards.map((card) => (
                <StockRecCard key={`${card.ticker}-${card.bucket}`} rec={card} />
              ))}
            </div>
          </div>
        ) : (
          <>
            <div className="_rec-bucket-grid">
              {BUCKETS.map((bucket) => {
                const bucketItems = grouped.get(bucket.value) ?? [];
                return (
                  <article key={bucket.value} className="_rec-bucket">
                    <span>{bucket.range}</span>
                    <b>{bucket.label}</b>
                    <small>{bucketItems.length} 檔</small>
                  </article>
                );
              })}
            </div>

            {items.length > 0 ? (
              BUCKETS.map((bucket) => (
                <BucketSection
                  key={bucket.value}
                  bucket={bucket}
                  items={grouped.get(bucket.value) ?? []}
                  error={error}
                />
              ))
            ) : (
              <div style={{ padding: "0 16px 18px" }}>
                <RecommendationListEmptyState error={error} />
              </div>
            )}
          </>
        )}
      </Panel>

      <Panel
        code="AI-02"
        title="SOP 推理結構 (v3)"
        sub="7 sub-score / 市場狀態 / OTE 進場 / ReAct 5-module"
        right={v3PanelState.label}
      >
        <div style={{ padding: "16px" }}>
          <div className="_rec-v3-state" data-tone={v3PanelState.tone}>
            <b>{v3PanelState.title}</b>
            <p>{v3PanelState.detail}</p>
            <dl>
              <div>
                <dt>Endpoint</dt>
                <dd>{v3PanelState.endpoint}</dd>
              </div>
              <div>
                <dt>Owner</dt>
                <dd>{v3PanelState.owner}</dd>
              </div>
              <div>
                <dt>Next</dt>
                <dd>{v3PanelState.nextAction}</dd>
              </div>
            </dl>
          </div>

          {v3Cards.length > 0 ? (
            hasPrimaryV3Cards ? (
              <div className="_rec-v3-preview">
                <div className="_rec-v3-preview-title">
                  v3 5 檔已提升到上方主清單；本區保留 SOP 狀態與 ReAct 追蹤。
                </div>
                <p style={{ margin: 0, color: "var(--tac-fg-2)", font: "750 12px/1.7 var(--sans-tc)" }}>
                  上方主清單直接使用 v3 endpoint。這裡不重複渲染股票卡，避免使用者誤以為有兩套不同推薦。
                </p>
              </div>
            ) : (
            <div className="_rec-v3-card-grid">
              {v3Cards.map((card) => (
                <StockRecCard key={`${card.ticker}-${card.bucket}`} rec={card} />
              ))}
            </div>
            )
          ) : (
            <div className="_rec-v3-preview">
              <div className="_rec-v3-preview-title">
                7 SUB-SCORE TABLE / 尚未收到可顯示 v3 推薦
              </div>
              <table>
                <thead>
                  <tr>
                    {["主題位置", "營收獲利", "法人/ETF", "融資融券", "RS/量能", "技術結構", "估值事件", "總分"].map((header) => (
                      <th key={header}>{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    {["/20", "/15", "/15", "/15", "/10", "/20", "/5", "/100"].map((max, index) => (
                      <td key={index}>{max}</td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          <ReactTracePanel
            steps={v3TraceSteps}
            round_current={null}
            round_max={8}
            is_running={v3PanelState.tone === "pending"}
            over_budget={v3Result.data?.status === "budget_exceeded"}
          />
        </div>
      </Panel>
    </PageFrame>
  );
}
