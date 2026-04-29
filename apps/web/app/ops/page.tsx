import { PageFrame, Panel } from "@/components/PageFrame";
import { api } from "@/lib/radar-api";
import { MetricStrip } from "@/components/RadarWidgets";

export default async function OpsPage() {
  const [system, activity, audit, auditSummary] = await Promise.all([
    api.opsSystem(),
    api.opsActivity(),
    api.opsAudit(),
    api.opsAuditSum(),
  ]);
  const green = system.apis.filter((api) => api.state === "GREEN").length;
  const amber = system.apis.filter((api) => api.state === "AMBER").length;
  const red = system.apis.filter((api) => api.state === "RED").length;

  return (
    <PageFrame code="09" title="Ops" sub="戰情室" note="[09] OPS · API health / worker queue / audit trail">
      <MetricStrip
        cells={[
          { label: "APIS", value: system.apis.length },
          { label: "GREEN", value: green, tone: "up" },
          { label: "AMBER", value: amber, tone: "gold" },
          { label: "RED", value: red, tone: "down" },
          { label: "JOBS", value: system.jobs.length },
          { label: "AUDIT", value: auditSummary.todayTotal, tone: "gold" },
        ]}
        columns={6}
      />

      <div className="main-grid">
        <div>
          <Panel code="API-HLT" title="health probes" sub="endpoint latency / error-rate" right={system.dataSource.state}>
            {system.apis.map((item) => (
              <div className="row health-row" style={{ gridTemplateColumns: "1fr 72px 82px 72px" }} key={item.endpoint}>
                <span className="tg">{item.method} · {item.endpoint}</span>
                <span className={`tg ${item.state === "GREEN" ? "up" : item.state === "AMBER" ? "gold" : "down"}`}><span className="status-dot" />{item.state}</span>
                <span className="num muted">{item.latencyMs}MS</span>
                <span className="num muted">{(item.errorRate24h * 100).toFixed(1)}%</span>
              </div>
            ))}
          </Panel>

          <Panel code="JOB-Q" title="worker queue" sub="last 24h" right={`${system.jobs.length} JOBS`}>
            {system.jobs.map((job) => (
              <div className="row telex-row" style={{ gridTemplateColumns: "90px 1fr 84px" }} key={job.jobId}>
                <span className="tg gold">{job.jobId}</span>
                <span className="tg">{job.kind}</span>
                <span className={`tg ${job.state === "DONE" ? "up" : job.state === "FAILED" ? "down" : "gold"}`}>{job.state}</span>
              </div>
            ))}
          </Panel>
        </div>

        <div>
          <Panel code="ACT-TML" title="activity timeline" sub="system / worker / scheduler" right={`${activity.length} EVENTS`}>
            {activity.slice(0, 12).map((event) => (
              <div className="row telex-row" style={{ gridTemplateColumns: "76px 72px 1fr" }} key={event.id}>
                <span className="tg soft">{new Date(event.ts).toLocaleTimeString("zh-TW", { hour12: false })}</span>
                <span className={`tg ${event.severity === "ERROR" ? "down" : event.severity === "WARN" ? "gold" : "muted"}`}>{event.severity}</span>
                <span className="tg">{event.event} · {event.summary}</span>
              </div>
            ))}
          </Panel>
        </div>

        <div>
          <Panel code="AUD-SUM" title="audit summary" sub="actor / entity changes" right="TODAY">
            {auditSummary.byAction && Object.entries(auditSummary.byAction).map(([key, value]) => (
              <div className="row limit-row" key={key}>
                <span className="tg gold">{key}</span>
                <span className="num" style={{ gridColumn: "span 2", textAlign: "right" }}>{value}</span>
              </div>
            ))}
          </Panel>

          <Panel code="AUD-TBL" title="audit events" sub="latest writes and reads" right={`${audit.length} ROWS`}>
            {audit.slice(0, 9).map((event) => (
              <div className="row telex-row" style={{ gridTemplateColumns: "76px 58px 1fr" }} key={event.id}>
                <span className="tg soft">{new Date(event.ts).toLocaleTimeString("zh-TW", { hour12: false })}</span>
                <span className={`tg ${event.action === "DELETE" ? "down" : event.action === "WRITE" ? "gold" : "muted"}`}>{event.action}</span>
                <span className="tg">{event.actor} · {event.entityType} · {event.entityId}</span>
              </div>
            ))}
          </Panel>
        </div>
      </div>
    </PageFrame>
  );
}
