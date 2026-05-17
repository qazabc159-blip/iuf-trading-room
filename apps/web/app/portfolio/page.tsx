import { FinalOnlyFrame } from "@/components/FinalOnlyFrame";
import { buildHandoffFrameTitle, buildPaperRoomSrc, type PortfolioSearchParams } from "@/lib/portfolio-handoff";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function PortfolioPage({
  searchParams,
}: {
  searchParams?: Promise<PortfolioSearchParams>;
}) {
  const params = searchParams ? await searchParams : undefined;
  return <FinalOnlyFrame title={buildHandoffFrameTitle(params)} src={buildPaperRoomSrc(params)} />;
}
