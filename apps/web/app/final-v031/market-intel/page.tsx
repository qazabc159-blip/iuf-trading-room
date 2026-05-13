import { FinalOnlyFrame } from "@/components/FinalOnlyFrame";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function FinalV031MarketIntelPage() {
  return <FinalOnlyFrame title="Market Intel" src="/api/ui-final-v031/market-intel?rev=1561feb" />;
}
