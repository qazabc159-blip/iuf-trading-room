import { FinalOnlyFrame } from "@/components/FinalOnlyFrame";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PortfolioSearchParams = Record<string, string | string[] | undefined>;

const HANDOFF_PARAMS = ["ticker", "symbol", "prefill", "from_rec", "entry", "stop", "tp"] as const;

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function hasHandoffParams(params: PortfolioSearchParams | undefined) {
  return HANDOFF_PARAMS.some((key) => Boolean(firstParam(params?.[key])?.trim()));
}

function buildFrameTitle(params: PortfolioSearchParams | undefined) {
  return hasHandoffParams(params) ? "交易室 SIM 預覽（AI 推薦帶入）" : "交易室 SIM 預覽";
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

export default async function PortfolioPage({
  searchParams,
}: {
  searchParams?: Promise<PortfolioSearchParams>;
}) {
  const params = searchParams ? await searchParams : undefined;
  return <FinalOnlyFrame title={buildFrameTitle(params)} src={buildPaperRoomSrc(params)} />;
}
