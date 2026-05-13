import { FinalOnlyFrame } from "@/components/FinalOnlyFrame";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function MarketIntelPage() {
  return <FinalOnlyFrame title="Market Intel" src={`/api/ui-final-v031/market-intel?rev=${Date.now().toString(36)}`} />;
}
