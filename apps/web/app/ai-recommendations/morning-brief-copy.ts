/**
 * morning-brief-copy.ts
 * ──────────────────────
 * Pure presentational helpers for the "AI 投研晨報" (AI recommendations v2
 * redesign, reports/design_redesign_20260722/drafts/ai_rec_redesign_v2.html).
 * No React, no fetch — kept separate from page.tsx so it is unit-testable
 * and so the newspaper layout components stay thin.
 *
 * These functions only *reshape display* of already-live data produced by
 * v3-view.ts's mapV3ItemToStockRecCard(); they must never invent numbers or
 * boilerplate text that isn't derived from a real field (AI_REC_IMPL_FIELD_
 * MAP_20260723.md documents which design-draft fields have no backend
 * equivalent and were dropped rather than faked).
 *
 * 2026-07-24 update: the 頭版 "deck" one-line abstract and the 主題/供應鏈
 * gapnote (原「已知缺口」#1/#2) are no longer dropped — #1362 added real
 * `leadSummary`/`themeContext` fields to the v3 item (see
 * resolveLeadSummaryText / resolveThemeContextDisplay below). The earlier
 * attempt to derive a deck line as "first 。-delimited sentence of why_buy"
 * is still the reason a *mechanical* derivation was rejected (real AI
 * narrative paragraphs often only contain one 。 at the very end, so "first
 * sentence" == the entire first paragraph, duplicating the prose below it)
 * — leadSummary is a distinct backend-authored value, not derived here.
 */

const RANK_LABELS = ["序位第一", "貳", "叁", "肆", "伍"] as const;

/** 序位標籤：0-based index → 頭版特稿「序位第一」/ 內頁「貳」「叁」「肆」「伍」 */
export function rankLabel(index: number): string {
  return RANK_LABELS[index] ?? `第 ${index + 1} 名`;
}

