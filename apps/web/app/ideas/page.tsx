import Link from "next/link";
import { PageFrame, Panel } from "@/components/PageFrame";
import { api } from "@/lib/radar-api";
import { MetricStrip } from "@/components/RadarWidgets";

export default async function IdeasPage() {
  const ideas = await api.ideas();
  const high = ideas.filter((idea) => idea.quality === "HIGH").length;
  const long = ideas.filter((idea) => idea.side === "LONG").length;
  const trimExit = ideas.filter((idea) => idea.side === "TRIM" || idea.side === "EXIT").length;
  const avgConf = ideas.reduce((sum, idea) => sum + idea.confidence, 0) / ideas.length;

  return (
    <PageFrame code="04" title="Ideas" sub="策略意見" note="[04] IDEAS · emitted trade candidates · send to execution desk">
      <MetricStrip
        cells={[
          { label: "TOTAL", value: ideas.length },
          { label: "HIGH-Q", value: high, tone: "gold" },
          { label: "LONG", value: long, tone: "up" },
          { label: "TRIM/EXIT", value: trimExit, tone: "down" },
          { label: "AVG·CONF", value: avgConf.toFixed(2) },
          { label: "ACTIVE", value: ideas.filter((idea) => Date.parse(idea.expiresAt) > Date.now()).length, tone: "gold" },
        ]}
        columns={6}
      />

      <Panel code="IDEA-OPN" title="14:32:08 TPE · ● LIVE" sub="idea tape · quality gated" right={`${ideas.length} EMITTED`}>
        {ideas.map((idea) => (
          <div className="row idea-row" key={idea.id}>
            <span className="tg soft">{idea.id}</span>
            <Link href={`/companies/${idea.symbol}`} className="tg gold">{idea.symbol}</Link>
            <span className={`tg ${idea.side === "LONG" ? "up" : "down"}`}>{idea.side}</span>
            <span className={`tg ${idea.quality === "HIGH" ? "gold" : "muted"}`}>Q·{idea.quality}</span>
            <span className="tc soft">{idea.rationale}</span>
            <Link href="/portfolio" className="mini-button">下單台 →</Link>
          </div>
        ))}
      </Panel>
    </PageFrame>
  );
}
