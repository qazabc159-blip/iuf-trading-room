import { FinalOnlyFrame } from "@/components/FinalOnlyFrame";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function FinalV031PortfolioPage() {
  return <FinalOnlyFrame title="Paper Trading Room" src="/api/ui-final-v031/paper-trading-room?rev=1561feb" />;
}
