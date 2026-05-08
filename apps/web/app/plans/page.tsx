import Link from "next/link";

import { PageFrame } from "@/components/PageFrame";
import { MetricStrip } from "@/components/RadarWidgets";
import {
  getBriefs,
  getCompanies,
  getPlans,
  getReviews,
  getSignals,
  getStrategyIdeas,
  getThemes,
} from "@/lib/api";
import { friendlyDataError } from "@/lib/friendly-error";
import { briefAgeCopy, briefAgeDays, briefFreshnessBadge, briefFreshnessForDate, briefFreshnessLabel, briefFreshnessTone } from "@/lib/freshness";
import { cleanExternalHeadline, cleanNarrativeText, cleanRiskRewardText, cleanTradePlanText } from "@/lib/operator-copy";
import { reasonLabel } from "@/lib/strategy-vocab";

export const dynamic = "force-dynamic";

type PlanRow = Awaited<ReturnType<typeof getPlans>>["data"][number];
type CompanyRow = Awaited<ReturnType<typeof getCompanies>>["data"][number];
type ThemeRow = Awaited<ReturnType<typeof getThemes>>["data"][number];
type SignalRow = Awaited<ReturnType<typeof getSignals>>["data"][number];
type BriefRow = Awaited<ReturnType<typeof getBriefs>>["data"][number];
type ReviewRow = Awaited<ReturnType<typeof getReviews>>["data"][number];
type IdeaRow = Awaited<ReturnType<typeof getStrategyIdeas>>["data"]["items"][number];
type PlansData = {
  plans: PlanRow[];
  companies: CompanyRow[];
  themes: ThemeRow[];
  signals: SignalRow[];
  briefs: BriefRow[];
  reviews: ReviewRow[];
  ideas: IdeaRow[];
};
type LoadState =
  | { state: "LIVE"; data: PlansData; updatedAt: string; source: string }
  | { state: "EMPTY"; data: PlansData; updatedAt: string; source: string; reason: string }
  | { state: "BLOCKED"; data: PlansData; updatedAt: string; source: string; reason: string };

const emptyData: PlansData = {
  plans: [],
  companies: [],
  themes: [],
  signals: [],
  briefs: [],
  reviews: [],
  ideas: [],
};

async function loadPlans(): Promise<LoadState> {
  const source = "正式交易計畫資料";
  const updatedAt = new Date().toISOString();

  try {
    const [plansEnvelope, companiesEnvelope, themesEnvelope, signalsEnvelope, briefsEnvelope, reviewsEnvelope, ideasEnvelope] = await Promise.all([
      getPlans(),
      getCompanies(),
      getThemes(),
      getSignals(),
      getBriefs(),
      getReviews(),
      getStrategyIdeas({
        decisionMode: "paper",
        includeBlocked: true,
        limit: 12,
        sort: "score",
      }),
    ]);
    const data: PlansData = {
      plans: plansEnvelope.data,
      companies: companiesEnvelope.data,
      themes: themesEnvelope.data,
      signals: signalsEnvelope.data,
      briefs: briefsEnvelope.data,
      reviews: reviewsEnvelope.data,
      ideas: ideasEnvelope.data.items,
    };
    if (data.plans.length === 0 && data.briefs.length === 0 && data.ideas.length === 0) {
      return {
        state: "EMPTY",
        data,
        updatedAt,
        source,
        reason: "交易計畫、簡報與策略想法目前沒有可處理資料列。",
      };
    }
    return { state: "LIVE", data, updatedAt, source };
  } catch (error) {
    return {
      state: "BLOCKED",
      data: emptyData,
      updatedAt,
      source,
      reason: friendlyDataError(error, "交易計畫暫時無法讀取。"),
    };
  }
}

function formatTime(value: string | null | undefined) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString("zh-TW", { hour12: false });
}

