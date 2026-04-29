"use client";
/**
 * /ops — 戰情室 (4 tabs)
 *   SYSTEM   · API state · DataSource · Worker queue · Build
 *   ACTIVITY · filter + timeline + per-hour bars
 *   AUDIT·S  · today summary · actors · entities
 *   AUDIT·D  · filter + table + raw payload
 */
import { useMemo, useState } from "react";
import { PageFrame, SectHead } from "@/components/PageFrame";
import { KpiStrip, FilterBar, Seg, MultiChip, TextInput } from "@/components/research";
import type {
  OpsSystem, ActivityEvent, AuditEvent, AuditSummary,
  ApiHealth, WorkerJob,
} from "@/lib/radar-types";

const TABS = ["SYSTEM", "ACTIVITY", "AUDIT · S", "AUDIT · D"] as const;
type Tab = typeof TABS[number];

export function OpsPageClient(props: {
  system: OpsSystem;
  activity: ActivityEvent[];
  audit: AuditEvent[];
  auditSummary: AuditSummary;
}) {
  const [tab, setTab] = useState<Tab>("SYSTEM");
  return (
    <PageFrame code="09" title="Ops" sub="戰情室">
      <TabBar value={tab} onChange={setTab} />
      {tab === "SYSTEM"     && <SystemPanel s={props.system} />}
      {tab === "ACTIVITY"   && <ActivityPanel events={props.activity} />}
      {tab === "AUDIT · S"  && <AuditSummaryPanel s={props.auditSummary} />}
      {tab === "AUDIT · D"  && <AuditDetailPanel events={props.audit} />}
    </PageFrame>
  );
}

/* ─── Tab bar ───────────────────────────────────────────────────────── */
function TabBar({ value, onChange }: { value: Tab; onChange: (t: Tab) => void }) {
  return (
    <div style={{
      display: "flex", borderBottom: "1px solid var(--night-rule-strong)",
      marginBottom: 18,
    }}>
      {TABS.map(t => {
        const active = t === value;
        return (
          <button key={t} onClick={() => onChange(t)} style={{
            background: "transparent", border: "none",
            padding: "10px 18px", fontFamily: "var(--mono)", fontSize: 11,
            letterSpacing: "0.22em", fontWeight: 700, cursor: "pointer",
            color: active ? "var(--gold-bright)" : "var(--night-mid)",
            borderBottom: active ? "2px solid var(--gold)" : "2px solid transparent",
            marginBottom: -1,
          }}>{t}</button>
        );
      })}
    </div>
  );
}

