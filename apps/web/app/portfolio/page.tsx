import { FinalOnlyFrame } from "@/components/FinalOnlyFrame";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function PortfolioPage() {
  return <FinalOnlyFrame title="Paper Trading Room" src={`/api/ui-final-v031/paper-trading-room?rev=${Date.now().toString(36)}`} />;
}
