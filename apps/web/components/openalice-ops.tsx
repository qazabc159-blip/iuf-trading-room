"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";

import {
  getOpsSnapshot,
  getEventHistory,
  getAuditLogSummary,
  getAuditLogs,
  getAuditLogsExportUrl,
  type OpsSnapshotData,
  type EventHistoryItem,
  type AuditSummary,
  type AuditEntry
} from "@/lib/api";

/* ─── 常數 / 工具 ─── */

const severityColor: Record<string, string> = {
  info: "badge-blue",
  success: "badge-green",
  warning: "badge-yellow",
  danger: "badge-red"
};

const severityLabel: Record<string, string> = {
  info: "資訊",
  success: "成功",
  warning: "警告",
  danger: "異常"
};

const healthColor: Record<string, string> = {
  healthy: "badge-green",
  stale: "badge-red",
  missing: "badge"
};
const healthLabel: Record<string, string> = {
  healthy: "正常",
  stale: "逾時",
  missing: "離線"
};

const sourceLabel: Record<string, string> = {
  audit: "稽核",
  theme: "主題",
  company: "公司",
  signal: "訊號",
  plan: "計畫",
  review: "檢討",
  brief: "簡報",
  openalice: "代理"
};

type Tab = "overview" | "timeline" | "audit" | "logs";

const tabs: { key: Tab; label: string }[] = [
  { key: "overview", label: "系統總覽" },
  { key: "timeline", label: "事件時間軸" },
  { key: "audit", label: "稽核摘要" },
  { key: "logs", label: "稽核明細" }
];

function ago(seconds: number | null) {
  if (seconds === null) return "從未";
  if (seconds < 60) return `${seconds}秒前`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}分鐘前`;
  return `${Math.floor(seconds / 3600)}h${Math.floor((seconds % 3600) / 60)}m前`;
}

function ts(iso: string) {
  return new Date(iso).toLocaleString("zh-TW", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

/* ─── 主元件 ─── */

export function OpenAliceOps() {
  const [tab, setTab] = useState<Tab>("overview");
  const [snap, setSnap] = useState<OpsSnapshotData | null>(null);
  const [events, setEvents] = useState<EventHistoryItem[] | null>(null);
  const [auditSummary, setAuditSummary] = useState<AuditSummary | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* 篩選狀態 */
  const [timelineHours, setTimelineHours] = useState(24);
  const [timelineSearch, setTimelineSearch] = useState("");
  const [timelineSource, setTimelineSource] = useState("");
  const [auditHours, setAuditHours] = useState(24);
  const [auditAction, setAuditAction] = useState("");
  const [auditEntityType, setAuditEntityType] = useState("");
  const [logSearch, setLogSearch] = useState("");
  const [logAction, setLogAction] = useState("");

  const loadSnapshot = useCallback(async () => {
    try {
      const res = await getOpsSnapshot({ auditHours: 24, recentLimit: 8 });
      setSnap(res.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTimeline = useCallback(async () => {
    try {
      const res = await getEventHistory({
        hours: timelineHours,
        limit: 100,
        sources: timelineSource || undefined,
        search: timelineSearch || undefined
      });
      setEvents(res.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [timelineHours, timelineSearch, timelineSource]);

  const loadAuditSummary = useCallback(async () => {
    try {
      const res = await getAuditLogSummary({
        hours: auditHours,
        action: auditAction || undefined,
        entityType: auditEntityType || undefined
      });
      setAuditSummary(res.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [auditHours, auditAction, auditEntityType]);

  const loadAuditLogs = useCallback(async () => {
    try {
      const res = await getAuditLogs({
        limit: 100,
        action: logAction || undefined,
        search: logSearch || undefined
      });
      setAuditLogs(res.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [logAction, logSearch]);

  /* 初始載入 + 自動刷新 */
  useEffect(() => {
    void loadSnapshot();
    const id = setInterval(() => void loadSnapshot(), 30_000);
    return () => clearInterval(id);
  }, [loadSnapshot]);

  /* 切 tab 時載入對應資料 */
  useEffect(() => {
    if (tab === "timeline") void loadTimeline();
    if (tab === "audit") void loadAuditSummary();
    if (tab === "logs") void loadAuditLogs();
  }, [tab, loadTimeline, loadAuditSummary, loadAuditLogs]);

  if (loading && !snap) {
    return <div className="panel" style={{ padding: 16 }}><p className="muted loading-text">載入系統戰情...</p></div>;
  }
  if (error && !snap) {
    return <div className="panel" style={{ padding: 16 }}><p className="error-text">{error}</p></div>;
  }

  return (
    <section style={{ display: "grid", gap: 14 }}>
      {error ? (
        <div className="panel" style={{ padding: "6px 14px" }}>
          <p className="error-text" style={{ margin: 0, fontSize: "var(--fs-sm)" }}>{error}</p>
        </div>
      ) : null}

      {/* Tab 導覽 */}
      <div className="tab-bar">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`tab-btn${tab === t.key ? " active" : ""}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" && snap ? <OverviewTab snap={snap} onRefresh={loadSnapshot} /> : null}

      {tab === "timeline" ? (
        <TimelineTab
          events={events}
          hours={timelineHours}
          setHours={setTimelineHours}
          search={timelineSearch}
          setSearch={setTimelineSearch}
          source={timelineSource}
          setSource={setTimelineSource}
          onRefresh={loadTimeline}
        />
      ) : null}

      {tab === "audit" ? (
        <AuditSummaryTab
          summary={auditSummary}
          hours={auditHours}
          setHours={setAuditHours}
          action={auditAction}
          setAction={setAuditAction}
          entityType={auditEntityType}
          setEntityType={setAuditEntityType}
          onRefresh={loadAuditSummary}
        />
      ) : null}

      {tab === "logs" ? (
        <AuditLogsTab
          logs={auditLogs}
          search={logSearch}
          setSearch={setLogSearch}
          action={logAction}
          setAction={setLogAction}
          onRefresh={loadAuditLogs}
        />
      ) : null}
    </section>
  );
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Tab 1: 系統總覽
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

