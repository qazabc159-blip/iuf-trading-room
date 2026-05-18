import { PageFrame, Panel } from "@/components/PageFrame";
import {
  getToolRegistry,
  getToolCalls,
  getToolStats,
  type ToolRegistryEntry,
  type ToolCallEntry,
  type ToolStatEntry,
} from "@/lib/api";

const CSS = `
  ._tool-kpi {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(90px, 1fr));
    gap: 1px;
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.09);
    border-radius: 6px;
    margin-bottom: 16px;
    overflow: hidden;
  }
  ._tool-kpi-cell {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 10px 8px;
    background: rgba(0,0,0,0.25);
    gap: 4px;
  }
  ._tool-kpi-val {
    font-size: 18px;
    font-weight: 700;
    font-family: var(--mono, monospace);
    color: #e0e0e0;
    line-height: 1;
  }
  ._tool-kpi-lbl {
    font-size: 10px;
    color: rgba(255,255,255,0.4);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  ._tool-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 11px;
  }
  ._tool-table th {
    text-align: left;
    padding: 6px 10px;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: rgba(255,255,255,0.4);
    border-bottom: 1px solid rgba(255,255,255,0.08);
  }
  ._tool-table td {
    padding: 7px 10px;
    color: rgba(255,255,255,0.75);
    border-bottom: 1px solid rgba(255,255,255,0.04);
    font-family: var(--mono, monospace);
  }
  ._tool-table tr:last-child td { border-bottom: none; }
  ._tool-table tr:hover td { background: rgba(255,255,255,0.02); }
  ._tool-badge {
    display: inline-flex;
    align-items: center;
    padding: 1px 6px;
    border-radius: 3px;
    font-size: 10px;
    font-weight: 600;
  }
  ._tool-stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 8px;
    padding: 4px 0;
  }
  ._tool-stat-card {
    padding: 10px 12px;
    background: rgba(255,255,255,0.02);
    border: 1px solid rgba(255,255,255,0.07);
    border-radius: 6px;
  }
  ._tool-stat-key {
    font-size: 11px;
    font-weight: 600;
    color: #ffb800;
    font-family: var(--mono, monospace);
    margin-bottom: 6px;
  }
  ._tool-stat-row {
    display: flex;
    justify-content: space-between;
    font-size: 10px;
    color: rgba(255,255,255,0.5);
    margin-bottom: 2px;
  }
  ._tool-stat-val {
    font-family: var(--mono, monospace);
    color: rgba(255,255,255,0.8);
  }
  ._tool-schema-preview {
    font-size: 10px;
    color: rgba(255,255,255,0.4);
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

function toolTypeBadgeStyle(toolType: string) {
  if (toolType === "llm") return { background: "rgba(33,150,243,0.15)", color: "#42a5f5", border: "1px solid rgba(33,150,243,0.3)" };
  if (toolType === "review") return { background: "rgba(156,39,176,0.15)", color: "#ce93d8", border: "1px solid rgba(156,39,176,0.3)" };
  if (toolType === "data_sync") return { background: "rgba(0,150,136,0.15)", color: "#4db6ac", border: "1px solid rgba(0,150,136,0.3)" };
  if (toolType === "cron") return { background: "rgba(255,152,0,0.15)", color: "#ffa726", border: "1px solid rgba(255,152,0,0.3)" };
  return { background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.5)", border: "1px solid rgba(255,255,255,0.1)" };
}

function callerTypeBadgeStyle(callerType: string) {
  if (callerType === "llm") return { background: "rgba(33,150,243,0.15)", color: "#42a5f5", border: "1px solid rgba(33,150,243,0.3)" };
  if (callerType === "cron") return { background: "rgba(255,152,0,0.15)", color: "#ffa726", border: "1px solid rgba(255,152,0,0.3)" };
  return { background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.5)", border: "1px solid rgba(255,255,255,0.1)" };
}

function statusBadgeStyle(status: string) {
  if (status === "success") return { background: "rgba(76,175,80,0.15)", color: "#4caf50", border: "1px solid rgba(76,175,80,0.3)" };
  if (status === "failure" || status === "error") return { background: "rgba(239,83,80,0.15)", color: "#ef5350", border: "1px solid rgba(239,83,80,0.3)" };
  if (status === "timeout") return { background: "rgba(255,152,0,0.15)", color: "#ffa726", border: "1px solid rgba(255,152,0,0.3)" };
  return { background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.5)", border: "1px solid rgba(255,255,255,0.1)" };
}

function fmtDT(iso: string) {
  return new Date(iso).toLocaleString("zh-TW", { hour12: false });
}

function SyncNote({ reason }: { reason: string }) {
  return (
    <div className="state-panel">
      <span className="badge badge-yellow">資料同步中</span>
      <span className="state-reason">{reason}</span>
    </div>
  );
}

function RegistryTable({ tools }: { tools: ToolRegistryEntry[] }) {
  return (
    <table className="_tool-table">
      <thead>
        <tr>
          <th>tool_key</th>
          <th>類型</th>
          <th>名稱</th>
          <th>說明</th>
          <th>版本</th>
          <th>input_schema</th>
          <th>啟用</th>
        </tr>
      </thead>
      <tbody>
        {tools.length === 0
          ? <tr><td colSpan={7} style={{ color: "rgba(255,255,255,0.3)", textAlign: "center" }}>尚無工具登錄</td></tr>
          : tools.map((t) => (
            <tr key={t.toolKey}>
              <td style={{ color: "#ffb800" }}>{t.toolKey}</td>
              <td><span className="_tool-badge" style={toolTypeBadgeStyle(t.toolType)}>{t.toolType}</span></td>
              <td>{t.displayName}</td>
              <td style={{ color: "rgba(255,255,255,0.5)" }}>{t.description ?? "—"}</td>
              <td>{t.version}</td>
              <td>
                <div className="_tool-schema-preview">{JSON.stringify(t.inputSchema)}</div>
              </td>
              <td>
                <span className="_tool-badge" style={t.isActive
                  ? { background: "rgba(76,175,80,0.15)", color: "#4caf50", border: "1px solid rgba(76,175,80,0.3)" }
                  : { background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.4)", border: "1px solid rgba(255,255,255,0.1)" }
                }>{t.isActive ? "啟用" : "停用"}</span>
              </td>
            </tr>
          ))
        }
      </tbody>
    </table>
  );
}

function StatsGrid({ stats }: { stats: ToolStatEntry[] }) {
  if (stats.length === 0) {
    return <div className="state-panel"><span className="badge badge-yellow">資料同步中</span><span className="state-reason">尚無工具統計資料。</span></div>;
  }
  return (
    <div className="_tool-stats-grid">
      {stats.map((s) => (
        <div key={s.toolKey} className="_tool-stat-card">
          <div className="_tool-stat-key">{s.toolKey}</div>
          <div className="_tool-stat-row"><span>總呼叫</span><span className="_tool-stat-val">{s.totalCalls}</span></div>
          <div className="_tool-stat-row"><span>成功</span><span className="_tool-stat-val" style={{ color: "#4caf50" }}>{s.successCalls}</span></div>
          <div className="_tool-stat-row"><span>失敗</span><span className="_tool-stat-val" style={{ color: "#ef5350" }}>{s.failureCalls}</span></div>
          <div className="_tool-stat-row"><span>錯誤率</span><span className="_tool-stat-val" style={{ color: s.errorRate > 0.1 ? "#ef5350" : "#4caf50" }}>{(s.errorRate * 100).toFixed(1)}%</span></div>
          <div className="_tool-stat-row"><span>平均延遲</span><span className="_tool-stat-val">{s.avgLatencyMs != null ? `${s.avgLatencyMs.toFixed(0)}ms` : "—"}</span></div>
        </div>
      ))}
    </div>
  );
}

function CallsTable({ calls }: { calls: ToolCallEntry[] }) {
  return (
    <table className="_tool-table">
      <thead>
        <tr>
          <th>時間</th>
          <th>tool_key</th>
          <th>caller_type</th>
          <th>狀態</th>
          <th>延遲</th>
          <th>輸出摘要</th>
        </tr>
      </thead>
      <tbody>
        {calls.length === 0
          ? <tr><td colSpan={6} style={{ color: "rgba(255,255,255,0.3)", textAlign: "center" }}>尚無呼叫記錄</td></tr>
          : calls.map((c) => (
            <tr key={c.id}>
              <td style={{ whiteSpace: "nowrap" }}>{fmtDT(c.createdAt)}</td>
              <td style={{ color: "#ffb800" }}>{c.toolKey}</td>
              <td><span className="_tool-badge" style={callerTypeBadgeStyle(c.callerType)}>{c.callerType}</span></td>
              <td><span className="_tool-badge" style={statusBadgeStyle(c.status)}>{c.status}</span></td>
              <td>{c.latencyMs != null ? `${c.latencyMs}ms` : "—"}</td>
              <td style={{ color: "rgba(255,255,255,0.45)", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {c.outputSummary ?? c.errorMessage ?? "—"}
              </td>
            </tr>
          ))
        }
      </tbody>
    </table>
  );
}

export default async function ToolsAdminPage() {
  let tools: ToolRegistryEntry[] = [];
  let calls: ToolCallEntry[] = [];
  let stats: ToolStatEntry[] = [];
  let toolsError = false;
  let callsError = false;
  let statsError = false;

  try {
    const res = await getToolRegistry({ isActive: true });
    tools = res.data?.tools ?? [];
  } catch {
    toolsError = true;
  }

  try {
    const res = await getToolCalls({ limit: 50 });
    calls = res.data?.calls ?? [];
  } catch {
    callsError = true;
  }

  try {
    const res = await getToolStats({ window: "24h" });
    stats = res.data?.stats ?? [];
  } catch {
    statsError = true;
  }

  return (
    <PageFrame
      code="ADM-TOOL"
      title="ToolCenter 登錄瀏覽器"
      sub="OpenAlice Phase A"
      note="工具登錄表 / 24h 統計 / 近期 50 筆呼叫記錄 — Owner only。"
    >
      <style>{CSS}</style>

      <div className="_tool-kpi">
        <div className="_tool-kpi-cell">
          <span className="_tool-kpi-val" style={{ color: toolsError ? "#ffb800" : "#4caf50" }}>{toolsError ? "同步中" : "正常"}</span>
          <span className="_tool-kpi-lbl">端點狀態</span>
        </div>
        <div className="_tool-kpi-cell">
          <span className="_tool-kpi-val">{tools.length}</span>
          <span className="_tool-kpi-lbl">已登錄工具</span>
        </div>
        <div className="_tool-kpi-cell">
          <span className="_tool-kpi-val">{stats.length > 0 ? stats.reduce((s, r) => s + r.totalCalls, 0) : "—"}</span>
          <span className="_tool-kpi-lbl">24h 呼叫</span>
        </div>
        <div className="_tool-kpi-cell">
          <span className="_tool-kpi-val">{calls.length}</span>
          <span className="_tool-kpi-lbl">近期記錄</span>
        </div>
      </div>

      <Panel code="ADM-TOOL-REG" title="工具登錄表" right={toolsError ? "同步中" : `${tools.length} 工具`}>
        {toolsError
          ? <SyncNote reason="工具登錄暫時無法讀取 — Phase A DB 待 apply 或後端異常。" />
          : <RegistryTable tools={tools} />
        }
      </Panel>

      <Panel code="ADM-TOOL-STATS" title="24h 工具統計" right={statsError ? "同步中" : `${stats.length} 工具`}>
        {statsError
          ? <SyncNote reason="工具統計暫時無法讀取。" />
          : <StatsGrid stats={stats} />
        }
      </Panel>

      <Panel code="ADM-TOOL-CALLS" title="近期 50 筆呼叫" right={callsError ? "同步中" : `${calls.length} 筆`}>
        {callsError
          ? <SyncNote reason="呼叫記錄暫時無法讀取。" />
          : <CallsTable calls={calls} />
        }
      </Panel>
    </PageFrame>
  );
}
