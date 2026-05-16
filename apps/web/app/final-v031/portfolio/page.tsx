import { FinalOnlyFrame } from "@/components/FinalOnlyFrame";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PortfolioSearchParams = Record<string, string | string[] | undefined>;

const HANDOFF_PARAMS = ["ticker", "symbol", "prefill", "from_rec", "from_strategy", "from_home", "from_run", "entry", "stop", "tp"] as const;

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function hasHandoffParams(params: PortfolioSearchParams | undefined) {
  return HANDOFF_PARAMS.some((key) => Boolean(firstParam(params?.[key])?.trim()));
}

function buildFrameTitle(params: PortfolioSearchParams | undefined) {
  if (!hasHandoffParams(params)) return "交易室 SIM 預覽";
  return `交易室 SIM 預覽（${handoffModeLabel(params)}）`;
}

function handoffSourceLabel(params: PortfolioSearchParams | undefined) {
  if (firstParam(params?.from_rec)?.trim()) return "來源 AI 推薦";
  if (firstParam(params?.from_strategy)?.trim()) return "來源 首頁策略";
  if (firstParam(params?.from_home)?.trim()) return "來源 首頁紙上交易";
  if (firstParam(params?.from_run)?.trim()) return "來源 策略 Run";
  return null;
}

function handoffModeLabel(params: PortfolioSearchParams | undefined) {
  if (firstParam(params?.from_rec)?.trim()) return "AI 推薦帶入";
  if (firstParam(params?.from_strategy)?.trim()) return "首頁策略帶入";
  if (firstParam(params?.from_home)?.trim()) return "首頁紙上交易帶入";
  if (firstParam(params?.from_run)?.trim()) return "策略 Run 帶入";
  return "參數帶入";
}

function buildHandoffSummary(params: PortfolioSearchParams | undefined) {
  const source = handoffSourceLabel(params);
  const symbol = firstParam(params?.ticker)?.trim() || firstParam(params?.symbol)?.trim();
  const recommendationId = firstParam(params?.from_rec)?.trim();
  const entry = firstParam(params?.entry)?.trim();
  const stop = firstParam(params?.stop)?.trim();
  const target = firstParam(params?.tp)?.trim();
  const parts = [
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
    const value = firstParam(params?.[key])?.trim();
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
