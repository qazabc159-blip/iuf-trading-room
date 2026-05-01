import Link from "next/link";
import { notFound } from "next/navigation";
import { PageFrame, Panel } from "@/components/PageFrame";
import { api } from "@/lib/radar-api";
import type { Run } from "@/lib/radar-types";
import { MetricStrip } from "@/components/RadarWidgets";

export const dynamic = "force-dynamic";

function duration(ms: number) {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

export default async function RunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: encodedId } = await params;
  const id = decodeURIComponent(encodedId);
  const [run, ideas, runs] = await Promise.all([
    api.run(id),
    api.ideasByRun(id),
    api.runs(),
  ]);
  if (!run) notFound();

  const sorted = [...runs].sort((a, b) => +new Date(b.startedAt) - +new Date(a.startedAt));
  const index = sorted.findIndex((item) => item.id === run.id);
  const newer = index > 0 ? sorted[index - 1] : null;
  const older = index >= 0 && index < sorted.length - 1 ? sorted[index + 1] : null;
  const high = ideas.filter((idea) => idea.quality === "HIGH").length;
  const long = ideas.filter((idea) => idea.side === "LONG").length;
  const lineage: { label: string; item: Run | null }[] = [
    { label: "NEWER", item: newer },
    { label: "CURRENT", item: run },
    { label: "OLDER", item: older },
  ];

  return (
    <PageFrame code="05-D" title={run.id} sub={`${run.source} - ${run.strategyVersion}`} note="[05D] RUN DETAIL - query snapshot / emitted ideas / lineage">
      <MetricStrip
        cells={[
          { label: "STATE", value: run.state, tone: run.state === "ACTIVE" ? "gold" : run.state === "FAILED" ? "down" : "muted" },
          { label: "IDEAS", value: run.ideasEmitted },
          { label: "HIGH-Q", value: high, tone: "gold" },
          { label: "LONG", value: long, tone: "up" },
          { label: "CONF", value: run.avgConfidence.toFixed(2) },
          { label: "DUR", value: duration(run.durationMs) },
        ]}
        columns={6}
      />

      <div className="company-grid">
        <div>
          <Panel code="RUN-QRY" title="trigger snapshot" sub="strategy console knobs at run time" right={new Date(run.startedAt).toLocaleString("zh-TW", { hour12: false })}>
            {run.query ? (
              <div style={{ border: "1px solid var(--night-rule-strong)" }}>
                {[
                  ["MODE", run.query.mode],
                  ["SORT", run.query.sort],
                  ["LIMIT", String(run.query.limit)],
                  ["SIGNAL DAYS", `${run.query.signalDays}D`],
                  ["QUALITY", run.query.qualityFilter.join(" - ")],
                  ["DECISION", run.query.decisionFilter.join(" - ")],
                  ["MARKET", run.query.market.join(" - ")],
                  ["SYMBOL", run.query.symbol ?? "ALL"],
                  ["THEME", run.query.theme ?? "ALL"],
                ].map(([key, value]) => (
                  <div className="row limit-row" key={key}>
                    <span className="tg gold">{key}</span>
                    <span className="tg" style={{ gridColumn: "span 2", textAlign: "right" }}>{value}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="tg soft" style={{ padding: 18 }}>NO QUERY SNAPSHOT</div>
            )}
          </Panel>

          <Panel code="RUN-IDEA" title="emitted ideas" sub="symbol detail links preserved" right={`${ideas.length} ROWS`}>
            {ideas.map((idea) => (
              <div className="row idea-row" key={idea.id}>
                <span className="tg soft">{idea.id}</span>
                <Link href={`/companies/${idea.symbol}`} className="tg gold">{idea.symbol}</Link>
                <span className={`tg ${idea.side === "LONG" ? "up" : "down"}`}>{idea.side}</span>
                <span className={`tg ${idea.quality === "HIGH" ? "gold" : "muted"}`}>Q-{idea.quality}</span>
                <span className="tc soft">{idea.rationale}</span>
                <Link href="/portfolio" className="mini-button">ORDER -&gt;</Link>
              </div>
            ))}
          </Panel>
        </div>

        <div>
          <Panel code="RUN-OUT" title="outcome split" sub="quality / side profile" right={run.state}>
            {[
              ["HIGH", ideas.filter((idea) => idea.quality === "HIGH").length, "gold"],
              ["MED", ideas.filter((idea) => idea.quality === "MED").length, "muted"],
              ["LOW", ideas.filter((idea) => idea.quality === "LOW").length, "muted"],
              ["LONG", ideas.filter((idea) => idea.side === "LONG").length, "up"],
              ["TRIM", ideas.filter((idea) => idea.side === "TRIM").length, "down"],
              ["EXIT", ideas.filter((idea) => idea.side === "EXIT").length, "down"],
            ].map(([label, value, tone]) => (
              <div style={{ padding: "10px 0", borderBottom: "1px solid var(--night-rule)" }} key={label}>
                <div className="tg" style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>{label}</span><span className={String(tone)}>{value}</span>
                </div>
                <div className="bar" style={{ marginTop: 8 }}>
                  <span style={{ width: `${Number(value) * 18}%`, background: tone === "gold" ? "var(--gold-bright)" : tone === "up" ? "var(--tw-up-bright)" : "var(--night-mid)" }} />
                </div>
              </div>
            ))}
          </Panel>

          <Panel code="RUN-LIN" title="lineage" sub="newer / older run chain" right="NAV">
            {lineage.map(({ label, item }) => (
              <div className="row telex-row" style={{ gridTemplateColumns: "70px 1fr" }} key={label}>
                <span className="tg gold">{label}</span>
                {item ? (
                  <Link href={`/runs/${encodeURIComponent(item.id)}`} className="tg">{item.id} - {item.state}</Link>
                ) : (
                  <span className="tg soft">NONE</span>
                )}
              </div>
            ))}
          </Panel>
        </div>
      </div>
    </PageFrame>
  );
}