function formatDate(value: string | null | undefined) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("zh-TW", { month: "2-digit", day: "2-digit" });
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-TW", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function stateTone(state: LoadState["state"]) {
  if (state === "LIVE") return "status-ok";
  if (state === "EMPTY") return "gold";
  return "status-bad";
}

function stateLabel(state: LoadState["state"]) {
  if (state === "LIVE") return "正常";
  if (state === "EMPTY") return "無資料";
  return "暫停";
}

function planStatusLabel(status: PlanRow["status"]) {
  if (status === "ready") return "就緒";
  if (status === "active") return "進行中";
  if (status === "closed") return "已結案";
  if (status === "canceled") return "取消";
  if (status === "reduced") return "降碼";
  return status;
}

function planStatusColors(status: PlanRow["status"]) {
  if (status === "active") return { bg: "rgba(46,204,113,0.12)", border: "rgba(46,204,113,0.45)", text: "#4adb88" };
  if (status === "ready") return { bg: "rgba(59,130,246,0.12)", border: "rgba(59,130,246,0.45)", text: "#60a5fa" };
  if (status === "reduced") return { bg: "rgba(200,148,63,0.12)", border: "rgba(200,148,63,0.45)", text: "#e2b85c" };
  if (status === "closed") return { bg: "rgba(145,160,181,0.07)", border: "rgba(145,160,181,0.22)", text: "#566276" };
  return { bg: "rgba(230,57,70,0.07)", border: "rgba(230,57,70,0.28)", text: "#ff6b77" };
}

function directionLabel(direction: IdeaRow["direction"]) {
  if (direction === "bullish") return "偏多";
  if (direction === "bearish") return "偏空";
  return "中性";
}

function decisionLabel(decision: IdeaRow["marketData"]["decision"]) {
  if (decision === "allow") return "可觀察";
  if (decision === "review") return "待審";
  return "不進流程";
}

function decisionColors(decision: IdeaRow["marketData"]["decision"]) {
  if (decision === "allow") return { bg: "rgba(46,204,113,0.10)", border: "rgba(46,204,113,0.35)", text: "#4adb88" };
  if (decision === "review") return { bg: "rgba(200,148,63,0.10)", border: "rgba(200,148,63,0.35)", text: "#e2b85c" };
  return { bg: "rgba(230,57,70,0.08)", border: "rgba(230,57,70,0.28)", text: "#ff6b77" };
}

function directionColors(direction: IdeaRow["direction"]) {
  if (direction === "bullish") return { text: "#ff6b77", border: "rgba(230,57,70,0.5)" };
  if (direction === "bearish") return { text: "#4adb88", border: "rgba(46,204,113,0.5)" };
  return { text: "#91a0b5", border: "rgba(145,160,181,0.3)" };
}

function marketStateLabel(value: string | null | undefined) {
  if (value === "Attack") return "進攻";
  if (value === "Selective Attack") return "選擇進攻";
  if (value === "Defense") return "防守";
  if (value === "Preservation") return "保全";
  if (value === "Balanced") return "平衡";
  return value ?? "--";
}

function signalCategoryLabel(value: string | null | undefined) {
  if (!value) return "未分類";
  const key = value.toLowerCase();
  if (key === "industry") return "產業";
  if (key === "theme") return "主題";
  if (key === "earnings") return "財報";
  if (key === "revenue") return "營收";
  if (key === "news") return "新聞";
  if (key === "company") return "公司";
  if (key === "market") return "市場";
  if (key === "technical") return "技術";
  if (key === "fundamental") return "基本面";
  if (key === "test" || key === "dryrun") return "驗證";
  return value.replace(/[_-]/g, " ");
}

function companyForPlan(plan: PlanRow, companies: CompanyRow[]) {
  return companies.find((company) => company.id === plan.companyId) ?? null;
}