/* ─── Panel: SYSTEM ─────────────────────────────────────────────────── */
function SystemPanel({ s }: { s: OpsSystem }) {
  const greenN = s.apis.filter(a => a.state === "GREEN").length;
  const amberN = s.apis.filter(a => a.state === "AMBER").length;
  const redN   = s.apis.filter(a => a.state === "RED").length;
  return (
    <>
      <SectHead code="§ A · API · STATE" sub={`${s.apis.length} endpoints`} live />
      <KpiStrip cells={[
        { label: "GREEN", value: greenN, tone: "gold" },
        { label: "AMBER", value: amberN },
        { label: "RED",   value: redN },
        { label: "JOBS · RUN", value: s.jobs.filter(j => j.state === "RUNNING").length },
        { label: "JOBS · QUEUE", value: s.jobs.filter(j => j.state === "QUEUED").length },
        { label: "JOBS · FAIL · 24H", value: s.jobs.filter(j => j.state === "FAILED").length },
      ]} />

      <div style={{ borderTop: "1px solid var(--night-rule-strong)", marginBottom: 24 }}>
        <ApiTableHeader />
        {s.apis.map(a => <ApiRow key={a.endpoint+a.method} a={a} />)}
      </div>

      <SectHead code="§ B · DATA · SOURCE" sub="OFFLINE / FALLBACK · 24H" />
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(4, 1fr)",
        border: "1px solid var(--night-rule-strong)", marginBottom: 24,
      }}>
        {[
          ["STATE",          s.dataSource.state, s.dataSource.state === "LIVE" ? "gold" : undefined],
          ["BASE · URL",     s.dataSource.baseUrl || "— · MOCK"],
          ["OFFLINE · 24H",  s.dataSource.offlineCount24h],
          ["FALLBACK · 24H", s.dataSource.fallbackCount24h],
        ].map(([k, v, tone], i) => (
          <div key={String(k)} style={{
            padding: "12px 14px",
            borderRight: i < 3 ? "1px solid var(--night-rule-strong)" : "none",
          }}>
            <div className="tg" style={{ color: "var(--night-mid)" }}>{String(k)}</div>
            <div style={{
              marginTop: 4, fontFamily: "var(--mono)", fontSize: 14, fontWeight: 700,
              color: tone === "gold" ? "var(--gold-bright)" : "var(--night-ink)",
            }}>{String(v)}</div>
          </div>
        ))}
      </div>

      <SectHead code="§ C · WORKER · QUEUE" sub={`${s.jobs.length} jobs · last 24h`} />
      <div style={{ borderTop: "1px solid var(--night-rule-strong)", marginBottom: 24 }}>
        <JobTableHeader />
        {s.jobs.map(j => <JobRow key={j.jobId} j={j} />)}
      </div>

      <SectHead code="§ D · BUILD · INFO" sub="version / commit / deploy" />
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(5, 1fr)",
        border: "1px solid var(--night-rule-strong)",
      }}>
        {[
          ["VERSION", s.build.version, "gold"],
          ["COMMIT",  s.build.commit],
          ["BRANCH",  s.build.branch],
          ["DEPLOYED",new Date(s.build.deployedAt).toLocaleString("zh-TW", { hour12: false })],
          ["NODE_ENV",s.build.nodeEnv],
        ].map(([k, v, tone], i) => (
          <div key={String(k)} style={{
            padding: "12px 14px",
            borderRight: i < 4 ? "1px solid var(--night-rule-strong)" : "none",
          }}>
            <div className="tg" style={{ color: "var(--night-mid)" }}>{String(k)}</div>
            <div style={{
              marginTop: 4, fontFamily: "var(--mono)", fontSize: 13, fontWeight: 700,
              color: tone === "gold" ? "var(--gold-bright)" : "var(--night-ink)",
            }}>{String(v)}</div>
          </div>
        ))}
      </div>
    </>
  );
}

const stateTone = (s: "GREEN"|"AMBER"|"RED") =>
  s === "GREEN" ? "var(--gold-bright)" : s === "AMBER" ? "var(--night-ink)" : "var(--night-soft)";

function ApiTableHeader() {
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "60px 280px 70px 180px 100px 100px",
      gap: 8, padding: "8px 4px", borderBottom: "1px solid var(--night-rule-strong)",
      fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.18em", color: "var(--night-mid)",
    }}>
      <span>STATE</span><span>ENDPOINT</span><span>METHOD</span>
      <span>LAST · SEEN</span><span style={{textAlign:"right"}}>LATENCY</span>
      <span style={{textAlign:"right"}}>ERR · 24H</span>
    </div>
  );
}
function ApiRow({ a }: { a: ApiHealth }) {
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "60px 280px 70px 180px 100px 100px",
      gap: 8, padding: "9px 4px", borderBottom: "1px solid var(--night-rule)",
      fontFamily: "var(--mono)", fontSize: 11.5, alignItems: "baseline",
    }}>
      <span style={{ color: stateTone(a.state), fontWeight: 700, letterSpacing: "0.18em", fontSize: 10 }}>● {a.state}</span>
      <span style={{ color: "var(--night-ink)" }}>{a.endpoint}</span>
      <span style={{ color: "var(--night-mid)", fontSize: 10, letterSpacing: "0.18em" }}>{a.method}</span>
      <span style={{ color: "var(--night-mid)", fontSize: 10.5 }}>
        {new Date(a.lastSeen).toLocaleString("zh-TW", { hour12: false })}
      </span>
      <span style={{ color: "var(--night-ink)", textAlign: "right", fontFeatureSettings: '"tnum"' }}>{a.latencyMs}ms</span>
      <span style={{
        color: a.errorRate24h > 0.01 ? "var(--gold-bright)" : "var(--night-mid)",
        textAlign: "right", fontFeatureSettings: '"tnum"',
      }}>{(a.errorRate24h*100).toFixed(2)}%</span>
    </div>
  );
}