function OverviewTab({ snap, onRefresh }: { snap: OpsSnapshotData; onRefresh: () => void }) {
  const obs = snap.openAlice.observability;
  const q = snap.openAlice.queue;
  const st = snap.stats;
  const audit = snap.audit;

  return (
    <>
      {/* KPI 格 */}
      <div className="kpi-strip">
        <KpiCard label="主題" value={st.themes} />
        <KpiCard label="公司" value={st.companies} sub={`核心${st.coreCompanies} 直接${st.directCompanies}`} />
        <KpiCard label="訊號" value={st.signals} sub={`看多${st.bullishSignals}`} color="var(--bull)" />
        <KpiCard label="計畫" value={st.plans} sub={`執行中${st.activePlans}`} />
        <KpiCard label="檢討" value={st.reviews} />
        <KpiCard label="簡報" value={st.briefs} sub={`已發布${st.publishedBriefs}`} />
      </div>

      {/* Worker / Sweep / Mode */}
      <div className="triple-panels">
        <div className="panel">
          <div className="panel-header">
            <div><p className="eyebrow">Worker</p><h3>心跳</h3></div>
            <span className={healthColor[obs.workerStatus]}>{healthLabel[obs.workerStatus]}</span>
          </div>
          <p style={{ fontSize: "var(--fs-sm)" }}>
            最後心跳：<strong className="mono">{obs.workerHeartbeatAt ? ts(obs.workerHeartbeatAt) : "從未"}</strong>
          </p>
          <p className="dim" style={{ fontSize: "var(--fs-xs)" }}>{ago(obs.workerHeartbeatAgeSeconds)}</p>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div><p className="eyebrow">排程掃描</p><h3>維護</h3></div>
            <span className={healthColor[obs.sweepStatus]}>{healthLabel[obs.sweepStatus]}</span>
          </div>
          <p style={{ fontSize: "var(--fs-sm)" }}>
            最後掃描：<strong className="mono">{obs.lastSweepAt ? ts(obs.lastSweepAt) : "從未"}</strong>
          </p>
          <p className="dim" style={{ fontSize: "var(--fs-xs)" }}>{ago(obs.lastSweepAgeSeconds)} · {obs.source}</p>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div><p className="eyebrow">持久化</p><h3>{obs.metrics.mode === "database" ? "PostgreSQL" : "記憶體"}</h3></div>
          </div>
          <p className="dim" style={{ fontSize: "var(--fs-xs)" }}>模式: {obs.metrics.mode}</p>
        </div>
      </div>

      {/* 佇列 */}
      <div className="panel">
        <div className="panel-header">
          <div><p className="eyebrow">工作佇列</p><h3>佇列狀態</h3></div>
          <button className="btn-sm" onClick={onRefresh}>重新整理</button>
        </div>
        <div className="kpi-strip" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(90px, 1fr))" }}>
          <QueueNum label="等待" value={q.queued} />
          <QueueNum label="執行" value={q.running} color="var(--accent)" />
          <QueueNum label="待審" value={q.reviewable} color={q.reviewable > 0 ? "var(--warn)" : undefined} />
          <QueueNum label="失敗" value={q.failed} color={q.failed > 0 ? "var(--bear)" : undefined} />
          <QueueNum label="逾時重排" value={obs.metrics.expiredJobsRequeued} />
          <QueueNum label="逾時失敗" value={obs.metrics.expiredJobsFailed} color={obs.metrics.expiredJobsFailed > 0 ? "var(--bear)" : undefined} />
        </div>
      </div>

      {/* 稽核快照 */}
      <div className="panel">
        <div className="panel-header">
          <div><p className="eyebrow">稽核快照</p><h3>過去 {audit.windowHours} 小時</h3></div>
          <span className="badge">共 {audit.total} 筆</span>
        </div>
        {audit.actions.length > 0 ? (
          <div className="action-row" style={{ marginBottom: 8 }}>
            {audit.actions.map((a) => (
              <span key={a.action} className="badge-blue" style={{ fontSize: "var(--fs-xs)" }}>{a.action} ×{a.count}</span>
            ))}
          </div>
        ) : null}
        {audit.recent.length > 0 ? (
          <div className="card-stack">
            {audit.recent.slice(0, 5).map((e) => (
              <div key={e.id} className="record-card" style={{ padding: "6px 10px" }}>
                <div className="record-topline">
                  <div>
                    <span className="badge-blue" style={{ fontSize: "var(--fs-xs)", marginRight: 4 }}>{e.action}</span>
                    <strong style={{ fontSize: "var(--fs-sm)" }}>{e.entityType}</strong>
                    <span className="dim mono" style={{ fontSize: "var(--fs-xs)", marginLeft: 4 }}>{e.entityId.slice(0, 8)}</span>
                  </div>
                  <span className="mono dim" style={{ fontSize: "var(--fs-xs)" }}>{ts(e.createdAt)}</span>
                </div>
              </div>
            ))}
          </div>
        ) : <p className="dim" style={{ fontSize: "var(--fs-sm)" }}>無近期稽核</p>}
      </div>

      {/* 最新動態 */}
      <div className="triple-panels">
        <LatestPanel title="最新訊號" items={snap.latest.signals} href="/signals" />
        <LatestPanel title="最新計畫" items={snap.latest.plans} href="/plans" />
        <LatestPanel title="最新簡報" items={snap.latest.briefs} href="/briefs" />
      </div>

      <p className="dim mono" style={{ fontSize: "var(--fs-xs)", textAlign: "right" }}>快照 {ts(snap.generatedAt)}</p>
    </>
  );
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Tab 2: 事件時間軸
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