const PLANS_CSS = `
._pln-hero-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
  gap: 1px;
  background: rgba(220,228,240,0.09);
  border: 1px solid rgba(220,228,240,0.13);
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: 28px;
}
._pln-hero-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 18px 20px;
  background: rgba(8,11,16,0.82);
  transition: background 0.15s;
}
._pln-hero-cell:hover { background: rgba(255,255,255,0.03); }
._pln-hero-val {
  font-size: 30px;
  font-weight: 800;
  letter-spacing: -1px;
  line-height: 1;
  font-family: var(--mono, monospace);
  font-variant-numeric: tabular-nums;
}
._pln-hero-lbl {
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgba(145,160,181,0.65);
  font-family: var(--mono, monospace);
}
._pln-workbench {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
  gap: 20px;
  align-items: start;
}
._pln-section {
  background: rgba(8,11,16,0.65);
  border: 1px solid rgba(220,228,240,0.09);
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: 16px;
}
._pln-section:last-child { margin-bottom: 0; }
._pln-section-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 20px 12px;
  border-bottom: 1px solid rgba(220,228,240,0.07);
  background: rgba(255,255,255,0.02);
}
._pln-section-primary {
  border-left: 3px solid rgba(200,148,63,0.55);
  background: linear-gradient(135deg, rgba(200,148,63,0.04), transparent 40%), rgba(8,11,16,0.65);
}
._pln-section-primary._pln-section-head {
  background: rgba(200,148,63,0.04);
}
._pln-section-code {
  font-size: 9px;
  font-family: var(--mono, monospace);
  letter-spacing: 0.08em;
  color: rgba(145,160,181,0.4);
  text-transform: uppercase;
}
._pln-section-title {
  font-size: 13px;
  font-weight: 700;
  color: #e7ecf3;
}
._pln-section-count {
  font-size: 11px;
  font-family: var(--mono, monospace);
  color: rgba(145,160,181,0.6);
  margin-left: auto;
}
._pln-state-badge {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  padding: 2px 9px;
  border-radius: 3px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.05em;
  font-family: var(--mono, monospace);
}
._pln-section-body {
  padding: 14px 20px;
}
._pln-plan-ledger {
  display: grid;
  gap: 10px;
}
._pln-plan-card {
  position: relative;
  padding: 16px 18px;
  border-radius: 3px;
  border: 1px solid rgba(220,228,240,0.07);
  border-left: 3px solid;
  background: rgba(10,14,20,0.65);
  transition: transform 0.12s ease, background 0.12s;
}
._pln-plan-card:hover {
  transform: translateY(-2px);
  background: rgba(14,18,26,0.85);
}
@media (prefers-reduced-motion: reduce) {
  ._pln-plan-card { transition: none; }
  ._pln-plan-card:hover { transform: none; }
}
._pln-card-top {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
._pln-ticker-link {
  font-size: 14px;
  font-weight: 800;
  font-family: var(--mono, monospace);
  letter-spacing: 0.04em;
  color: #e2b85c;
  text-decoration: none;
}
._pln-ticker-link:hover { color: #ffd87a; }
._pln-status-pill {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 3px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.05em;
  font-family: var(--mono, monospace);
  border: 1px solid;
}
._pln-company-name {
  font-size: 11px;
  color: rgba(145,160,181,0.65);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}
._pln-plan-entry {
  font-size: 12px;
  color: rgba(220,228,240,0.75);
  line-height: 1.55;
  margin-bottom: 10px;
}
._pln-plan-meta {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
}
._pln-plan-meta-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
._pln-plan-meta-dt {
  font-size: 9px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgba(145,160,181,0.45);
  font-family: var(--mono, monospace);
}
._pln-plan-meta-dd {
  font-size: 11px;
  font-family: var(--mono, monospace);
  color: rgba(220,228,240,0.7);
}
._pln-idea-rail {
  display: grid;
  gap: 8px;
}
._pln-idea-ticket {
  position: relative;
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 10px;
  align-items: center;
  padding: 10px 14px;
  border-radius: 3px;
  border: 1px solid rgba(220,228,240,0.07);
  background: rgba(10,14,20,0.55);
  transition: background 0.12s;
}
._pln-idea-ticket:hover { background: rgba(14,18,26,0.8); }
._pln-idea-symbol {
  font-size: 13px;
  font-weight: 800;
  font-family: var(--mono, monospace);
  color: #e2b85c;
}
._pln-idea-score {
  font-size: 11px;
  font-family: var(--mono, monospace);
  color: rgba(145,160,181,0.7);
}
._pln-idea-mid {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
._pln-dir-badge {
  display: inline-flex;
  align-items: center;
  padding: 1px 7px;
  border-radius: 2px;
  font-size: 10px;
  font-weight: 600;
  font-family: var(--mono, monospace);
  border: 1px solid;
  width: fit-content;
}
._pln-reason-text {
  font-size: 11px;
  color: rgba(145,160,181,0.7);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
._pln-brief-card {
  background: rgba(8,11,16,0.65);
  border: 1px solid rgba(220,228,240,0.09);
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: 16px;
}
._pln-brief-card:last-child { margin-bottom: 0; }
._pln-brief-sections {
  padding: 12px 18px 16px;
  display: grid;
  gap: 10px;
}
._pln-brief-section {
  padding: 10px 14px;
  border-radius: 3px;
  background: rgba(200,148,63,0.04);
  border-left: 2px solid rgba(200,148,63,0.3);
}
._pln-brief-heading {
  font-size: 11px;
  font-weight: 700;
  color: #e2b85c;
  letter-spacing: 0.02em;
  margin-bottom: 4px;
}
._pln-brief-body {
  font-size: 12px;
  color: rgba(145,160,181,0.75);
  line-height: 1.6;
}
._pln-signal-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 0;
  border-bottom: 1px solid rgba(220,228,240,0.05);
}
._pln-signal-row:last-child { border-bottom: none; }
._pln-signal-ts {
  font-size: 10px;
  font-family: var(--mono, monospace);
  color: rgba(145,160,181,0.45);
  white-space: nowrap;
  flex-shrink: 0;
}
._pln-signal-cat {
  font-size: 10px;
  font-family: var(--mono, monospace);
  color: rgba(200,148,63,0.8);
  white-space: nowrap;
  flex-shrink: 0;
}
._pln-signal-text {
  font-size: 11px;
  color: rgba(145,160,181,0.7);
  line-height: 1.5;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}
._pln-review-row {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 10px;
  align-items: flex-start;
  padding: 10px 0;
  border-bottom: 1px solid rgba(220,228,240,0.05);
}
._pln-review-row:last-child { border-bottom: none; }
._pln-q-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: 1px solid;
  font-size: 12px;
  font-weight: 700;
  font-family: var(--mono, monospace);
  flex-shrink: 0;
}
._pln-review-text {
  font-size: 12px;
  color: rgba(145,160,181,0.75);
  line-height: 1.5;
}
._pln-empty-note {
  padding: 20px 0;
  font-size: 12px;
  color: rgba(145,160,181,0.5);
  text-align: center;
  font-style: italic;
}
._pln-lock-note {
  padding: 14px 18px;
  background: rgba(145,160,181,0.04);
  border: 1px solid rgba(145,160,181,0.1);
  border-left: 3px solid rgba(145,160,181,0.25);
  border-radius: 4px;
  margin-top: 16px;
}
._pln-lock-note-title {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: rgba(145,160,181,0.6);
  font-family: var(--mono, monospace);
  margin-bottom: 6px;
  text-transform: uppercase;
}
._pln-lock-note-body {
  font-size: 12px;
  color: rgba(145,160,181,0.65);
  line-height: 1.6;
}
@media (max-width: 900px) {
  ._pln-workbench { grid-template-columns: 1fr; }
}
`;