function JobTableHeader() {
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "100px 1fr 80px 180px 100px",
      gap: 8, padding: "8px 4px", borderBottom: "1px solid var(--night-rule-strong)",
      fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.18em", color: "var(--night-mid)",
    }}>
      <span>JOB · ID</span><span>KIND · PAYLOAD</span><span>STATE</span>
      <span>STARTED</span><span style={{textAlign:"right"}}>DURATION</span>
    </div>
  );
}
function JobRow({ j }: { j: WorkerJob }) {
  const tone = j.state === "DONE" ? "var(--gold-bright)"
             : j.state === "RUNNING" ? "var(--night-ink)"
             : j.state === "QUEUED" ? "var(--night-mid)"
             : "var(--night-soft)";
  const dur = j.durationMs == null ? "—"
            : j.durationMs >= 60_000 ? `${(j.durationMs/60_000).toFixed(1)}m`
            : `${(j.durationMs/1000).toFixed(0)}s`;
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "100px 1fr 80px 180px 100px",
      gap: 8, padding: "9px 4px", borderBottom: "1px solid var(--night-rule)",
      fontFamily: "var(--mono)", fontSize: 11.5, alignItems: "baseline",
    }}>
      <span style={{ color: "var(--gold)" }}>{j.jobId}</span>
      <span>
        <span style={{ color: "var(--night-ink)" }}>{j.kind}</span>
        {j.payload && (
          <span className="tg" style={{ color: "var(--night-soft)", marginLeft: 8 }}>
            {Object.entries(j.payload).map(([k,v]) => `${k}=${v}`).join(" · ")}
          </span>
        )}
        {j.errorMsg && <span className="tg" style={{ color: "var(--gold-bright)", marginLeft: 8 }}>! {j.errorMsg}</span>}
      </span>
      <span style={{ color: tone, fontWeight: 700, letterSpacing: "0.18em", fontSize: 10 }}>{j.state}</span>
      <span style={{ color: "var(--night-mid)", fontSize: 10.5 }}>
        {new Date(j.startedAt).toLocaleString("zh-TW", { hour12: false })}
      </span>
      <span style={{ color: "var(--night-ink)", textAlign: "right", fontFeatureSettings: '"tnum"' }}>{dur}</span>
    </div>
  );
}

/* ─── Panel: ACTIVITY ───────────────────────────────────────────────── */
const SOURCES = ["api", "worker", "scheduler", "manual", "ext"] as const;
const SEV = ["ALL", "INFO", "WARN", "ERROR"] as const;

function ActivityPanel({ events }: { events: ActivityEvent[] }) {
  const [sources, setSources] = useState<string[]>([]);
  const [sev, setSev] = useState<typeof SEV[number]>("ALL");
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    let xs = events.slice();
    if (sources.length) xs = xs.filter(e => sources.includes(e.source));
    if (sev !== "ALL") xs = xs.filter(e => e.severity === sev);
    if (q.trim()) {
      const n = q.trim().toLowerCase();
      xs = xs.filter(e => e.event.toLowerCase().includes(n) || e.summary.toLowerCase().includes(n));
    }
    return xs;
  }, [events, sources, sev, q]);

  // Hourly histogram (last 24h)
  const buckets = useMemo(() => {
    const now = Date.parse(events[0]?.ts ?? new Date().toISOString());
    const arr = Array.from({ length: 24 }, () => 0);
    for (const e of events) {
      const h = Math.floor((now - Date.parse(e.ts)) / 3_600_000);
      if (h >= 0 && h < 24) arr[h]++;
    }
    return arr.reverse(); // oldest → newest
  }, [events]);

  const maxBucket = Math.max(1, ...buckets);

  return (
    <>
      <SectHead code="§ A · FILTER · 篩選" sub={`${filtered.length} / ${events.length}`} />
      <FilterBar>
        <MultiChip label="SRC" options={[...SOURCES]} value={sources} onChange={setSources} />
        <Seg label="SEV" value={sev} options={SEV} onChange={setSev} />
        <TextInput label="FIND" value={q} onChange={setQ} placeholder="event / summary…" />
      </FilterBar>

      <SectHead code="§ B · TIMELINE · 活動軸" sub="density · medium" />
      <div style={{ borderTop: "1px solid var(--night-rule-strong)", marginBottom: 24 }}>
        {filtered.map(e => <ActivityRow key={e.id} e={e} />)}
      </div>

      <SectHead code="§ C · METRICS · 每小時事件" sub="last 24h" />
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(24, 1fr)", gap: 2,
        height: 80, alignItems: "end",
        padding: "10px 0", borderTop: "1px solid var(--night-rule)", borderBottom: "1px solid var(--night-rule)",
      }}>
        {buckets.map((n, i) => (
          <div key={i} title={`${24-i}h ago · ${n} events`}
               style={{
                 background: n ? "var(--gold)" : "var(--night-rule)",
                 height: `${(n / maxBucket) * 100}%`, minHeight: 1,
                 opacity: n ? 0.4 + (n/maxBucket)*0.6 : 0.3,
               }} />
        ))}
      </div>
      <div className="tg" style={{ color: "var(--night-soft)", marginTop: 4, display: "flex", justifyContent: "space-between" }}>
        <span>−24H</span><span>NOW</span>
      </div>
    </>
  );
}

