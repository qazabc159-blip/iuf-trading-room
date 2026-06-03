import Link from "next/link";
import type { ReactNode } from "react";
import type { StockRecommendation } from "@iuf-trading-room/contracts";
import { ArrowLeft, ArrowRight, Database, Gauge, ShieldAlert, Target } from "lucide-react";

import { PageFrame, Panel } from "@/components/PageFrame";
import { getRecommendationDetail, type RecommendationDetailResponse } from "@/lib/api";
import {
  buildRecommendationPrefillHref,
  handoffLabelForDirection,
  INVALID_AI_HANDOFF_TICKER_MESSAGE,
} from "@/lib/ai-recommendation-handoff";
import { RecommendationFeedbackActions } from "../RecommendationFeedbackActions";
import { RecommendationHandoffLink, RecommendationHandoffPreview, RecommendationHandoffUnavailable } from "../RecommendationHandoffLink";
import { formatRecommendationSourceMode } from "../source-mode-label";
import { formatRecommendationTimestamp, formatSourceTimestamp } from "../source-trail-time";

export const dynamic = "force-dynamic";

type QualityStatus = "OK" | "STALE" | "MISSING" | "WEAK";

const REASON_GROUPS: Array<{
  key: keyof StockRecommendation["reasons"];
  label: string;
}> = [
  { key: "technical", label: "技術" },
  { key: "chip", label: "籌碼" },
  { key: "news", label: "新聞" },
  { key: "theme", label: "主題" },
  { key: "quant", label: "量化" },
  { key: "macro", label: "總經" },
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
  if (value === "STALE") return "逾時";
  if (value === "MISSING") return "缺資料";
  return "偏弱";
}

function gateTone(value: StockRecommendation["quant"]["gateStatus"]) {
  if (value === "PASS") return "ok";
  if (value === "FAIL") return "bad";
  return "warn";
}

function safeMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("404") || message.includes("not_found")) return "找不到這筆推薦，可能已被新的 Orchestrator 版本替換。";
  if (message.includes("403") || message.includes("forbidden_role")) return "此帳號方案尚未開啟 AI 推薦詳情，請到訂閱/權限頁確認。";
  if (message.includes("401") || message.includes("unauthenticated")) return "登入狀態已失效，請重新整理後再試。";
  return "Recommendation Orchestrator 暫時無法回傳這筆詳情。";
}

async function loadRecommendation(id: string): Promise<{
  data: RecommendationDetailResponse | null;
  error: string | null;
}> {
  try {
    return { data: await getRecommendationDetail(id), error: null };
  } catch (error) {
    return { data: null, error: safeMessage(error) };
  }
}

function ScoreBlock({
  icon,
  label,
  value,
  width,
}: {
  icon: ReactNode;
  label: string;
  value: string | number;
  width: number;
}) {
  return (
    <div className="_rec-detail-score">
      <div>
        {icon}
        <span>{label}</span>
        <b>{value}</b>
      </div>
      <i style={{ width: `${Math.max(0, Math.min(100, width))}%` }} />
    </div>
  );
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
    ? `${weakItems.join("、")}；信心折減 ${penaltyPct}%。`
    : `資料品質正常；信心折減 ${penaltyPct}%。`;

  return (
    <section className="_rec-detail-quality-wrap" aria-labelledby="rec-detail-quality-title">
      <div className="_rec-detail-quality-head">
        <b id="rec-detail-quality-title">資料品質</b>
        <span>{summary}</span>
      </div>
      <div className="_rec-detail-quality" aria-label="資料品質欄位狀態">
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
    </section>
  );
}