export default async function PlansPage() {
  const result = await loadPlans();
  const plans = result.data.plans.slice().sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
  const latestBrief = result.data.briefs.slice().sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))[0] ?? null;
  const contextLive = result.state === "LIVE";
  const latestBriefAgeDays = briefAgeDays(latestBrief?.date);
  const latestBriefFreshness = contextLive ? briefFreshnessForDate(latestBrief?.date) : "BLOCKED";
  const readyPlans = plans.filter((plan) => plan.status === "ready" || plan.status === "active").length;
  const reviewedPlanIds = new Set(result.data.reviews.map((review) => review.tradePlanId));
  const countsAvailable = result.state !== "BLOCKED";

  const stateBadgeStyle = result.state === "LIVE"
    ? { background: "rgba(46,204,113,0.12)", borderColor: "rgba(46,204,113,0.45)", color: "#4adb88" }
    : result.state === "EMPTY"
    ? { background: "rgba(200,148,63,0.12)", borderColor: "rgba(200,148,63,0.45)", color: "#e2b85c" }
    : { background: "rgba(230,57,70,0.10)", borderColor: "rgba(230,57,70,0.35)", color: "#ff6b77" };

  return (
    <PageFrame
      code="09"
      title="交易計畫"
      sub="計畫書與審核佇列"
      note="交易計畫 / 正式交易計畫、簡報、覆盤、訊號與策略想法；本頁不提供模擬或實盤下單。"
    >
      <style>{PLANS_CSS}</style>

      {/* Hero KPI row */}
      <div className="_pln-hero-row">
        <div className="_pln-hero-cell">
          <span className="_pln-hero-val" style={{ color: countsAvailable ? "#e7ecf3" : "#566276" }}>
            {countsAvailable ? plans.length : "--"}
          </span>
          <span className="_pln-hero-lbl">交易計畫</span>
        </div>
        <div className="_pln-hero-cell">
          <span className="_pln-hero-val" style={{ color: countsAvailable && readyPlans > 0 ? "#4adb88" : "#566276" }}>
            {countsAvailable ? readyPlans : "--"}
          </span>
          <span className="_pln-hero-lbl">就緒 / 進行</span>
        </div>
        <div className="_pln-hero-cell">
          <span className="_pln-hero-val" style={{ color: countsAvailable && result.data.ideas.length > 0 ? "#60a5fa" : "#566276" }}>
            {countsAvailable ? result.data.ideas.length : "--"}
          </span>
          <span className="_pln-hero-lbl">策略想法</span>
        </div>
        <div className="_pln-hero-cell">
          <span className="_pln-hero-val" style={{ color: countsAvailable && result.data.reviews.length > 0 ? "#e2b85c" : "#566276" }}>
            {countsAvailable ? result.data.reviews.length : "--"}
          </span>
          <span className="_pln-hero-lbl">覆盤</span>
        </div>
        <div className="_pln-hero-cell">
          <span className="_pln-hero-val" style={{ color: countsAvailable && result.data.briefs.length > 0 ? "#e2b85c" : "#566276" }}>
            {countsAvailable ? result.data.briefs.length : "--"}
          </span>
          <span className="_pln-hero-lbl">每日簡報</span>
        </div>
        <div className="_pln-hero-cell">
          <span className="_pln-hero-val" style={{ color: countsAvailable ? "#e7ecf3" : "#566276" }}>
            {countsAvailable ? result.data.signals.length : "--"}
          </span>
          <span className="_pln-hero-lbl">訊號脈絡</span>
        </div>
      </div>

      <MetricStrip
        cells={[
          { label: "狀態", value: stateLabel(result.state), tone: stateTone(result.state) },
          { label: "計畫", value: countsAvailable ? plans.length : "--" },
          { label: "就緒", value: countsAvailable ? readyPlans : "--", tone: countsAvailable && readyPlans > 0 ? "status-ok" : "muted" },
          { label: "覆盤", value: countsAvailable ? result.data.reviews.length : "--" },
          { label: "簡報", value: countsAvailable ? result.data.briefs.length : "--", tone: countsAvailable && result.data.briefs.length > 0 ? "gold" : "muted" },
          { label: "想法", value: countsAvailable ? result.data.ideas.length : "--", tone: countsAvailable && result.data.ideas.length > 0 ? "up" : "muted" },
          { label: "訊號", value: countsAvailable ? result.data.signals.length : "--" },
        ]}
        columns={7}
      />

      <div className="_pln-workbench">
        {/* Primary column */}
        <div>
          {/* Plans */}
          <div className="_pln-section _pln-section-primary">
            <div className="_pln-section-head">
              <span className="_pln-section-code">交易計畫</span>
              <span className="_pln-section-title">決策工作台</span>
              <span
                className="_pln-state-badge"
                style={{ background: stateBadgeStyle.background, border: `1px solid ${stateBadgeStyle.borderColor}`, color: stateBadgeStyle.color }}
              >
                {stateLabel(result.state)}
              </span>
            </div>
            <div className="_pln-section-body">
              <div className="tg soft" style={{ display: "flex", gap: 10, margin: "0 0 14px", fontSize: 11 }}>
                <span style={{ fontWeight: 700 }} className={stateTone(result.state)}>{stateLabel(result.state)}</span>
                <span>來源：{result.source}</span>
                <span>更新 {formatTime(result.updatedAt)}</span>
                {result.state !== "LIVE" && <span>{(result as { reason?: string }).reason}</span>}
              </div>

              {result.state !== "LIVE" && (
                <div style={{ padding: "20px 0", textAlign: "center", color: "rgba(145,160,181,0.55)", fontSize: 12, fontStyle: "italic" }}>
                  {(result as { reason?: string }).reason ?? "資料暫停"}
                </div>
              )}

              {plans.length === 0 && result.state === "LIVE" && (
                <div style={{ padding: "24px 0", textAlign: "center" }}>
                  <div style={{ fontSize: 14, color: "#c6d0de", marginBottom: 6 }}>目前沒有交易計畫</div>
                  <div style={{ fontSize: 12, color: "#566276" }}>計畫由操作員建立後會顯示在此</div>
                </div>
              )}

              {plans.length > 0 && (
                <div className="_pln-plan-ledger">
                  {plans.slice(0, 12).map((plan) => {
                    const company = companyForPlan(plan, result.data.companies);
                    const reviewed = reviewedPlanIds.has(plan.id);
                    const sc = planStatusColors(plan.status);
                    return (
                      <div
                        key={plan.id}
                        className="_pln-plan-card"
                        style={{ borderLeftColor: sc.border }}
                      >
                        <div className="_pln-card-top">
                          {company ? (
                            <Link href={`/companies/${company.ticker}`} className="_pln-ticker-link">
                              {company.ticker}
                            </Link>
                          ) : (
                            <span className="tg muted" style={{ fontSize: 13, fontFamily: "var(--mono)" }}>--</span>
                          )}
                          <span
                            className="_pln-status-pill"
                            style={{ background: sc.bg, borderColor: sc.border, color: sc.text }}
                          >
                            {planStatusLabel(plan.status)}
                          </span>
                          {company?.name && (
                            <span className="_pln-company-name">{company.name}</span>
                          )}
                        </div>
                        <div className="_pln-plan-entry">
                          {cleanTradePlanText(plan.entryPlan)}
                        </div>
                        <div className="_pln-plan-meta">
                          <div className="_pln-plan-meta-item">
                            <span className="_pln-plan-meta-dt">風報</span>
                            <span className="_pln-plan-meta-dd">{cleanRiskRewardText(plan.riskReward)}</span>
                          </div>
                          <div className="_pln-plan-meta-item">
                            <span className="_pln-plan-meta-dt">覆盤</span>
                            <span className="_pln-plan-meta-dd" style={{ color: reviewed ? "#e2b85c" : "#566276" }}>
                              {reviewed ? "有" : "無"}
                            </span>
                          </div>
                          <div className="_pln-plan-meta-item">
                            <span className="_pln-plan-meta-dt">更新</span>
                            <span className="_pln-plan-meta-dd">{formatDate(plan.updatedAt)}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Ideas */}
          <div className="_pln-section">
            <div className="_pln-section-head">
              <span className="_pln-section-code">策略想法</span>
              <span className="_pln-section-title">候選清單</span>
              <span className="_pln-section-count">{contextLive ? `${result.data.ideas.length} 筆` : "暫停"}</span>
            </div>
            <div className="_pln-section-body">
              {!contextLive && <div className="_pln-empty-note">交易計畫來源未正常時，策略想法先隱藏。</div>}
              {contextLive && result.data.ideas.length === 0 && <div className="_pln-empty-note">目前沒有策略想法</div>}
              {contextLive && result.data.ideas.length > 0 && (
                <div className="_pln-idea-rail">
                  {result.data.ideas.slice(0, 8).map((idea) => {
                    const dc = decisionColors(idea.marketData.decision);
                    const dirc = directionColors(idea.direction);
                    return (
                      <div key={`${idea.companyId}-${idea.symbol}`} className="_pln-idea-ticket">
                        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                          <Link href={`/companies/${idea.symbol}`} className="_pln-idea-symbol">{idea.symbol}</Link>
                          <span className="_pln-idea-score">{idea.score.toFixed(1)}</span>
                        </div>
                        <div className="_pln-idea-mid">
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            <span
                              className="_pln-dir-badge"
                              style={{ borderColor: dirc.border, color: dirc.text, background: `${dirc.border.replace("0.5", "0.08")}` }}
                            >
                              {directionLabel(idea.direction)}
                            </span>
                            <span
                              className="_pln-dir-badge"
                              style={{ background: dc.bg, borderColor: dc.border, color: dc.text }}
                            >
                              {decisionLabel(idea.marketData.decision)}
                            </span>
                          </div>
                          <span className="_pln-reason-text">{reasonLabel(idea.rationale.primaryReason)}</span>
                        </div>
                        <Link href={`/companies/${idea.symbol}`} className="mini-button" style={{ fontSize: 11, padding: "4px 10px" }}>
                          查看
                        </Link>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Context column */}
        <div>
          {/* Brief */}
          <div className="_pln-brief-card">
            <div className="_pln-section-head">
              <span className="_pln-section-code">每日簡報</span>
              <span className="_pln-section-title">{contextLive ? (latestBrief?.date ?? "無簡報") : "資料暫停"}</span>
              <span
                className="_pln-state-badge"
                style={{ marginLeft: "auto", fontSize: 10, padding: "2px 8px",
                  background: "transparent",
                  border: `1px solid rgba(145,160,181,0.2)`,
                  color: "rgba(145,160,181,0.7)"
                }}
              >
                {contextLive ? briefFreshnessLabel(latestBriefFreshness) : "暫停"}
              </span>
            </div>
            <div style={{ padding: "12px 18px 16px" }}>
              {!contextLive && <div className="_pln-empty-note">交易計畫來源未正常時，簡報內容先隱藏。</div>}
              {contextLive && !latestBrief && <div className="_pln-empty-note">目前沒有每日簡報</div>}
              {contextLive && latestBrief && (
                <>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12, fontSize: 11 }}>
                    <span className={`tg ${briefFreshnessTone(latestBriefFreshness)}`}>
                      {briefFreshnessLabel(latestBriefFreshness)}
                    </span>
                    <span style={{ fontWeight: 600, color: "#e7ecf3" }}>{marketStateLabel(latestBrief.marketState)}</span>
                    <span className="tg soft">資料日 {latestBrief.date}</span>
                    <span className="tg soft">{briefAgeCopy(latestBriefAgeDays)}</span>
                  </div>
                  {latestBriefFreshness === "STALE" && (
                    <div style={{ padding: "8px 12px", background: "rgba(200,148,63,0.06)", border: "1px solid rgba(200,148,63,0.18)", borderRadius: 3, marginBottom: 12 }}>
                      <span style={{ fontSize: 11, color: "#e2b85c" }}>資料過期</span>
                      <span style={{ fontSize: 11, color: "rgba(145,160,181,0.65)", marginLeft: 8 }}>等待 OpenAlice 重新產出今日來源。</span>
                    </div>
                  )}
                  <div className="_pln-brief-sections">
                    {latestBrief.sections.slice(0, 4).map((section) => (
                      <div key={section.heading} className="_pln-brief-section">
                        <div className="_pln-brief-heading">{cleanExternalHeadline(section.heading, "簡報段落")}</div>
                        <div className="_pln-brief-body">
                          {cleanNarrativeText(section.body, "簡報段落尚未完成中文整理；保留來源紀錄。")}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Reviews */}
          <div className="_pln-section">
            <div className="_pln-section-head">
              <span className="_pln-section-code">覆盤紀錄</span>
              <span className="_pln-section-title">交易後檢討</span>
              <span className="_pln-section-count">{contextLive ? `${result.data.reviews.length} 筆` : "暫停"}</span>
            </div>
            <div className="_pln-section-body">
              {!contextLive && <div className="_pln-empty-note">交易計畫來源未正常時，覆盤紀錄先隱藏。</div>}
              {contextLive && result.data.reviews.length === 0 && <div className="_pln-empty-note">目前沒有覆盤紀錄</div>}
              {contextLive && result.data.reviews.slice(0, 6).map((review) => {
                const qv = review.executionQuality;
                const qColor = qv >= 4 ? "#4adb88" : qv <= 2 ? "#ff6b77" : "#e2b85c";
                const qBorder = qv >= 4 ? "rgba(46,204,113,0.45)" : qv <= 2 ? "rgba(230,57,70,0.45)" : "rgba(200,148,63,0.45)";
                return (
                  <div key={review.id} className="_pln-review-row">
                    <div
                      className="_pln-q-chip"
                      style={{ color: qColor, borderColor: qBorder, background: `${qBorder.replace("0.45", "0.08")}` }}
                    >
                      Q{qv}
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: "rgba(145,160,181,0.5)", marginBottom: 2, fontFamily: "var(--mono)" }}>
                        {formatDate(review.createdAt)}
                      </div>
                      <div className="_pln-review-text">
                        {cleanTradePlanText(review.outcome, "覆盤紀錄尚未完成中文整理；保留來源紀錄。")}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Signals context */}
          <div className="_pln-section">
            <div className="_pln-section-head">
              <span className="_pln-section-code">訊號脈絡</span>
              <span className="_pln-section-title">最新真實訊號</span>
              <span className="_pln-section-count">{contextLive ? `${result.data.signals.length} 筆` : "暫停"}</span>
            </div>
            <div className="_pln-section-body">
              {!contextLive && <div className="_pln-empty-note">交易計畫來源未正常時，訊號脈絡先隱藏。</div>}
              {contextLive && result.data.signals.length === 0 && <div className="_pln-empty-note">目前沒有訊號列</div>}
              {contextLive && result.data.signals.slice().sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)).slice(0, 10).map((signal) => (
                <div key={signal.id} className="_pln-signal-row">
                  <span className="_pln-signal-ts">{formatDateTime(signal.createdAt)}</span>
                  <span className="_pln-signal-cat">{signalCategoryLabel(signal.category)}</span>
                  <span className="_pln-signal-text">
                    {cleanExternalHeadline(signal.title, "訊號內容尚未完成中文整理；保留來源紀錄。")}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Lock note */}
          <div className="_pln-lock-note">
            <div className="_pln-lock-note-title">READ-ONLY 邊界</div>
            <div className="_pln-lock-note-body">
              本頁是只讀計畫面板。模擬委託預覽與送出已放在個股頁；實盤送單仍需完整風控與操作員明示。
            </div>
          </div>
        </div>
      </div>
    </PageFrame>
  );
}