const sevTone = (s: "INFO"|"WARN"|"ERROR") =>
  s === "ERROR" ? "var(--gold-bright)" : s === "WARN" ? "var(--night-ink)" : "var(--night-mid)";

function ActivityRow({ e }: { e: ActivityEvent }) {
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "150px 80px 60px 200px 1fr",
      gap: 12, padding: "9px 4px", borderBottom: "1px solid var(--night-rule)",
      fontFamily: "var(--mono)", fontSize: 11.5, alignItems: "baseline",
    }}>
      <span style={{ color: "var(--night-mid)", fontSize: 10.5 }}>
        {new Date(e.ts).toLocaleString("zh-TW", { hour12: false })}
      </span>
      <span style={{
        color: "var(--night-mid)", fontSize: 9.5, letterSpacing: "0.18em",
        border: "1px solid var(--night-rule-strong)", padding: "2px 5px", textAlign: "center", fontWeight: 700,
      }}>{e.source.toUpperCase()}</span>
      <span style={{ color: sevTone(e.severity), fontWeight: 700, letterSpacing: "0.16em", fontSize: 10 }}>
        {e.severity}
      </span>
      <span style={{ color: "var(--gold)" }}>{e.event}</span>
      <span style={{ fontFamily: "var(--serif-tc)", fontSize: 14, color: "var(--night-ink)" }}>
        {e.summary}
      </span>
    </div>
  );
}

/* ─── Panel: AUDIT · SUMMARY ────────────────────────────────────────── */
function AuditSummaryPanel({ s }: { s: AuditSummary }) {
  return (
    <>
      <SectHead code="§ A · TODAY · SUMMARY" sub="audit events" live />
      <KpiStrip cells={[
        { label: "TOTAL",  value: s.todayTotal, tone: "gold" },
        { label: "WRITE",  value: s.byAction.WRITE },
        { label: "READ",   value: s.byAction.READ },
        { label: "DELETE", value: s.byAction.DELETE },
      ]} />

      <SectHead code="§ B · ACTORS · 操作人分佈" sub={`${s.byActor.length} actors`} />
      <DistributionTable rows={s.byActor.map(a => ({ key: a.actor, count: a.count }))} total={s.todayTotal} />

      <SectHead code="§ C · ENTITIES · 異動實體" sub={`${s.byEntity.length} types`} />
      <DistributionTable rows={s.byEntity.map(e => ({ key: e.entityType, count: e.count }))} total={s.todayTotal} />
    </>
  );
}

function DistributionTable({ rows, total }: { rows: { key: string; count: number }[]; total: number }) {
  const maxN = Math.max(1, ...rows.map(r => r.count));
  return (
    <div style={{ borderTop: "1px solid var(--night-rule-strong)", marginBottom: 24 }}>
      {rows.map(r => (
        <div key={r.key} style={{
          display: "grid", gridTemplateColumns: "200px 1fr 60px 60px",
          gap: 12, padding: "10px 4px", borderBottom: "1px solid var(--night-rule)",
          fontFamily: "var(--mono)", fontSize: 12, alignItems: "center",
        }}>
          <span style={{ color: "var(--night-ink)" }}>{r.key}</span>
          <span style={{ height: 6, background: "var(--night-rule)", position: "relative" }}>
            <span style={{
              position: "absolute", inset: 0, width: `${(r.count/maxN)*100}%`,
              background: "var(--gold)", opacity: 0.7,
            }} />
          </span>
          <span style={{ color: "var(--night-mid)", textAlign: "right", fontFeatureSettings: '"tnum"' }}>{r.count}</span>
          <span style={{ color: "var(--night-soft)", textAlign: "right", fontFeatureSettings: '"tnum"', fontSize: 10.5 }}>
            {((r.count/total)*100).toFixed(0)}%
          </span>
        </div>
      ))}
    </div>
  );
}