/** 敘事文字按換行切成段落（既有 joinLines() 用 \n 合併多筆來源） */
export function splitParagraphs(text: string | null | undefined): string[] {
  if (!text) return [];
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/** 版次日期 — 從 "MM/DD HH:mm" 格式的 timestamp label 取日期段 */
export function editionDateLabel(timestampLabel: string): string {
  const datePart = timestampLabel.split(" ")[0]?.trim();
  if (!datePart || datePart === "-") return "--";
  return `${datePart} 收盤`;
}

export type OfficialAnnouncementState = "live" | "empty" | "degraded" | "pending" | string;

/** 官方公告狀態 → 天頭/band 顯示字 */
export function officialAnnouncementLabel(state: OfficialAnnouncementState): string {
  if (state === "live") return "已納入";
  if (state === "empty") return "已檢查無公告";
  if (state === "degraded") return "降級";
  if (state === "pending") return "待接入";
  return "待確認";
}

/** 生成狀態 → band 顯示字 */
export function generationStatusLabel(status: string | null | undefined): string {
  return status === "complete" ? "完成" : "需留意";
}

// ── 數字格式化（沿用 StockRecCard.tsx 同款規則，避免同頁兩套格式化邏輯打架）──

export function fmtPrice(value: number | null | undefined): string {
  if (value == null) return "--";
  return value.toLocaleString("zh-TW", { maximumFractionDigits: 2 });
}

export function fmtScore(value: number | null | undefined, max: number): string {
  if (value == null) return "--";
  return `${value}/${max}`;
}

export function fmtConfidence(value: number | null | undefined): string {
  if (value == null) return "--";
  return `${Math.round(value * 100)}%`;
}

export function fmtRValue(value: number | null | undefined): string {
  if (value == null) return "--";
  return `${value.toFixed(2)}R`;
}

export function fmtMultiplier(value: number | null | undefined): string {
  if (value == null) return "--";
  return String(value);
}

// ── 七維評分列定義（沿用 StockRecCard.tsx SUB_SCORE_ROWS 同一套配分規則，
//    頭版/內頁兩種版面共用同一份定義，避免兩處各自寫一份配分表漂移） ──

export type SubScoreKey =
  | "theme_position"
  | "revenue_earnings"
  | "institutional_etf"
  | "margin_short"
  | "rs_volume"
  | "technical_structure"
  | "valuation_event";

export const SUB_SCORE_ROWS: Array<{ key: SubScoreKey; label: string; max: number }> = [
  { key: "theme_position", label: "題材", max: 20 },
  { key: "revenue_earnings", label: "營收", max: 15 },
  { key: "institutional_etf", label: "法人 / ETF", max: 15 },
  { key: "margin_short", label: "籌碼", max: 15 },
  { key: "rs_volume", label: "RS / 量", max: 10 },
  { key: "technical_structure", label: "技術", max: 20 },
  { key: "valuation_event", label: "估值 / 事件", max: 5 },
];

// ── market_risk_off 專屬文案（2026-07-23, Pete PR #1352 review 🟡#3 /
//    PR #1353 review 🟡#1）──────────────────────────────────────────────
// 後端在 programmatic risk_off_score >= 3 時直接短路（不打 LLM），回傳
// status="market_risk_off" + items:[] + 一份完整 finalReportMarkdown（見
// apps/api/src/ai-recommendation-v2/orchestrator-v3.ts
// runAiRecommendationV3Body 的 "## 市場 risk-off — 暫不推薦新倉（系統程式
// 判斷）" 報告）。這是楊董 SOP 的保護性決策，不是 pipeline 異常——舊版
// EmptyState 的兩支泛用分支（未達門檻 / 引擎尚未回傳）都暗示「還沒有資料」，
// 會讓交易員誤以為引擎掛了。這裡給獨立、正向措辭的狀態文案，並把真報告內容
// 解析成可讀段落照常顯示（不是空態，不能被泛用分支蓋掉）。

export type ReportMarkdownLine =
  | { kind: "heading"; text: string }
  | { kind: "bullet"; text: string }
  | { kind: "text"; text: string };

/**
 * 極簡 markdown 行解析——只處理 finalReportMarkdown 這份固定格式報告會用到
 * 的三種行型（"## " 標題／"- " 條列／純文字段落），把語法符號去掉，不把
 * "##"/"-" 這種寫法逐字秀給使用者看。刻意不做完整 markdown 規格（無巢狀列
 * 表/無 H1/H3，這份報告不會用到），需要更完整解析時再擴充，不要現在過度設計。
 */
export function parseReportMarkdownLines(markdown: string | null | undefined): ReportMarkdownLine[] {
  return splitParagraphs(markdown).map((line): ReportMarkdownLine => {
    if (line.startsWith("## ")) return { kind: "heading", text: line.slice(3).trim() };
    if (line.startsWith("- ")) return { kind: "bullet", text: line.slice(2).trim() };
    return { kind: "text", text: line };
  });
}

export type MarketRiskOffCopy = {
  title: string;
  subtitle: string;
};

/**
 * market_risk_off 專屬文案（正向紀律敘事，非資料異常）。禁止把 "market_risk_off"
 * 這個內部狀態字串本身顯示給使用者——這裡只用真實的 marketRiskOffScore 數字
 * 拼出人話。marketRiskOffScore 為 null 時（例如舊 run 從 DB 重建，見
 * orchestrator-v3.ts::loadLatestAiRecommendationV3RunFromDb 目前固定回傳
 * marketRiskOffScore: null 的已知限制）仍給誠實但不帶數字的版本，不假造分數。
 */
export function buildMarketRiskOffCopy(marketRiskOffScore: number | null | undefined): MarketRiskOffCopy {
  return {
    title: "風控啟動：今日暫緩新倉",
    subtitle:
      marketRiskOffScore != null
        ? `盤勢風控訊號 ${marketRiskOffScore}/6 觸發，依既定 SOP 主動縮減本輪推薦，屬於保護資金的正常操作，非引擎異常。`
        : "盤勢風控訊號已觸發，依既定 SOP 主動縮減本輪推薦，屬於保護資金的正常操作，非引擎異常。",
  };
}

// ── 頭版 deck 摘要句（leadSummary，#1362）───────────────────────────────
const NO_LEAD_SUMMARY_TEXT = "後端尚未回傳頭版摘要句。";

/**
 * leadSummary 有值就直接顯示；null 時（deterministic fallback 項目沒有
 * LLM 一句話理由）用誠實 fallback 句頂住版位，不留視覺空洞，也不是編一句
 * 假摘要。只用於頭版特稿（MorningBriefLead），內頁候選沒有這個版位。
 */
export function resolveLeadSummaryText(leadSummary: string | null | undefined): string {
  return leadSummary && leadSummary.trim().length > 0 ? leadSummary : NO_LEAD_SUMMARY_TEXT;
}

// ── 主題 / 供應鏈脈絡（themeContext，#1362）人話化 ──────────────────────
// beneficiaryTier 與 themes[].lifecycle 是真封閉 Postgres enum
// （packages/db/src/schema.ts 的 beneficiaryTierEnum / themeLifecycleEnum），
// 值域已知、可安全全對照為中文。chainPosition 是 companies.chain_position
// 這個 TEXT 自由文字欄位（無 enum 限制——見 apps/api/src/server.ts
// CANONICAL_COMPANIES_SEED 註解「chain_position is TEXT (no enum
// constraint) — use zh-TW industry chain label」，正確填法本身就是中文
// 描述），前端原樣顯示、不對開放文字臆測翻譯表。

const BENEFICIARY_TIER_LABEL: Record<string, string> = {
  Core: "核心受惠",
  Direct: "直接受惠",
  Indirect: "間接受惠",
  Observation: "觀察名單",
};

function beneficiaryTierLabel(value: string | null): string | null {
  if (!value) return null;
  return BENEFICIARY_TIER_LABEL[value] ?? value;
}

const THEME_LIFECYCLE_LABEL: Record<string, string> = {
  Discovery: "探索期",
  Validation: "驗證期",
  Expansion: "擴張期",
  Crowded: "擁擠期",
  Distribution: "出貨期",
};

function themeLifecycleLabel(value: string): string {
  return THEME_LIFECYCLE_LABEL[value] ?? value;
}

export type ThemeContextInput = {
  dataAvailable?: boolean | null;
  chainPosition?: string | null;
  beneficiaryTier?: string | null;
  themes?: Array<{ name: string; lifecycle: string }> | null;
} | null | undefined;

export type ThemeContextDisplay = {
  positionLine: string | null;
  themesLine: string | null;
};

/**
 * 主題/供應鏈脈絡顯示邏輯。dataAvailable !== true（含 null 與 false 兩種
 * 「無資料」狀態）→ 回傳 null，呼叫端必須整塊不渲染，不能補一句固定樣板
 * gapnote（Pete-12 review 明確提醒過這點）。dataAvailable===true 但個別
 * 子欄位是 null／空陣列時，只跳過那一行，不補假字；兩行都空等同無內容，
 * 一樣整塊不顯示（避免只剩標題的空框）。
 */
export function resolveThemeContextDisplay(themeContext: ThemeContextInput): ThemeContextDisplay | null {
  if (!themeContext || themeContext.dataAvailable !== true) return null;

  const tier = beneficiaryTierLabel(themeContext.beneficiaryTier ?? null);
  const positionLine = themeContext.chainPosition
    ? (tier ? `${themeContext.chainPosition}．${tier}` : themeContext.chainPosition)
    : tier;

  const themes = themeContext.themes ?? [];
  const themesLine = themes.length > 0
    ? `相關主題：${themes.map((t) => `${t.name}（${themeLifecycleLabel(t.lifecycle)}）`).join("、")}`
    : null;

  if (!positionLine && !themesLine) return null;
  return { positionLine, themesLine };
}

export type MorningBriefBodyMode = "risk_off" | "cards" | "empty";

/**
 * 決定 MorningBriefBody 要走哪個分支——market_risk_off 優先於一般
 * empty/error 判斷：即使 cardCount===0 且 error===null，只要 status 是
 * market_risk_off 就必須走專屬分支，不可落入泛用「尚未回傳」文案。抽成純
 * 函式是因為本 repo 的 vitest 無法轉譯 .tsx JSX（tsconfig jsx:"preserve"，
 * 無 @vitejs/plugin-react），這是唯一能被 unit test 直接釘住的決策點——
 * 拿掉 page.tsx 裡對應的 JSX 分支不會讓這支測試變紅，但拿掉/改壞這支函式
 * 的判斷邏輯會。
 */
export function resolveMorningBriefBodyMode(input: {
  status: string | null | undefined;
  error: string | null;
  cardCount: number;
}): MorningBriefBodyMode {
  if (input.status === "market_risk_off") return "risk_off";
  if (input.cardCount === 0 || input.error) return "empty";
  return "cards";
}
