import { PageFrame, Panel } from "@/components/PageFrame";
import { MetricStrip } from "@/components/RadarWidgets";
import { getOpsSnapshot } from "@/lib/api";

export const dynamic = "force-dynamic";

type OpsSnapshot = Awaited<ReturnType<typeof getOpsSnapshot>>["data"];
type LoadState =
  | { state: "LIVE"; data: OpsSnapshot | null; updatedAt: string; source: string }
  | { state: "EMPTY"; data: OpsSnapshot | null; updatedAt: string; source: string; reason: string }
  | { state: "BLOCKED"; data: OpsSnapshot | null; updatedAt: string; source: string; reason: string };

async function loadOps(): Promise<LoadState> {
  const source = "GET /api/v1/ops/snapshot?auditHours=24&recentLimit=12";
  const updatedAt = new Date().toISOString();

  try {
    const envelope = await getOpsSnapshot({ auditHours: 24, recentLimit: 12 });
    const data = envelope.data;
    const hasRows = data.stats.themes + data.stats.companies + data.audit.total + data.openAlice.queue.totalJobs > 0;
    if (!hasRows) {
      return {
        state: "EMPTY",
        data,
        updatedAt: data.generatedAt || updatedAt,
        source,
        reason: "Ops snapshot returned zero stats, audit rows, and queue jobs.",
      };
    }
    return {
      state: "LIVE",
      data,
      updatedAt: data.generatedAt || updatedAt,
      source,
    };
  } catch (error) {
    return {
      state: "BLOCKED",
      data: null,
      updatedAt,
      source,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

function formatTime(value: string | null | undefined) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString("zh-TW", { hour12: false });
}

function stateTone(state: LoadState["state"]) {
  if (state === "LIVE") return "up";
  if (state === "EMPTY") return "gold";
  return "down";
}

function healthTone(state: string) {
  if (state === "healthy") return "up";
  if (state === "stale") return "gold";
  return "down";
}

function severityTone(value: string | undefined) {
  if (value === "danger") return "down";
  if (value === "warning") return "gold";
  if (value === "success") return "up";
  return "muted";
}

function SourceLine({ result }: { result: LoadState }) {
  return (
    <div className="tg soft" style={{ display: "flex", flexWrap: "wrap", gap: 10, margin: "10px 0 12px" }}>
      <span className={stateTone(result.state)} style={{ fontWeight: 700 }}>{result.state}</span>
      <span>{result.source}</span>
      <span>updated {formatTime(result.updatedAt)}</span>
      {result.state !== "LIVE" && <span>{result.reason}</span>}
    </div>
  );
}

function EmptyOrBlocked({ result }: { result: LoadState }) {
  if (result.state === "LIVE") return null;
  return (
    <div className="terminal-note">
      <span className={`tg ${stateTone(result.state)}`}>{result.state}</span>{" "}
      {result.reason}
    </div>
  );
}

export default async function OpsPage() {
  const result = await loadOps();
  const data = result.data;
  const stats = data?.stats;
  const queue = data?.openAlice.queue;
  const obs = data?.openAlice.observability;

  return (
    <PageFrame
      code="09"
      title="Ops"
      sub="Operations snapshot"
      note="[09] OPS reads the production ops snapshot endpoint. Mock health probes and fake jobs are removed."
    >
      <MetricStrip
        cells={[
          { label: "STATE", value: result.state, tone: stateTone(result.state) },
          { label: "THEMES", value: stats?.themes ?? 0 },
          { label: "COMPANIES", value: stats?.companies ?? 0 },
          { label: "SIGNALS", value: stats?.signals ?? 0 },
          { label: "QUEUE", value: queue?.totalJobs ?? 0, tone: (queue?.failed ?? 0) > 0 ? "down" : "muted" },
          { label: "AUDIT", value: data?.audit.total ?? 0, tone: (data?.audit.total ?? 0) > 0 ? "gold" : "muted" },
          { label: "WORKER", value: obs?.workerStatus ?? "--", tone: obs ? healthTone(obs.workerStatus) : "muted" },
        ]}
        columns={7}
      />

      <div className="main-grid">
        <div>
          <Panel code="OPS-SRC" title={`${formatTime(result.updatedAt)} TPE`} sub="SNAPSHOT SOURCE" right={result.state}>
            <SourceLine result={result} />
            <EmptyOrBlocked result={result} />
            {data && (
              <div style={{ border: "1px solid var(--night-rule-strong)" }}>
                {[
                  ["WORKSPACE", `${data.workspace.name} / ${data.workspace.slug}`],
                  ["GENERATED", data.generatedAt],
                  ["CORE CO", String(data.stats.coreCompanies)],
                  ["DIRECT CO", String(data.stats.directCompanies)],
                  ["ACTIVE PLANS", String(data.stats.activePlans)],
                  ["REVIEW QUEUE", String(data.stats.reviewQueue)],
                  ["PUBLISHED BRIEFS", String(data.stats.publishedBriefs)],
                  ["BULLISH SIGNALS", String(data.stats.bullishSignals)],
                ].map(([label, value]) => (
                  <div className="row limit-row" key={label}>
                    <span className="tg gold">{label}</span>
                    <span className="tg" style={{ gridColumn: "span 2", textAlign: "right" }}>{value}</span>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel code="JOB-Q" title="OPENALICE QUEUE" sub="worker observability" right={obs?.workerStatus ?? "BLOCKED"}>
            {!obs && <div className="terminal-note"><span className="tg gold">EMPTY</span> No OpenAlice observability payload.</div>}
            {obs && queue && (
              <>
                {[
                  ["WORKER", obs.workerStatus, healthTone(obs.workerStatus)],
                  ["SWEEP", obs.sweepStatus, healthTone(obs.sweepStatus)],
                  ["MODE", obs.metrics.mode, "muted"],
                  ["QUEUED", String(queue.queued), queue.queued > 0 ? "gold" : "muted"],
                  ["RUNNING", String(queue.running), queue.running > 0 ? "up" : "muted"],
                  ["FAILED", String(queue.failed), queue.failed > 0 ? "down" : "muted"],
                  ["STALE RUNNING", String(obs.metrics.staleRunningJobs), obs.metrics.staleRunningJobs > 0 ? "down" : "muted"],
                ].map(([label, value, tone]) => (
                  <div className="row limit-row" key={label}>
                    <span className="tg gold">{label}</span>
                    <span className={`tg ${tone}`} style={{ gridColumn: "span 2", textAlign: "right" }}>{value}</span>
                  </div>
                ))}
              </>
            )}
          </Panel>
        </div>

        <div>
          <Panel code="LAT-ROW" title="LATEST ROWS" sub="themes / companies / signals / plans" right="DB">
            {data && Object.entries(data.latest).flatMap(([bucket, rows]) =>
              rows.slice(0, 3).map((row) => (
                <div className="row telex-row" style={{ gridTemplateColumns: "76px 92px 1fr" }} key={`${bucket}-${row.id}`}>
                  <span className="tg soft">{formatTime(row.timestamp)}</span>
                  <span className="tg gold">{bucket}</span>
                  <span className="tg" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {row.label}{row.subtitle ? ` / ${row.subtitle}` : ""}
                  </span>
                </div>
              ))
            )}
            {data && Object.values(data.latest).every((rows) => rows.length === 0) && (
              <div className="terminal-note"><span className="tg gold">EMPTY</span> No latest rows in snapshot.</div>
            )}
          </Panel>
        </div>

        <div>
          <Panel code="AUD-SUM" title="AUDIT SUMMARY" sub="last 24 hours" right={`${data?.audit.total ?? 0} ROWS`}>
            {data?.audit.actions.length === 0 && <div className="terminal-note"><span className="tg gold">EMPTY</span> No audit summary rows.</div>}
            {data?.audit.actions.map((item) => (
              <div className="row limit-row" key={item.action}>
                <span className="tg gold">{item.action}</span>
                <span className="num" style={{ gridColumn: "span 2", textAlign: "right" }}>{item.count}</span>
              </div>
            ))}
          </Panel>

          <Panel code="AUD-TBL" title="AUDIT EVENTS" sub="recent mutations / reads" right={`${data?.audit.recent.length ?? 0} ROWS`}>
            {data?.audit.recent.length === 0 && <div className="terminal-note"><span className="tg gold">EMPTY</span> No recent audit rows.</div>}
            {data?.audit.recent.slice(0, 10).map((event) => (
              <div className="row telex-row" style={{ gridTemplateColumns: "76px 82px 1fr" }} key={event.id}>
                <span className="tg soft">{formatTime(event.createdAt)}</span>
                <span className={`tg ${severityTone(event.action === "DELETE" ? "danger" : event.action === "WRITE" ? "warning" : "info")}`}>{event.action}</span>
                <span className="tg" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {event.entityType} / {event.entityId}
                </span>
              </div>
            ))}
          </Panel>
        </div>
      </div>
    </PageFrame>
  );
}
