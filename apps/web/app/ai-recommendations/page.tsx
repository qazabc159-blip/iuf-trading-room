import Link from "next/link";
import type { StockRecommendation } from "@iuf-trading-room/contracts";
import { ArrowRight, Database, FileSearch, Gauge, ShieldAlert, Target } from "lucide-react";

import { PageFrame, Panel } from "@/components/PageFrame";
import { getRecommendationsToday, type RecommendationListResponse } from "@/lib/api";
import { RecommendationFeedbackActions } from "./RecommendationFeedbackActions";
import { RecommendationHandoffLink } from "./RecommendationHandoffLink";

export const dynamic = "force-dynamic";

type BucketName = StockRecommendation["action"];
type QualityStatus = "OK" | "STALE" | "MISSING" | "WEAK";

const BUCKETS: Array<{ label: BucketName; range: string; primary: boolean }> = [
  { label: "今日首選", range: "80+", primary: true },
  { label: "可布局", range: "70-79", primary: true },
  { label: "等回檔", range: "60-69", primary: true },
  { label: "高風險排除", range: "<60", primary: false },
  { label: "資料不足暫不推薦", range: "MISSING", primary: false },
];

const REASON_GROUPS: Array<{
  key: keyof StockRecommendation["reasons"];
  label: string;
}> = [
  { key: "technical", label: "技術" },
  { key: "chip", label: "籌碼" },
  { key: "news", label: "新聞" },
  { key: "theme", label: "主題" },
  { key: "quant", label: "量化" },
  { key: "macro", label: "Macro" },
];

function asPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatPrice(value: number | null) {
  if (value === null) return "-";
  return value.toLocaleString("zh-TW", { maximumFractionDigits: 2 });
}

function qualityTone(value: QualityStatus) {
  if (value === "OK") return "ok";
  if (value === "MISSING") return "bad";
  return "warn";
}

function qualityStatusLabel(value: QualityStatus) {
  if (value === "OK") return "正常";
  if (value === "STALE") return "過期";
  if (value === "MISSING") return "缺資料";
  return "偏弱";
}

function gateTone(value: StockRecommendation["quant"]["gateStatus"]) {
  if (value === "PASS") return "ok";
  if (value === "FAIL") return "bad";
  return "warn";
}

function actionTone(value: BucketName) {
  if (value === "今日首選") return "ok";
  if (value === "可布局" || value === "等回檔") return "warn";
  return "bad";
}

function handoffSideForDirection(direction: StockRecommendation["direction"]) {
  if (direction === "偏空") return "sell";
  if (direction === "偏多") return "buy";
  return null;
}

function handoffLabelForDirection(direction: StockRecommendation["direction"]) {
  if (direction === "偏空") return "賣出";
  if (direction === "偏多") return "買進";
  return "中性";
}

function buildPrefillHref(rec: StockRecommendation) {
  const params = new URLSearchParams({
    ticker: rec.ticker,
    prefill: "true",
    from_rec: rec.recommendationId,
  });
  const side = handoffSideForDirection(rec.direction);

  if (side) {
    params.set("side", side);
  }

  if (rec.entryZone.primary) {
    params.set("entry", rec.entryZone.primary);
  }

  if (rec.invalidation.price !== null) {
    params.set("stop", String(rec.invalidation.price));
  }

  const firstTarget = rec.targets.find((target) => target.price !== null);
  if (firstTarget?.price !== undefined && firstTarget.price !== null) {
    params.set("tp", String(firstTarget.price));
  }

  return `/portfolio?${params.toString()}`;
}

function groupByBucket(items: StockRecommendation[]) {
  return BUCKETS.reduce<Record<BucketName, StockRecommendation[]>>((acc, bucket) => {
    acc[bucket.label] = items
      .filter((item) => item.action === bucket.label)
      .sort((a, b) => a.rank - b.rank);
    return acc;
  }, {} as Record<BucketName, StockRecommendation[]>);
}

function safeMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("403") || message.includes("forbidden_role")) return "Owner 權限尚未通過，推薦資料暫不顯示。";
  if (message.includes("401") || message.includes("unauthenticated")) return "登入狀態尚未通過，推薦資料暫不顯示。";
  return "Recommendation Orchestrator 資料同步中。";
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

function QualityBadges({ rec }: { rec: StockRecommendation }) {
  const items: Array<[string, QualityStatus]> = [
    ["報價", rec.dataQuality.quote],
    ["K線", rec.dataQuality.kbar],
    ["籌碼", rec.dataQuality.chip],
    ["新聞", rec.dataQuality.news],
    ["量化", rec.dataQuality.quant],
  ];
  const penaltyPct = Math.round(rec.dataQuality.confidencePenalty * 100);
  const weakItems = items
    .filter(([, value]) => value !== "OK")
    .map(([label, value]) => `${label}${qualityStatusLabel(value)}`);
  const summary = weakItems.length > 0
    ? `資料品質提醒：${weakItems.join("、")}；信心折減 ${penaltyPct}%`
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
        <b>Penalty</b>
        {penaltyPct}%
      </span>
    </div>
  );
}

function RecommendationCard({ rec }: { rec: StockRecommendation }) {
  const prefillHref = buildPrefillHref(rec);

  return (
    <article className="_rec-card" data-action={rec.action}>
      <div className="_rec-card-head">
        <div>
          <span className="_rec-rank">#{rec.rank}</span>
          <h3>
            <span>{rec.ticker}</span>
            {rec.companyName}
          </h3>
        </div>
        <div className="_rec-badges">
          <span data-tone={actionTone(rec.action)}>{rec.action}</span>
          <span>{rec.direction}</span>
          <span>{rec.timeHorizon}</span>
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

      <p className="_rec-research-note">以下為研究輸出，非投資建議。</p>
      <div className="_rec-trade-grid">
        <div>
          <span>進場參考區（研究）</span>
          <b>{rec.entryZone.primary || "資料同步中"}</b>
          {rec.entryZone.secondary && <small>{rec.entryZone.secondary}</small>}
          <p>{rec.entryZone.reason || "資料同步中"}</p>
        </div>
        <div>
          <span>訊號失效點（研究參考）</span>
          <b>{formatPrice(rec.invalidation.price)}</b>
          <p>{rec.invalidation.rule || "資料同步中"}</p>
        </div>
        <div>
          <span>倉位參考（研究用）</span>
          <b data-risk={rec.positionSizing.suggestion === "禁止追高" ? "hot" : undefined}>
            {rec.positionSizing.suggestion}
          </b>
          <p>風險上限 {rec.positionSizing.maxRiskPct}%</p>
        </div>
      </div>

      <div className="_rec-targets">
        {rec.targets.map((target) => (
          <span key={`${rec.recommendationId}-${target.label}`}>
            <b>{target.label}</b>
            {formatPrice(target.price)}
            <small>{target.reason}</small>
          </span>
        ))}
      </div>

      <details className="_rec-details" open>
        <summary>理由</summary>
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
          <p className="_rec-empty-text">資料同步中</p>
        )}
      </details>

      <QualityBadges rec={rec} />

      <details className="_rec-source">
        <summary>
          <Database size={14} strokeWidth={1.9} />
          sourceTrail
        </summary>
        <div>
          {rec.sourceTrail.length > 0 ? (
            rec.sourceTrail.map((source) => (
              <span key={`${source.type}-${source.source}-${source.timestamp}`}>
                <b>{source.type}</b>
                {source.source}
                <small>{source.timestamp}</small>
              </span>
            ))
          ) : (
            <p className="_rec-empty-text">資料同步中</p>
          )}
        </div>
      </details>

      <Link className="_rec-detail-link" href={`/ai-recommendations/${encodeURIComponent(rec.recommendationId)}`}>
        <FileSearch size={16} strokeWidth={1.9} />
        查看詳情
      </Link>

      <RecommendationHandoffLink
        href={prefillHref}
        recommendationId={rec.recommendationId}
        directionLabel={handoffLabelForDirection(rec.direction)}
      >
        <ArrowRight size={16} strokeWidth={1.9} />
        一鍵帶到交易室
      </RecommendationHandoffLink>
      <RecommendationFeedbackActions recommendationId={rec.recommendationId} />
    </article>
  );
}

