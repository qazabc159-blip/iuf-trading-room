import type { PaperPrefillHandoff } from "@/lib/final-v031-live";

export type PortfolioSearchParams = Record<string, string | string[] | undefined>;

const HANDOFF_PARAMS = ["ticker", "symbol", "prefill", "from_rec", "from_strategy", "from_home", "from_run", "entry", "stop", "tp", "side"] as const;
type HandoffParamKey = (typeof HANDOFF_PARAMS)[number];

const HANDOFF_PARAM_MAX_LENGTH: Record<HandoffParamKey, number> = {
  ticker: 16,
  symbol: 16,
  prefill: 8,
  from_rec: 96,
  from_strategy: 40,
  from_home: 40,
  from_run: 40,
  entry: 40,
  stop: 40,
  tp: 40,
  side: 4,
};

const AI_SYMBOL_DEPENDENT_PARAMS = new Set<HandoffParamKey>(["prefill", "from_rec", "entry", "stop", "tp", "side"]);

function safeQueryText(value: string | string[] | null | undefined, maxLength = 80) {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  return trimmed.replace(/[<>]/g, "").slice(0, maxLength);
}

function safeTicker(value: string | string[] | null | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  const ticker = raw?.trim().toUpperCase();
  if (!ticker || !/^[A-Z0-9._-]{1,16}$/.test(ticker)) return null;
  return ticker;
}

function safeSide(value: string | string[] | null | undefined): PaperPrefillHandoff["side"] {
  const side = safeQueryText(value, HANDOFF_PARAM_MAX_LENGTH.side);
  if (side === "buy" || side === "sell") return side;
  return null;
}

function safePrefill(value: string | string[] | null | undefined) {
  return safeQueryText(value, HANDOFF_PARAM_MAX_LENGTH.prefill) === "true" ? "true" : null;
}

function rawHandoffParam(params: PortfolioSearchParams | undefined, key: HandoffParamKey) {
  if (key === "ticker" || key === "symbol") return safeTicker(params?.[key]);
  if (key === "side") return safeSide(params?.[key]);
  if (key === "prefill") return safePrefill(params?.[key]);
  return safeQueryText(params?.[key], HANDOFF_PARAM_MAX_LENGTH[key]);
}

function handoffSymbol(params: PortfolioSearchParams | undefined) {
  return rawHandoffParam(params, "ticker") || rawHandoffParam(params, "symbol");
}

function dropsInvalidAiHandoff(params: PortfolioSearchParams | undefined) {
  return Boolean(rawHandoffParam(params, "from_rec")) && !handoffSymbol(params);
}

function handoffParam(params: PortfolioSearchParams | undefined, key: HandoffParamKey) {
  if (dropsInvalidAiHandoff(params) && AI_SYMBOL_DEPENDENT_PARAMS.has(key)) return null;
  return rawHandoffParam(params, key);
}

function hasHandoffParams(params: PortfolioSearchParams | undefined) {
  return HANDOFF_PARAMS.some((key) => Boolean(handoffParam(params, key)));
}

function buildFrameTitle(params: PortfolioSearchParams | undefined) {
  if (!hasHandoffParams(params)) return "交易室 SIM 預覽";
  return `交易室 SIM 預覽（${handoffModeLabel(params)}）`;
}

function handoffSourceLabel(params: PortfolioSearchParams | undefined) {
  if (handoffParam(params, "from_rec")) return "來源 AI 推薦";
  if (handoffParam(params, "from_strategy")) return "來源 首頁策略";
  if (handoffParam(params, "from_home")) return "來源 首頁紙上交易";
  if (handoffParam(params, "from_run")) return "來源 策略 Run";
  return null;
}

function handoffSideLabel(value: string | undefined) {
  if (value === "buy") return "買進";
  if (value === "sell") return "賣出";
  return null;
}

function handoffModeLabel(params: PortfolioSearchParams | undefined) {
  if (handoffParam(params, "from_rec")) return "AI 推薦帶入";
  if (handoffParam(params, "from_strategy")) return "首頁策略帶入";
  if (handoffParam(params, "from_home")) return "首頁紙上交易帶入";
  if (handoffParam(params, "from_run")) return "策略 Run 帶入";
  return "參數帶入";
}

function buildHandoffSummary(params: PortfolioSearchParams | undefined) {
  const source = handoffSourceLabel(params);
  const symbol = handoffParam(params, "ticker") || handoffParam(params, "symbol");
  const recommendationId = handoffParam(params, "from_rec");
  const entry = handoffParam(params, "entry");
  const stop = handoffParam(params, "stop");
  const target = handoffParam(params, "tp");
  const side = handoffSideLabel(handoffParam(params, "side") ?? undefined);
  const parts = [
    side ? `方向 ${side}` : null,
    source,
    symbol ? `標的 ${symbol}` : null,
    recommendationId ? `推薦 ${recommendationId}` : null,
    entry ? `進場 ${entry}` : null,
    stop ? `停損 ${stop}` : null,
    target ? `目標 ${target}` : null,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" / ") : null;
}

export function buildHandoffFrameTitle(params: PortfolioSearchParams | undefined) {
  if (!hasHandoffParams(params)) return buildFrameTitle(params);
  const summary = buildHandoffSummary(params);
  return summary ? `交易室 SIM 預覽 - ${handoffModeLabel(params)} / ${summary}` : buildFrameTitle(params);
}

export function buildPaperRoomSrc(params: PortfolioSearchParams | undefined) {
  const query = new URLSearchParams();
  const revParts: string[] = [];

  for (const key of HANDOFF_PARAMS) {
    const value = handoffParam(params, key);
    if (value) {
      query.set(key, value);
      revParts.push(`${key}:${value}`);
    }
  }

  query.set("rev", revParts.length ? `handoff-${revParts.join("|")}` : "portfolio");
  return `/api/ui-final-v031/paper-trading-room?${query.toString()}`;
}

function paperPrefillSource(params: URLSearchParams, recommendationId: string | null): PaperPrefillHandoff["source"] {
  if (recommendationId) return "ai_recommendations";
  if (safeQueryText(params.get("from_strategy"), 40)) return "strategy_home";
  if (safeQueryText(params.get("from_home"), 40)) return "home_paper_preview";
  if (safeQueryText(params.get("from_run"), 40)) return "strategy_run";
  return "url";
}

export function parsePaperPrefillSearchParams(params: URLSearchParams): PaperPrefillHandoff | null {
  const symbol = safeTicker(params.get("ticker") ?? params.get("symbol"));
  const rawRecommendationId = safeQueryText(params.get("from_rec"), 96);
  const invalidAiHandoff = Boolean(rawRecommendationId) && !symbol;
  const recommendationId = invalidAiHandoff ? null : rawRecommendationId;
  const entry = invalidAiHandoff ? null : safeQueryText(params.get("entry"), 40);
  const stop = invalidAiHandoff ? null : safeQueryText(params.get("stop"), 40);
  const target = invalidAiHandoff ? null : safeQueryText(params.get("tp"), 40);
  const side = invalidAiHandoff ? null : safeSide(params.get("side"));
  const source = paperPrefillSource(params, recommendationId);
  const prefillEnabled = invalidAiHandoff ? false : params.get("prefill") === "true";
  const enabled = prefillEnabled || Boolean(symbol || recommendationId || side || entry || stop || target) || source !== "url";

  if (!enabled) return null;

  return {
    enabled: true,
    symbol,
    recommendationId,
    side,
    entry,
    stop,
    target,
    source,
  };
}
