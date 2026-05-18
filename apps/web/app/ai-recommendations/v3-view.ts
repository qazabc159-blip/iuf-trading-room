import type { AiRecommendationV3Item, AiRecommendationV3Response } from "@/lib/api";
import type { MarketStateScores } from "./MarketStateBadge";
import type { ReActStep } from "./ReactTracePanel";
import type { BucketLabel, StockRecCardData, SubScores } from "./StockRecCard";

export type V3PanelTone = "live" | "pending" | "degraded" | "blocked";

export type V3PanelState = {
  tone: V3PanelTone;
  label: string;
  title: string;
  detail: string;
  endpoint: string;
  owner: string;
  nextAction: string;
};

const ENDPOINT = "GET /api/v1/ai-recommendations/v3";
const OWNER = "Elva/Jason backend gate + Bruce owner-session verify";

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function scoreToBucket(totalScore: number | null): BucketLabel {
  if (totalScore != null && totalScore >= 85) return "A+";
  if (totalScore != null && totalScore >= 75) return "A";
  if (totalScore != null && totalScore >= 65) return "B";
  return "C";
}

function normalizeBucket(value: unknown, totalScore: number | null): BucketLabel {
  return value === "A+" || value === "A" || value === "B" || value === "C"
    ? value
    : scoreToBucket(totalScore);
}

function joinLines(value: string[] | string | null | undefined, fallback: string | null | undefined): string | null {
  if (Array.isArray(value)) return value.filter(Boolean).join("\n") || (fallback ?? null);
  if (typeof value === "string" && value.trim()) return value;
  return fallback ?? null;
}

function sumScores(scores: SubScores): number | null {
  const values = [
    scores.theme_position,
    scores.revenue_earnings,
    scores.institutional_etf,
    scores.margin_short,
    scores.rs_volume,
    scores.technical_structure,
    scores.valuation_event,
  ];
  if (values.every((value) => value == null)) return null;
  return values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}

export function mapV3ItemToStockRecCard(item: AiRecommendationV3Item): StockRecCardData | null {
  if (!item.ticker) return null;

  const camelScores = item.subScores;
  const snakeScores = item.sub_scores;
  const subScores: SubScores = {
    theme_position: asNumber(camelScores?.theme ?? snakeScores?.theme_position),
    revenue_earnings: asNumber(camelScores?.revenue ?? snakeScores?.revenue_earnings),
    institutional_etf: asNumber(camelScores?.institutional ?? snakeScores?.institutional_etf),
    margin_short: asNumber(camelScores?.margin ?? snakeScores?.margin_short),
    rs_volume: asNumber(camelScores?.rs ?? snakeScores?.rs_volume),
    technical_structure: asNumber(camelScores?.technical ?? snakeScores?.technical_structure),
    valuation_event: asNumber(camelScores?.valuation ?? snakeScores?.valuation_event),
    total: asNumber(item.totalScore ?? snakeScores?.total),
  };
  subScores.total ??= sumScores(subScores);

  const entryLow = asNumber(item.entryZone?.low ?? item.entryPriceRange?.low);
  const entryHigh = asNumber(item.entryZone?.high ?? item.entryPriceRange?.high);
  const entryLabel = item.entryZone?.reason
    ?? (entryLow != null && entryHigh != null ? null : "等待 OTE 進場區間");

  const tp1 = asNumber(item.tp1Structured?.price ?? item.tp1);
  const tp2 = asNumber(item.tp2Structured?.price ?? item.tp2);
  const sl = asNumber(item.stopLossStructured?.price ?? item.stopLoss);
  const totalScore = asNumber(item.totalScore ?? subScores.total);

  return {
    ticker: item.ticker,
    company_name: item.companyName ?? item.company_name ?? item.ticker,
    bucket: normalizeBucket(item.bucket, totalScore),
    confidence: asNumber(item.confidence),
    sub_scores: subScores,
    entry: {
      ote_low: entryLow,
      ote_high: entryHigh,
      label: entryLabel,
    },
    targets: {
      tp1,
      tp2,
      sl,
      r_value: asNumber(item.r_ratio),
    },
    why_buy: joinLines(item.why_buy, item.rationale),
    why_not_buy: joinLines(item.why_not_buy, null),
    market_multiplier: asNumber(item.position_sizing?.market_multiplier),
  };
}