function EmptyBucket({ message }: { message: string }) {
  return (
    <div className="_rec-empty">
      <b>資料同步中</b>
      <p>{message}</p>
    </div>
  );
}

function BucketSection({
  label,
  items,
  primary,
  error,
}: {
  label: BucketName;
  items: StockRecommendation[];
  primary: boolean;
  error: string | null;
}) {
  const body = (
    <div className="_rec-card-grid">
      {items.length > 0 ? (
        items.map((rec) => <RecommendationCard key={rec.recommendationId} rec={rec} />)
      ) : (
        <EmptyBucket message={error ?? "目前沒有符合此分層的推薦。"} />
      )}
    </div>
  );

  if (!primary) {
    return (
      <details className="_rec-section _rec-section-collapsed">
        <summary>
          <span>{label}</span>
          <b>{items.length}</b>
        </summary>
        {body}
      </details>
    );
  }

  return (
    <section className="_rec-section">
      <div className="_rec-section-head">
        <h2>{label}</h2>
        <span>{items.length} 檔</span>
      </div>
      {body}
    </section>
  );
}

export default async function AiRecommendationsPage() {
  const { data, error } = await loadRecommendations();
  const items = data?.items ?? [];
  const grouped = groupByBucket(items);
  const sourceMode = data?._mock ? "MOCK FEED" : data ? "ORCHESTRATOR" : "SYNCING";

  return (
    <PageFrame
      code="AI"
      title="AI 推薦"
      sub="Recommendation Orchestrator"
      note="推薦只呈現後端回傳資料；缺漏欄位顯示資料同步中或 -，不以前端假數字補位。"
    >
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
        ._rec-prefill:hover {
          color: var(--tac-fg-0);
          border-color: rgba(200, 148, 63, 0.42);
          background: rgba(200, 148, 63, 0.08);
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
        ._rec-card[data-action="高風險排除"],
        ._rec-card[data-action="資料不足暫不推薦"] {
          border-left-color: rgba(230, 57, 70, 0.78);
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
        @media (max-width: 1180px) {
          ._rec-bucket-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
          ._rec-trade-grid { grid-template-columns: 1fr; }
        }
        @media (max-width: 760px) {
          ._rec-bucket-grid,
          ._rec-card-grid,
          ._rec-score-grid,
          ._rec-reasons {
            grid-template-columns: 1fr;
          }
          ._rec-card-head {
            display: grid;
          }
        }
      `}</style>

      <div className="_rec-tabs" aria-label="AI 推薦子頁">
        <Link href="/runs">策略批次</Link>
        <Link href="/signals">訊號證據</Link>
      </div>

      <Panel
        code="AI-01"
        title="推薦分層"
        sub={`日期 ${data?.date ?? "-"} / 產生 ${data?.generatedAt ?? "-"} / ${sourceMode}`}
        right={`${items.length} recommendations`}
      >
        <div className="_rec-bucket-grid">
          {BUCKETS.map((bucket) => (
            <article key={bucket.label} className="_rec-bucket">
              <span>{bucket.range}</span>
              <b>{bucket.label}</b>
              <small>{grouped[bucket.label].length} 檔</small>
            </article>
          ))}
        </div>

        {BUCKETS.map((bucket) => (
          <BucketSection
            key={bucket.label}
            label={bucket.label}
            items={grouped[bucket.label]}
            primary={bucket.primary}
            error={error}
          />
        ))}
      </Panel>
    </PageFrame>
  );
}