function ReasonSection({ title, items }: { title: string; items: string[] }) {
  return (
    <section>
      <b>{title}</b>
      {items.length > 0 ? (
        <ul>
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        <span>-</span>
      )}
    </section>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <PageFrame code="AI-D" title="AI 推薦詳情" sub="Recommendation Orchestrator">
      <Panel code="AI-D" title="讀取失敗" right={<Link href="/ai-recommendations">回推薦列表</Link>}>
        <div className="_rec-detail-empty">
          <b>{message}</b>
          <p>這裡不會用假資料補畫面；等 Orchestrator 回來後再顯示完整推薦。</p>
        </div>
      </Panel>
      <style>{`
        ._rec-detail-empty {
          display: grid;
          gap: 8px;
          border: 1px dashed rgba(200, 148, 63, 0.28);
          border-radius: 8px;
          padding: 26px;
          color: var(--tac-fg-2);
          background: rgba(8, 11, 16, 0.36);
        }
        ._rec-detail-empty b {
          color: var(--tac-fg-0);
          font: 850 15px/1.4 var(--sans-tc);
        }
        ._rec-detail-empty p {
          margin: 0;
          color: var(--tac-fg-3);
          font-size: 12px;
          line-height: 1.65;
        }
      `}</style>
    </PageFrame>
  );
}

