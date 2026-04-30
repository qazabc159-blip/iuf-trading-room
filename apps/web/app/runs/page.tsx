import Link from "next/link";
import { PageFrame, Panel } from "@/components/PageFrame";
import { api } from "@/lib/radar-api";
import { MetricStrip } from "@/components/RadarWidgets";

function duration(ms: number) {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

export default async function RunsPage() {
  const runs = await api.runs();
  const active = runs.filter((run) => run.state === "ACTIVE").length;
  const archived = runs.filter((run) => run.state === "ARCHIVED").length;
  const failed = runs.filter((run) => run.state === "FAILED").length;
  const avgConf = runs.length ? runs.reduce((sum, run) => sum + run.avgConfidence, 0) / runs.length : 0;

  return (
    <PageFrame code="05" title="Runs" sub="策略歷史" note="[05] RUNS · run ledger in RADAR skin · detail keeps lineage">
      <MetricStrip
        cells={[
          { label: "TOTAL", value: runs.length },
          { label: "ACTIVE", value: active, tone: "gold" },
          { label: "ARCHIVED", value: archived },
          { label: "FAILED", value: failed, tone: "down" },
          { label: "AVG·CONF", value: avgConf.toFixed(2) },
          { label: "IDEAS", value: runs.reduce((sum, run) => sum + run.ideasEmitted, 0) },
        ]}
        columns={6}
      />

      <Panel code="RUN-TBL" title="14:32:08 TPE" sub="batch history · click into detail" right={`${runs.length} RUNS`}>
        <div className="row position-row table-head tg" style={{ gridTemplateColumns: "170px 136px 120px 60px 60px 70px 70px 82px" }}>
          <span>ID</span><span>STARTED</span><span>SRC</span><span>IDEAS</span><span>HIGH-Q</span><span>CONF</span><span>DUR</span><span>STATE</span>
        </div>
        {runs.map((run) => (
          <Link
            href={`/runs/${encodeURIComponent(run.id)}`}
            className="row position-row"
            style={{ gridTemplateColumns: "170px 136px 120px 60px 60px 70px 70px 82px" }}
            key={run.id}
          >
            <span className="tg gold">{run.id}</span>
            <span className="tg soft">{new Date(run.startedAt).toLocaleString("zh-TW", { hour12: false })}</span>
            <span className="tg">{run.source}</span>
            <span className="num">{run.ideasEmitted}</span>
            <span className="num">{run.highQualityCount}</span>
            <span className="num">{run.avgConfidence.toFixed(2)}</span>
            <span className="tg">{duration(run.durationMs)}</span>
            <span className={`tg ${run.state === "ACTIVE" ? "gold" : run.state === "FAILED" ? "down" : "muted"}`}>● {run.state}</span>
          </Link>
        ))}
      </Panel>
    </PageFrame>
  );
}