/* ─── Panel: AUDIT · DETAIL ─────────────────────────────────────────── */
const ACTIONS = ["ALL", "WRITE", "READ", "DELETE"] as const;

function AuditDetailPanel({ events }: { events: AuditEvent[] }) {
  const [actor, setActor] = useState("");
  const [entity, setEntity] = useState("");
  const [action, setAction] = useState<typeof ACTIONS[number]>("ALL");
  const [openId, setOpenId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let xs = events.slice();
    if (actor.trim()) xs = xs.filter(e => e.actor.toLowerCase().includes(actor.trim().toLowerCase()));
    if (entity.trim()) xs = xs.filter(e => e.entityType.toLowerCase().includes(entity.trim().toLowerCase()));
    if (action !== "ALL") xs = xs.filter(e => e.action === action);
    return xs;
  }, [events, actor, entity, action]);

  return (
    <>
      <SectHead code="§ A · FILTER · 篩選" sub={`${filtered.length} / ${events.length}`} />
      <FilterBar>
        <TextInput label="ACTOR"  value={actor}  onChange={setActor}  placeholder="IUF·01 / system…" />
        <TextInput label="ENTITY" value={entity} onChange={setEntity} placeholder="order / risk_limit…" />
        <Seg label="ACTION" value={action} options={ACTIONS} onChange={setAction} />
      </FilterBar>

      <SectHead code="§ B · TABLE · 明細" sub="點列展開 raw payload" />
      <div style={{
        display: "grid", gridTemplateColumns: "180px 100px 70px 140px 200px 1fr",
        gap: 8, padding: "8px 4px", borderBottom: "1px solid var(--night-rule-strong)",
        fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.18em", color: "var(--night-mid)",
      }}>
        <span>TS</span><span>ACTOR</span><span>ACTION</span><span>ENTITY · TYPE</span><span>ENTITY · ID</span><span>DIFF · SUMMARY</span>
      </div>
      {filtered.map(e => (
        <div key={e.id}>
          <div onClick={() => setOpenId(openId === e.id ? null : e.id)} style={{
            display: "grid", gridTemplateColumns: "180px 100px 70px 140px 200px 1fr",
            gap: 8, padding: "9px 4px", borderBottom: "1px solid var(--night-rule)",
            fontFamily: "var(--mono)", fontSize: 11.5, alignItems: "baseline", cursor: "pointer",
          }}>
            <span style={{ color: "var(--night-mid)", fontSize: 10.5 }}>
              {new Date(e.ts).toLocaleString("zh-TW", { hour12: false })}
            </span>
            <span style={{ color: "var(--night-ink)" }}>{e.actor}</span>
            <span style={{
              color: e.action === "DELETE" ? "var(--gold-bright)" : "var(--night-mid)",
              fontWeight: 700, letterSpacing: "0.16em", fontSize: 10,
            }}>{e.action}</span>
            <span style={{ color: "var(--night-mid)", fontSize: 10.5, letterSpacing: "0.14em" }}>{e.entityType}</span>
            <span style={{ color: "var(--gold)" }}>{e.entityId}</span>
            <span style={{ color: "var(--night-soft)", fontSize: 10.5 }}>
              {e.diff ? Object.entries(e.diff).slice(0,3).map(([k,v]) =>
                `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`
              ).join(" · ") : "—"}
            </span>
          </div>
          {openId === e.id && (
            <div style={{
              padding: "12px 16px", background: "rgba(255,255,255,0.02)",
              borderBottom: "1px solid var(--night-rule)",
              fontFamily: "var(--mono)", fontSize: 11, color: "var(--night-ink)",
              whiteSpace: "pre-wrap", lineHeight: 1.5,
            }}>
              <div className="tg" style={{ color: "var(--night-mid)", marginBottom: 6 }}>
                RAW · PAYLOAD · {e.ip ? `from ${e.ip}` : "no-ip"}
              </div>
              {JSON.stringify(e.diff ?? {}, null, 2)}
            </div>
          )}
        </div>
      ))}
    </>
  );
}
