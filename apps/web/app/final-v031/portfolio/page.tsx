import { FinalOnlyFrame } from "@/components/FinalOnlyFrame";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PortfolioSearchParams = Record<string, string | string[] | undefined>;

const HANDOFF_PARAMS = ["ticker", "symbol", "prefill", "from_rec", "entry", "stop", "tp"] as const;

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
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
  return <FinalOnlyFrame title="Paper Trading Room" src={buildPaperRoomSrc(params)} />;
}
