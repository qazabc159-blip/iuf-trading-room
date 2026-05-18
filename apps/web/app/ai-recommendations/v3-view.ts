import type { AiRecommendationV3Item, AiRecommendationV3Response, AiRecommendationV3SourceState } from "@/lib/api";
import type { MarketStateScores } from "./MarketStateBadge";
import type { ReActStep } from "./ReactTracePanel";
import type { BucketLabel, SourceStateSummary, StockRecCardData, SubScores } from "./StockRecCard";

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
const OFFICIAL_ANNOUNCEMENT_NEXT_ACTION = "Backend needs to expose official announcement source state in the v3 response.";

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
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

function localizeV3Narrative(value: string): string {
  return value
    .trim()
    .replace(/Programmatic fallback range: ([0-9.]+x-[0-9.]+x) of verified lastPrice\./i, "後端以 verified lastPrice 建立程式化 fallback 進場區間：$1。")
    .replace(/Verified technical data was available from get_company_technical\./i, "get_company_technical 已回傳可驗證技術資料。")
    .replace(/Price is above MA20\./i, "價格站上 MA20。")
    .replace(/Price is above MA60\./i, "價格站上 MA60。")
    .replace(/Price is not above MA20; keep sizing conservative\./i, "價格未站上 MA20，部位需保守。")
    .replace(/Price is not above MA60; keep sizing conservative\./i, "價格未站上 MA60，部位需保守。")
    .replace(/Deterministic fallback from verified get_company_technical data\./i, "以 get_company_technical 驗證資料產生固定規則補值。")
    .replace(/This is a deterministic fallback because the LLM did not return enough structured picks\./i, "這是固定規則補值，因為 LLM 未回傳足夠的結構化推薦。")
    .replace(/Treat as research candidates until the full AI narrative is healthy\./i, "完整 AI 敘事恢復健康前，只能視為研究候選。");
}

function joinLines(...values: Array<string[] | string | null | undefined>): string | null {
  const lines = values.flatMap((value) => {
    if (Array.isArray(value)) return value;
    if (typeof value === "string") return [value];
    return [];
  })
    .map((line) => localizeV3Narrative(line))
    .filter(Boolean);
  return lines.length > 0 ? lines.join("\n") : null;
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

function compactUnknown(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return value.slice(0, 5).map((item) => compactUnknown(item)).filter(Boolean).join(" / ");
  }
  if (typeof value === "object") {
    const json = JSON.stringify(value);
    return json.length > 260 ? `${json.slice(0, 260)}...` : json;
  }
  return String(value);
}

function normalizeSourceState(
  label: string,
  source: AiRecommendationV3SourceState | string | null | undefined,
  fallbackDetail?: string | null,
): SourceStateSummary {
  if (typeof source === "string") {
    return { label, state: source, detail: fallbackDetail ?? null };
  }

  return {
    label,
    state: source?.state ?? "missing",
    detail: source?.reason ?? fallbackDetail ?? null,
    owner: source?.owner ?? null,
    nextAction: source?.nextAction ?? null,
    lastUpdated: source?.lastUpdated ?? null,
  };
}

function readNamedSourceState(data: AiRecommendationV3Response | null | undefined, names: string[]): AiRecommendationV3SourceState | null {
  if (!data) return null;
  for (const name of names) {
    const direct = (data as Record<string, unknown>)[name];
    if (direct && typeof direct === "object") return direct as AiRecommendationV3SourceState;
  }

  const sourceStates = data.sourceStates ?? null;
  if (sourceStates) {
    for (const name of names) {
      const found = sourceStates[name];
      if (found) return found;
    }
  }
  return null;
}

function traceMentionsOfficialAnnouncements(data: AiRecommendationV3Response | null | undefined): boolean {
  const trace = Array.isArray(data?.reactTrace) ? data.reactTrace : [];
  return trace.some((step) => {
    const text = JSON.stringify(step).toLowerCase();
    return text.includes("announcement") || text.includes("mops") || text.includes("official") || text.includes("重大");
  });
}

export function getOfficialAnnouncementSourceState(data: AiRecommendationV3Response | null | undefined): SourceStateSummary {
  const direct = readNamedSourceState(data, [
    "officialAnnouncementSourceState",
    "officialAnnouncementsSourceState",
    "announcementSourceState",
    "official_announcements",
    "announcements",
    "mops",
  ]);

  if (direct) return normalizeSourceState("官方公告 source state", direct);

  return {
    label: "官方公告 source state",
    state: traceMentionsOfficialAnnouncements(data) ? "degraded" : "pending",
    detail: traceMentionsOfficialAnnouncements(data)
      ? "v3 trace mentions announcement-like data, but no explicit official announcement sourceState was returned."
      : "v3 response did not include official announcement sourceState.",
    owner: "Jason/Elva",
    nextAction: OFFICIAL_ANNOUNCEMENT_NEXT_ACTION,
  };
}

function deriveItemSourceState(item: AiRecommendationV3Item, data: AiRecommendationV3Response | null | undefined): SourceStateSummary {
  if (item.sourceState) return normalizeSourceState("item source state", item.sourceState);
  if (data?.sourceState) return normalizeSourceState("response source state", data.sourceState);
  return normalizeSourceState("item source state", "missing", "v3 item did not include sourceState; showing raw source/sourceTrail instead.");
}