function TimelineTab({
  events,
  hours, setHours,
  search, setSearch,
  source, setSource,
  onRefresh
}: {
  events: EventHistoryItem[] | null;
  hours: number; setHours: (v: number) => void;
  search: string; setSearch: (v: string) => void;
  source: string; setSource: (v: string) => void;
  onRefresh: () => void;
}) {
  return (
    <>
      <div className="panel filter-bar">
        <select value={hours} onChange={(e) => setHours(Number(e.target.value))}>
          <option value={6}>6小時</option>
          <option value={12}>12小時</option>
          <option value={24}>24小時</option>
          <option value={72}>3天</option>
          <option value={168}>7天</option>
        </select>
        <select value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="">全部來源</option>
          {Object.entries(sourceLabel).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <input
          className="search-input"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜尋事件..."
          onKeyDown={(e) => e.key === "Enter" && onRefresh()}
        />
        <button className="btn-sm" onClick={onRefresh}>查詢</button>
      </div>

      {!events ? (
        <div className="panel" style={{ padding: 14 }}><p className="muted loading-text">載入事件時間軸...</p></div>
      ) : events.length === 0 ? (
        <div className="panel" style={{ padding: 14 }}><p className="dim">此區間內無事件</p></div>
      ) : (
        <div className="panel" style={{ padding: "8px 0" }}>
          <div className="scroll-box">
            {events.map((ev) => (
              <div
                key={ev.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "100px 52px minmax(0, 1fr)",
                  gap: 8,
                  padding: "7px 14px",
                  borderBottom: "1px solid var(--line)",
                  alignItems: "start"
                }}
              >
                <span className="mono dim" style={{ fontSize: "var(--fs-xs)", whiteSpace: "nowrap" }}>
                  {ts(ev.createdAt)}
                </span>
                <span className={severityColor[ev.severity]} style={{ fontSize: "var(--fs-xs)", textAlign: "center" }}>
                  {severityLabel[ev.severity]}
                </span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    <span className="badge" style={{ fontSize: "var(--fs-xs)", padding: "2px 6px" }}>
                      {sourceLabel[ev.source] ?? ev.source}
                    </span>
                    {ev.href ? (
                      <Link href={ev.href} className="timeline-title">{ev.title}</Link>
                    ) : (
                      <span className="timeline-title">{ev.title}</span>
                    )}
                  </div>
                  {ev.subtitle ? <p className="timeline-sub">{ev.subtitle}</p> : null}
                  {ev.tags.length > 0 ? (
                    <div className="action-row" style={{ gap: 3, marginTop: 2 }}>
                      {ev.tags.slice(0, 4).map((t, i) => (
                        <span key={i} style={{ fontSize: "var(--fs-xs)", color: "var(--dim)", background: "var(--panel-hi)", padding: "1px 5px", borderRadius: 4 }}>
                          {t}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
          <div className="dim" style={{ fontSize: "var(--fs-xs)", padding: "6px 14px" }}>
            共 {events.length} 筆事件（最近 {hours} 小時）
          </div>
        </div>
      )}
    </>
  );
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Tab 3: 稽核摘要
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

function AuditSummaryTab({
  summary,
  hours, setHours,
  action, setAction,
  entityType, setEntityType,
  onRefresh
}: {
  summary: AuditSummary | null;
  hours: number; setHours: (v: number) => void;
  action: string; setAction: (v: string) => void;
  entityType: string; setEntityType: (v: string) => void;
  onRefresh: () => void;
}) {
  return (
    <>
      <div className="panel filter-bar">
        <select value={hours} onChange={(e) => setHours(Number(e.target.value))}>
          <option value={1}>1小時</option>
          <option value={6}>6小時</option>
          <option value={24}>24小時</option>
          <option value={72}>3天</option>
          <option value={168}>7天</option>
          <option value={720}>30天</option>
        </select>
        <input
          value={action}
          onChange={(e) => setAction(e.target.value)}
          placeholder="篩選 action..."
          style={{ width: 120 }}
        />
        <input
          value={entityType}
          onChange={(e) => setEntityType(e.target.value)}
          placeholder="篩選 entityType..."
          style={{ width: 140 }}
        />
        <button className="btn-sm" onClick={onRefresh}>查詢</button>
      </div>

      {!summary ? (
        <div className="panel" style={{ padding: 14 }}><p className="muted loading-text">載入稽核摘要...</p></div>
      ) : (
        <>
          <div className="kpi-strip" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
            <KpiCard label="總筆數" value={summary.total} />
            <KpiCard label="時間窗口" value={summary.windowHours} sub="小時" />
            <div className="kpi-card">
              <div className="mono" style={{ fontSize: "var(--fs-sm)", fontWeight: 600, color: "var(--muted)" }}>
                {summary.latestCreatedAt ? ts(summary.latestCreatedAt) : "—"}
              </div>
              <div className="kpi-label">最近一筆</div>
            </div>
          </div>

          <div className="panel">
            <p className="eyebrow">操作分佈</p>
            <div className="action-row" style={{ marginTop: 6 }}>
              {summary.actions.map((a) => (
                <div key={a.action} className="metric-chip" style={{ cursor: "pointer" }} onClick={() => setAction(a.action)}>
                  <span>{a.count}</span>
                  <small>{a.action}</small>
                </div>
              ))}
              {summary.actions.length === 0 ? <span className="dim" style={{ fontSize: "var(--fs-sm)" }}>無操作紀錄</span> : null}
            </div>
          </div>

          <div className="panel">
            <p className="eyebrow">實體分佈</p>
            <div className="action-row" style={{ marginTop: 6 }}>
              {summary.entities.map((e) => (
                <div key={e.entityType} className="metric-chip" style={{ cursor: "pointer" }} onClick={() => setEntityType(e.entityType)}>
                  <span>{e.count}</span>
                  <small>{e.entityType}</small>
                </div>
              ))}
            </div>
          </div>

          <div className="panel">
            <p className="eyebrow">最近 10 筆</p>
            {summary.recent.length > 0 ? (
              <table className="data-table" style={{ marginTop: 6 }}>
                <thead>
                  <tr>
                    <th>時間</th>
                    <th>操作</th>
                    <th>實體</th>
                    <th>ID</th>
                    <th>Method</th>
                    <th>Path</th>
                    <th>狀態碼</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.recent.map((r) => (
                    <tr key={r.id}>
                      <td className="mono" style={{ fontSize: "var(--fs-xs)", whiteSpace: "nowrap" }}>{ts(r.createdAt)}</td>
                      <td><span className="badge-blue" style={{ fontSize: "var(--fs-xs)" }}>{r.action}</span></td>
                      <td style={{ fontSize: "var(--fs-sm)" }}>{r.entityType}</td>
                      <td className="mono dim" style={{ fontSize: "var(--fs-xs)" }}>{r.entityId.slice(0, 8)}</td>
                      <td className="mono" style={{ fontSize: "var(--fs-xs)" }}>{r.method ?? ""}</td>
                      <td className="dim" style={{ fontSize: "var(--fs-xs)", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.path ?? ""}</td>
                      <td className="mono" style={{ fontSize: "var(--fs-xs)", color: (r.status ?? 200) >= 400 ? "var(--bear)" : "var(--bull)" }}>
                        {r.status ?? ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="dim" style={{ fontSize: "var(--fs-sm)" }}>無紀錄</p>}
          </div>
        </>
      )}
    </>
  );
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Tab 4: 稽核明細 (含匯出)
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

function AuditLogsTab({
  logs,
  search, setSearch,
  action, setAction,
  onRefresh
}: {
  logs: AuditEntry[] | null;
  search: string; setSearch: (v: string) => void;
  action: string; setAction: (v: string) => void;
  onRefresh: () => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <>
      <div className="panel filter-bar">
        <input
          value={action}
          onChange={(e) => setAction(e.target.value)}
          placeholder="篩選 action..."
          style={{ width: 120 }}
        />
        <input
          className="search-input"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="全文搜尋..."
          onKeyDown={(e) => e.key === "Enter" && onRefresh()}
        />
        <button className="btn-sm" onClick={onRefresh}>查詢</button>
        <a href={getAuditLogsExportUrl({ format: "csv", action: action || undefined })} target="_blank" rel="noreferrer" className="btn-sm">匯出 CSV</a>
        <a href={getAuditLogsExportUrl({ format: "json", action: action || undefined })} target="_blank" rel="noreferrer" className="btn-sm">匯出 JSON</a>
      </div>

      {!logs ? (
        <div className="panel" style={{ padding: 14 }}><p className="muted loading-text">載入稽核明細...</p></div>
      ) : logs.length === 0 ? (
        <div className="panel" style={{ padding: 14 }}><p className="dim">無符合條件的稽核紀錄</p></div>
      ) : (
        <div className="panel" style={{ padding: 0, overflow: "hidden" }}>
          <div className="scroll-box-lg">
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 110 }}>時間</th>
                  <th style={{ width: 70 }}>操作</th>
                  <th style={{ width: 90 }}>實體</th>
                  <th>ID</th>
                  <th style={{ width: 50 }}>Method</th>
                  <th>Path</th>
                  <th style={{ width: 50 }}>狀態</th>
                  <th style={{ width: 50 }}>角色</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((entry) => {
                  const isExpanded = expandedId === entry.id;
                  return (
                    <tr
                      key={entry.id}
                      style={{ cursor: "pointer" }}
                      onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                    >
                      <td className="mono" style={{ fontSize: "var(--fs-xs)", whiteSpace: "nowrap" }}>{ts(entry.createdAt)}</td>
                      <td><span className="badge-blue" style={{ fontSize: "var(--fs-xs)" }}>{entry.action}</span></td>
                      <td style={{ fontSize: "var(--fs-sm)" }}>{entry.entityType}</td>
                      <td className="mono dim" style={{ fontSize: "var(--fs-xs)" }}>
                        {isExpanded ? entry.entityId : entry.entityId.slice(0, 8)}
                      </td>
                      <td className="mono" style={{ fontSize: "var(--fs-xs)" }}>{entry.method ?? ""}</td>
                      <td className="dim" style={{ fontSize: "var(--fs-xs)", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: isExpanded ? "normal" : "nowrap" }}>
                        {entry.path ?? ""}
                        {isExpanded && Object.keys(entry.payload).length > 0 ? (
                          <pre style={{ fontSize: "var(--fs-xs)", marginTop: 4, whiteSpace: "pre-wrap", color: "var(--muted)", background: "var(--bg)", padding: 6, borderRadius: 6, maxHeight: 160, overflow: "auto" }}>
                            {JSON.stringify(entry.payload, null, 2)}
                          </pre>
                        ) : null}
                      </td>
                      <td className="mono" style={{ fontSize: "var(--fs-xs)", color: (entry.status ?? 200) >= 400 ? "var(--bear)" : "var(--bull)" }}>
                        {entry.status ?? ""}
                      </td>
                      <td className="dim" style={{ fontSize: "var(--fs-xs)" }}>{entry.role ?? ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="dim" style={{ fontSize: "var(--fs-xs)", padding: "6px 14px", borderTop: "1px solid var(--line)" }}>
            共 {logs.length} 筆 · 點擊列可展開 payload
          </div>
        </div>
      )}
    </>
  );
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━
   共用小元件
   ━━━━━━━━━━━━━━━━━━━━━━━━ */

function KpiCard({ label, value, sub, color }: { label: string; value: number; sub?: string; color?: string }) {
  return (
    <div className="kpi-card">
      <div className="kpi-value" style={color ? { color } : undefined}>{value}</div>
      <div className="kpi-label">{label}</div>
      {sub ? <div className="kpi-sub">{sub}</div> : null}
    </div>
  );
}

function QueueNum({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="mini-stat">
      <div className="kpi-value" style={color ? { color } : undefined}>{value}</div>
      <div className="mini-stat-label">{label}</div>
    </div>
  );
}

function LatestPanel({ title, items, href }: { title: string; items: Array<{ id: string; label: string; subtitle?: string; timestamp: string }>; href: string }) {
  return (
    <div className="panel">
      <p className="eyebrow">{title}</p>
      {items.length === 0 ? (
        <p className="dim" style={{ fontSize: "var(--fs-sm)" }}>尚無資料</p>
      ) : (
        <div className="card-stack">
          {items.slice(0, 5).map((item) => (
            <Link key={item.id} href={href} className="record-card" style={{ display: "block" }}>
              <div className="timeline-title">{item.label}</div>
              {item.subtitle ? <div className="timeline-sub">{item.subtitle}</div> : null}
              <div className="mono dim" style={{ fontSize: "var(--fs-xs)", marginTop: 1 }}>{ts(item.timestamp)}</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
