import { PageFrame } from "@/components/PageFrame";
import { api } from "@/lib/radar-api";
import { PortfolioClient } from "@/components/portfolio/PortfolioClient";

export const dynamic = "force-dynamic";

export default async function PortfolioPage() {
  const [session, positions, riskLimits, strategyLimits, symbolLimits, quotes, events] = await Promise.all([
    api.session(),
    api.positions(),
    api.riskLimits(),
    api.strategyLimits(),
    api.symbolLimits(),
    api.quotes(),
    api.executionEvents(),
  ]);

  return (
    <PageFrame code="06-PORT" title="Portfolio" sub="下單台 · EXECUTION DESK" exec>
      <PortfolioClient
        initialKill={session.killMode}
        positions={positions}
        riskLimits={riskLimits}
        strategyLimits={strategyLimits}
        symbolLimits={symbolLimits}
        quotes={quotes}
        events={events}
      />
    </PageFrame>
  );
}