export function mapV3ItemToStockRecCard(
  item: AiRecommendationV3Item,
  data?: AiRecommendationV3Response | null,
): StockRecCardData | null {
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
  const entryLabel = (item.entryZone?.reason ? localizeV3Narrative(item.entryZone.reason) : null)
    ?? (entryLow != null && entryHigh != null ? "Backend v3 entryPriceRange" : "後端未回傳 entry range");

  const tp1 = asNumber(item.tp1Structured?.price ?? item.tp1);
  const tp2 = asNumber(item.tp2Structured?.price ?? item.tp2);
  const sl = asNumber(item.stopLossStructured?.price ?? item.stopLoss);
  const totalScore = asNumber(item.totalScore ?? subScores.total);

  const rawCompanyName = item.companyName ?? item.company_name ?? null;

  return {
    ticker: item.ticker,
    company_name: rawCompanyName && rawCompanyName !== item.ticker ? rawCompanyName : "公司名稱未回傳",
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
    why_not_buy: joinLines(item.why_not_buy),
    risk: joinLines(item.risk, item.risks, item.riskFactors, item.why_not_buy),
    source: item.source ?? null,
    sourceTrail: compactUnknown(item.sourceTrail),
    sourceState: deriveItemSourceState(item, data),
    officialAnnouncementSourceState: getOfficialAnnouncementSourceState(data),
    synthesisFlags: {
      fullAiReportParsed: item.fullAiReportParsed ?? data?.fullAiReportParsed ?? null,
      synthesisRetryUsed: item.synthesisRetryUsed ?? data?.synthesisRetryUsed ?? null,
      synthesisFallbackUsed: item.synthesisFallbackUsed ?? data?.synthesisFallbackUsed ?? null,
      usedFallback: item.usedFallback ?? data?.usedFallback ?? null,
    },
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

function observationText(observation: unknown): string | null {
  if (typeof observation === "string") return observation;
  const record = asRecord(observation);
  if (!record) return null;
  const source = record.source ? `source=${String(record.source)}` : null;
  const sourceState = record.sourceState ? `sourceState=${String(record.sourceState)}` : null;
  const count = Array.isArray(record.items) ? `items=${record.items.length}` : null;
  return [source, sourceState, count].filter(Boolean).join(" / ") || compactUnknown(observation);
}

export function mapV3TraceSteps(reactTrace: unknown[] | undefined): ReActStep[] | null {
  if (!Array.isArray(reactTrace) || reactTrace.length === 0) return null;

  const steps = reactTrace
    .map((raw): ReActStep | null => {
      const record = asRecord(raw);
      if (!record) return null;
      const step = normalizeStepNumber(record.step);
      if (!step) return null;
      return {
        step,
        label: typeof record.label === "string" ? record.label : "",
        observation: observationText(record.observation),
        conclusion: typeof record.conclusion === "string" ? record.conclusion : null,
        tool_calls: Array.isArray(record.tool_calls) ? record.tool_calls as ReActStep["tool_calls"] : null,
      };
    })
    .filter((step): step is ReActStep => Boolean(step))
    .slice(0, 5);

  return steps.length > 0 ? steps : null;
}

function boolText(value: boolean | null | undefined): string {
  if (value === true) return "true";
  if (value === false) return "false";
  return "missing";
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
      title: "v3 endpoint blocked",
      detail: input.error,
      endpoint: ENDPOINT,
      owner: source?.owner ?? OWNER,
      nextAction: nextFromSource ?? "Verify owner session and backend route access before treating the page as accepted.",
    };
  }

  const status = input.data?.status ?? "pending";
  const backendItemCount = input.data?.itemCount ?? input.data?.items?.length ?? input.visibleCount;
  const hasEnoughItems = backendItemCount >= 5 && input.visibleCount >= Math.min(5, backendItemCount);
  const isComplete = status === "complete";
  const usedFallback = input.data?.usedFallback === true || input.data?.synthesisFallbackUsed === true || input.data?.fullAiReportParsed === false;
  const flags = `status=${status} / itemCount=${backendItemCount} / visibleCards=${input.visibleCount} / usedFallback=${boolText(input.data?.usedFallback)} / fullAiReportParsed=${boolText(input.data?.fullAiReportParsed)} / synthesisRetryUsed=${boolText(input.data?.synthesisRetryUsed)} / synthesisFallbackUsed=${boolText(input.data?.synthesisFallbackUsed)}`;

  if (input.visibleCount > 0) {
    const live = isComplete && hasEnoughItems && !usedFallback;
    return {
      tone: live ? "live" : "degraded",
      label: live ? "LIVE" : "DEGRADED",
      title: live
        ? "v3 gate complete with real backend cards"
        : "v3 returned real backend cards, but the gate is not complete",
      detail: live
        ? `${flags}. These cards are rendered directly from ${ENDPOINT}.`
        : `${flags}. The UI is not padding or upgrading the result; it is showing exactly the backend state.`,
      endpoint: ENDPOINT,
      owner: source?.owner ?? OWNER,
      nextAction: live
        ? nextFromSource ?? "Bruce can proceed with owner-session browser acceptance."
        : nextFromSource ?? "Backend must reach status=complete with non-fallback synthesis before this can be called fully accepted.",
    };
  }

  if (status === "empty" || status === "pending" || source?.state === "empty") {
    return {
      tone: "pending",
      label: "PENDING",
      title: "v3 returned no recommendation cards",
      detail: `${flags}. The page must not backfill mock cards.`,
      endpoint: ENDPOINT,
      owner: source?.owner ?? OWNER,
      nextAction: nextFromSource ?? "Trigger or repair the v3 run, then re-run owner-session browser verify.",
    };
  }

  return {
    tone: "degraded",
    label: "DEGRADED",
    title: `v3 status=${status}`,
    detail: `${flags}. No v3 card is visible, and no mock replacement is allowed.`,
    endpoint: ENDPOINT,
    owner: source?.owner ?? OWNER,
    nextAction: nextFromSource ?? "Elva/Jason need to inspect the v3 run and Bruce needs a production payload capture.",
  };
}
