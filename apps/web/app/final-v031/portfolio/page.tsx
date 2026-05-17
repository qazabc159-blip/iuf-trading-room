import { FinalOnlyFrame } from "@/components/FinalOnlyFrame";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PortfolioSearchParams = Record<string, string | string[] | undefined>;

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

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function safeQueryText(value: string | string[] | undefined, maxLength = 80) {
  const trimmed = firstParam(value)?.trim();
  if (!trimmed) return null;
  return trimmed.replace(/[<>]/g, "").slice(0, maxLength);
}

function safeTicker(value: string | string[] | undefined) {
  const ticker = firstParam(value)?.trim().toUpperCase();
  if (!ticker || !/^[A-Z0-9._-]{1,16}$/.test(ticker)) return null;
  return ticker;
}

function safeSide(value: string | string[] | undefined) {
  const side = safeQueryText(value, HANDOFF_PARAM_MAX_LENGTH.side);
  if (side === "buy" || side === "sell") return side;
  return null;
}

function safePrefill(value: string | string[] | undefined) {
  return safeQueryText(value, HANDOFF_PARAM_MAX_LENGTH.prefill) === "true" ? "true" : null;
}

function handoffParam(params: PortfolioSearchParams | undefined, key: HandoffParamKey) {
  if (key === "ticker" || key === "symbol") return safeTicker(params?.[key]);
  if (key === "side") return safeSide(params?.[key]);
  if (key === "prefill") return safePrefill(params?.[key]);
  return safeQueryText(params?.[key], HANDOFF_PARAM_MAX_LENGTH[key]);
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

function buildHandoffFrameTitle(params: PortfolioSearchParams | undefined) {
  if (!hasHandoffParams(params)) return buildFrameTitle(params);
  const summary = buildHandoffSummary(params);
  return summary ? `交易室 SIM 預覽 - ${handoffModeLabel(params)} / ${summary}` : buildFrameTitle(params);
}

function buildPaperRoomSrc(params: PortfolioSearchParams | undefined) {
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

export default async function FinalV031PortfolioPage({
  searchParams,
}: {
  searchParams?: Promise<PortfolioSearchParams>;
}) {
  const params = searchParams ? await searchParams : undefined;
  return <FinalOnlyFrame title={buildHandoffFrameTitle(params)} src={buildPaperRoomSrc(params)} />;
}