export function getV3MarketScores(items: AiRecommendationV3Item[]): MarketStateScores | null {
  const first = items.find((item) => item.marketScores || item.marketState);
  if (!first) return null;
  const scores = first.marketScores ?? {};
  return {
    state: first.marketState ?? null,
    trend_score: asNumber(scores.trend),
    range_score: asNumber(scores.range),
    risk_off_score: asNumber(scores.risk_off ?? scores.riskOff),
    event_label: scores.event_label ?? scores.eventLabel ?? null,
  };
}

function normalizeStepNumber(value: unknown): ReActStep["step"] | null {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5 ? value : null;
}

export function mapV3TraceSteps(reactTrace: unknown[] | undefined): ReActStep[] | null {
  if (!Array.isArray(reactTrace) || reactTrace.length === 0) return null;

  const steps = reactTrace
    .map((raw): ReActStep | null => {
      if (!raw || typeof raw !== "object") return null;
      const record = raw as Record<string, unknown>;
      const step = normalizeStepNumber(record.step);
      if (!step) return null;
      return {
        step,
        label: typeof record.label === "string" ? record.label : "",
        observation: typeof record.observation === "string" ? record.observation : null,
        conclusion: typeof record.conclusion === "string" ? record.conclusion : null,
        tool_calls: Array.isArray(record.tool_calls) ? record.tool_calls as ReActStep["tool_calls"] : null,
      };
    })
    .filter((step): step is ReActStep => Boolean(step))
    .slice(0, 5);

  return steps.length > 0 ? steps : null;
}

export function buildV3PanelState(input: {
  data: AiRecommendationV3Response | null;
  error: string | null;
  visibleCount: number;
}): V3PanelState {
  const source = input.data?.sourceState;
  const nextFromSource = source?.nextAction;

  if (input.error) {
    return {
      tone: "blocked",
      label: "BLOCKED",
      title: "v3 endpoint 尚未可讀",
      detail: input.error,
      endpoint: ENDPOINT,
      owner: source?.owner ?? OWNER,
      nextAction: nextFromSource
        ?? "確認 owner-session 權限與 API 回應；若 production endpoint 回 401/403，請 Bruce/Elva 用 owner session 驗證，不把前端空狀態當成推薦失敗。",
    };
  }

  const status = input.data?.status ?? "pending";
  if (input.visibleCount > 0) {
    return {
      tone: input.data?.usedFallback || input.data?.synthesisFallbackUsed ? "degraded" : "live",
      label: input.data?.usedFallback || input.data?.synthesisFallbackUsed ? "DEGRADED" : "LIVE",
      title: input.data?.usedFallback || input.data?.synthesisFallbackUsed
        ? "v3 推薦已回傳，但仍使用降級合成資料"
        : "v3 SOP 推薦已回傳",
      detail: `目前顯示 ${input.visibleCount} 檔正式 v3 推薦，未補前端假標的。`,
      endpoint: ENDPOINT,
      owner: source?.owner ?? OWNER,
      nextAction: nextFromSource ?? "Bruce 驗證 entry、TP、SL、風險與交易室 handoff；Elva/Jason 觀察 refresh 與資料品質。",
    };
  }

  if (status === "empty" || status === "pending" || source?.state === "empty") {
    return {
      tone: "pending",
      label: "PENDING",
      title: "v3 已接通但目前沒有可顯示推薦",
      detail: source?.reason ?? "後端沒有回傳可顯示的 v3 items；前端只顯示空狀態，不補假推薦。",
      endpoint: ENDPOINT,
      owner: source?.owner ?? OWNER,
      nextAction: nextFromSource ?? "觸發 v3 refresh，確認市場狀態、資料品質與門檻後，讓正式候選進入推薦清單。",
    };
  }

  return {
    tone: "degraded",
    label: "DEGRADED",
    title: `v3 狀態：${status}`,
    detail: source?.reason ?? "v3 payload 未達 complete；前端維持降級揭露，不顯示假推薦。",
    endpoint: ENDPOINT,
    owner: source?.owner ?? OWNER,
    nextAction: nextFromSource ?? "Elva/Jason 檢查 v3 run 狀態，Bruce 驗證 production payload 與 owner-session 權限。",
  };
}