export default async function AiRecommendationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { data, error } = await loadRecommendation(id);
  const rec = data?.data ?? null;

  if (!rec) return <ErrorState message={error ?? "推薦詳情不存在。"} />;

  const prefillHref = buildRecommendationPrefillHref(rec);
  const sourceMode = formatRecommendationSourceMode({
    hasData: Boolean(data),
    isMock: Boolean(data?._mock),
  });
  const generatedAtLabel = formatRecommendationTimestamp(rec.generatedAt);

  return (
    <PageFrame code="AI-D" title={`${rec.ticker} ${rec.companyName}`} sub="AI 推薦詳情 / Recommendation Orchestrator">
      <style>{`
        ._rec-detail-nav {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-bottom: 12px;
        }
        ._rec-detail-nav a,
        ._rec-detail-actions a,
        ._rec-detail-actions span._rec-prefill {
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
        ._rec-detail-actions ._rec-prefill {
          color: var(--tac-brand);
          border-color: rgba(200, 148, 63, 0.35);
        }
        ._rec-detail-actions ._rec-prefill-disabled {
          color: var(--tac-fg-3);
          border-style: dashed;
          border-color: rgba(230, 57, 70, 0.28);
          background: rgba(230, 57, 70, 0.05);
          cursor: not-allowed;
        }
        ._rec-detail-nav a:hover,
        ._rec-detail-actions a:hover {
          color: var(--tac-fg-0);
          border-color: rgba(200, 148, 63, 0.5);
          background: rgba(200, 148, 63, 0.1);
        }
        ._rec-prefill-side {
          border-left: 1px solid rgba(200, 148, 63, 0.28);
          padding-left: 7px;
          color: var(--tac-brand);
          font-weight: 900;
          white-space: nowrap;
        }
        ._rec-detail-shell {
          display: grid;
          gap: 13px;
        }
        ._rec-detail-head {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 12px;
          align-items: start;
        }
        ._rec-detail-title {
          display: grid;
          gap: 7px;
        }
        ._rec-detail-title h2 {
          margin: 0;
          color: var(--tac-fg-0);
          font: 900 24px/1.2 var(--sans-tc);
        }
        ._rec-detail-title p {
          margin: 0;
          color: var(--tac-fg-3);
          font-size: 12px;
          line-height: 1.65;
        }
        ._rec-detail-badges,
        ._rec-detail-quality,
        ._rec-detail-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 7px;
        }
        ._rec-detail-quality-wrap {
          display: grid;
          gap: 8px;
          border: 1px solid var(--tac-line);
          border-radius: 6px;
          padding: 10px;
          background: rgba(8, 11, 16, 0.38);
        }
        ._rec-detail-quality-head {
          display: grid;
          gap: 3px;
        }
        ._rec-detail-quality-head b {
          color: var(--tac-brand);
          font: 900 10px/1 var(--mono);
          letter-spacing: 0;
        }
        ._rec-detail-quality-head span {
          color: var(--tac-fg-2);
          font: 800 12px/1.55 var(--sans-tc);
        }
        ._rec-detail-badges span,
        ._rec-detail-quality span,
        ._rec-detail-gate {
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
        ._rec-detail-quality span {
          min-height: 38px;
          display: inline-grid;
          grid-template-columns: 1fr;
          align-items: center;
        }
        ._rec-detail-quality b {
          color: var(--tac-fg-3);
          font: 900 9px/1 var(--sans-tc);
        }
        ._rec-detail-quality span[data-tone="ok"],
        ._rec-detail-gate[data-tone="ok"] {
          color: var(--tac-ok);
          border-color: rgba(46, 204, 113, 0.34);
          background: rgba(46, 204, 113, 0.06);
        }
        ._rec-detail-quality span[data-tone="warn"],
        ._rec-detail-gate[data-tone="warn"] {
          color: var(--tac-warn);
          border-color: rgba(200, 148, 63, 0.34);
          background: rgba(200, 148, 63, 0.06);
        }
        ._rec-detail-quality span[data-tone="bad"],
        ._rec-detail-gate[data-tone="bad"] {
          color: var(--tac-bad);
          border-color: rgba(230, 57, 70, 0.34);
          background: rgba(230, 57, 70, 0.06);
        }
        ._rec-detail-score-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 10px;
        }
        ._rec-detail-score,
        ._rec-detail-card,
        ._rec-detail-reasons section {
          min-width: 0;
          border: 1px solid var(--tac-line);
          border-radius: 6px;
          padding: 10px;
          background: rgba(8, 11, 16, 0.38);
        }
        ._rec-detail-score div {
          display: flex;
          align-items: center;
          gap: 8px;
          color: var(--tac-fg-2);
          font: 800 11px/1 var(--sans-tc);
        }
        ._rec-detail-score b {
          margin-left: auto;
          color: var(--tac-fg-0);
          font: 900 18px/1 var(--mono);
        }
        ._rec-detail-score i {
          display: block;
          height: 4px;
          margin-top: 10px;
          border-radius: 99px;
          background: linear-gradient(90deg, var(--tac-brand), var(--tac-ok));
        }
        ._rec-detail-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 10px;
        }
        ._rec-detail-card {
          display: grid;
          gap: 7px;
        }
        ._rec-detail-card span {
          color: var(--tac-brand);
          font: 900 10px/1 var(--mono);
        }
        ._rec-detail-card b {
          color: var(--tac-fg-0);
          font: 850 14px/1.35 var(--sans-tc);
          overflow-wrap: anywhere;
        }
        ._rec-detail-card p,
        ._rec-detail-card small {
          margin: 0;
          color: var(--tac-fg-3);
          font-size: 12px;
          line-height: 1.58;
        }
        ._rec-detail-reasons {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
        }
        ._rec-detail-reasons b {
          color: var(--tac-brand);
          font: 900 10px/1 var(--mono);
        }
        ._rec-detail-reasons ul,
        ._rec-detail-risks {
          margin: 8px 0 0;
          padding-left: 17px;
          color: var(--tac-fg-2);
          font-size: 12px;
          line-height: 1.62;
        }
        ._rec-detail-reasons span {
          display: block;
          margin-top: 8px;
          color: var(--tac-fg-3);
          font: 800 12px/1 var(--mono);
        }
        ._rec-detail-source {
          display: grid;
          gap: 7px;
        }
        ._rec-detail-source span {
          display: grid;
          grid-template-columns: 78px minmax(0, 1fr);
          gap: 8px;
          color: var(--tac-fg-2);
          font: 12px/1.45 var(--mono);
          overflow-wrap: anywhere;
        }
        ._rec-detail-source b {
          color: var(--tac-brand);
        }
        ._rec-detail-source small {
          grid-column: 2;
          color: var(--tac-fg-3);
        }
        ._rec-handoff-preview {
          flex-basis: 100%;
          max-width: 760px;
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
        @media (max-width: 900px) {
          ._rec-detail-head,
          ._rec-detail-score-grid,
          ._rec-detail-grid,
          ._rec-detail-reasons {
            grid-template-columns: 1fr;
          }
        }
      `}</style>

      <div className="_rec-detail-nav">
        <Link href="/ai-recommendations">
          <ArrowLeft size={16} strokeWidth={1.9} />
          回 AI 推薦
        </Link>
      </div>

      <Panel
        code="AI-D"
        title="推薦詳情"
        sub={`${rec.date} / ${generatedAtLabel} / ${sourceMode}`}
        right={`#${rec.rank}`}
      >
        <article className="_rec-detail-shell">
          <header className="_rec-detail-head">
            <div className="_rec-detail-title">
              <h2>{rec.ticker} {rec.companyName}</h2>
              <div className="_rec-detail-badges">
                <span>{rec.action}</span>
                <span>{rec.direction}</span>
                <span>{rec.timeHorizon}</span>
              </div>
              <p>所有欄位只呈現 Orchestrator 回傳內容；缺資料直接顯示空值或同步中，不用假數字補畫面。</p>
            </div>
            <span className="_rec-detail-gate" data-tone={gateTone(rec.quant.gateStatus)}>
              {rec.quant.gateStatus}
            </span>
          </header>

          <div className="_rec-detail-score-grid">
            <ScoreBlock
              icon={<Gauge size={16} strokeWidth={1.9} />}
              label="總分"
              value={rec.totalScore}
              width={rec.totalScore}
            />
            <ScoreBlock
              icon={<Target size={16} strokeWidth={1.9} />}
              label="信心"
              value={asPercent(rec.confidence)}
              width={Math.round(rec.confidence * 100)}
            />
            <ScoreBlock
              icon={<Database size={16} strokeWidth={1.9} />}
              label="Quant"
              value={rec.quant.score}
              width={rec.quant.score}
            />
          </div>

          <QualityBadges rec={rec} />

          <div className="_rec-detail-grid">
            <section className="_rec-detail-card">
              <span>進場區</span>
              <b>{rec.entryZone.primary || "資料同步中"}</b>
              {rec.entryZone.secondary && <small>{rec.entryZone.secondary}</small>}
              <p>{rec.entryZone.reason || "-"}</p>
            </section>
            <section className="_rec-detail-card">
              <span>失效條件</span>
              <b>{formatPrice(rec.invalidation.price)}</b>
              <p>{rec.invalidation.rule || "-"}</p>
            </section>
            <section className="_rec-detail-card">
              <span>倉位建議</span>
              <b>{rec.positionSizing.suggestion}</b>
              <p>單筆最大風險 {rec.positionSizing.maxRiskPct}%</p>
            </section>
          </div>

          <div className="_rec-detail-grid">
            {rec.targets.map((target) => (
              <section key={`${rec.recommendationId}-${target.label}`} className="_rec-detail-card">
                <span>{target.label}</span>
                <b>{formatPrice(target.price)}</b>
                <p>{target.reason || "-"}</p>
              </section>
            ))}
          </div>

          <div className="_rec-detail-card">
            <span>量化來源</span>
            <b>{rec.quant.strategySource}</b>
            <ul className="_rec-detail-risks">
              {rec.quant.reason.length > 0 ? rec.quant.reason.map((item) => <li key={item}>{item}</li>) : <li>-</li>}
            </ul>
          </div>

          <div className="_rec-detail-reasons">
            {REASON_GROUPS.map((group) => (
              <ReasonSection key={group.key} title={group.label} items={rec.reasons[group.key]} />
            ))}
          </div>

          <div className="_rec-detail-card">
            <span>風險</span>
            {rec.risks.length > 0 ? (
              <ul className="_rec-detail-risks">
                {rec.risks.map((risk) => (
                  <li key={risk}>{risk}</li>
                ))}
              </ul>
            ) : (
              <p>-</p>
            )}
          </div>

          <div className="_rec-detail-card">
            <span>
              <ShieldAlert size={14} strokeWidth={1.9} />
              資料來源
            </span>
            <div className="_rec-detail-source">
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
                <p>-</p>
              )}
            </div>
          </div>

          <div className="_rec-detail-actions">
            {prefillHref ? (
              <>
                <RecommendationHandoffPreview href={prefillHref} recommendationId={rec.recommendationId} />
                <RecommendationHandoffLink
                  href={prefillHref}
                  recommendationId={rec.recommendationId}
                  directionLabel={handoffLabelForDirection(rec.direction)}
                >
                  <ArrowRight size={16} strokeWidth={1.9} />
                  一鍵帶到交易室
                </RecommendationHandoffLink>
              </>
            ) : (
              <RecommendationHandoffUnavailable reason={INVALID_AI_HANDOFF_TICKER_MESSAGE}>
                <ShieldAlert size={16} strokeWidth={1.9} />
                未帶入交易室
              </RecommendationHandoffUnavailable>
            )}
          </div>
          <RecommendationFeedbackActions recommendationId={rec.recommendationId} />
        </article>
      </Panel>
    </PageFrame>
  );
}
