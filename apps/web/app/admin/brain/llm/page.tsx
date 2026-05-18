import { PageFrame, Panel } from "@/components/PageFrame";
import {
  getAdminLlmUsage,
  getAdminLlmCalls,
  getAdminLlmModels,
  type LlmUsageSummary,
  type LlmCallEntry,
  type LlmModelEntry,
} from "@/lib/api";
import { normalizeLlmCalls, normalizeLlmModels, normalizeLlmUsage } from "./normalize";

const CSS = `
  ._brain-kpi {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
    gap: 1px;
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.09);
    border-radius: 6px;
    margin-bottom: 16px;
    overflow: hidden;
  }
  ._brain-kpi-cell {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 12px 8px;
    background: rgba(0,0,0,0.25);
    gap: 4px;
  }
  ._brain-kpi-val {
    font-size: 18px;
    font-weight: 700;
    font-family: var(--mono, monospace);
    color: #e0e0e0;
    line-height: 1;
  }
  ._brain-kpi-lbl {
    font-size: 10px;
    color: rgba(255,255,255,0.4);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  ._brain-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }
  ._brain-table th {
    text-align: left;
    padding: 6px 10px;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: rgba(255,255,255,0.4);
    border-bottom: 1px solid rgba(255,255,255,0.08);
  }
  ._brain-table td {
    padding: 7px 10px;
    color: rgba(255,255,255,0.75);
    border-bottom: 1px solid rgba(255,255,255,0.04);
    font-family: var(--mono, monospace);
    font-size: 11px;
  }
  ._brain-table tr:last-child td {
    border-bottom: none;
  }
  ._brain-table tr:hover td {
    background: rgba(255,255,255,0.03);
  }
  ._brain-badge {
    display: inline-flex;
    align-items: center;
    padding: 1px 7px;
    border-radius: 3px;
    font-size: 10px;
    font-weight: 600;
  }
  ._brain-disclaimer {
    font-size: 10px;
    color: rgba(255,255,255,0.3);
    margin-top: 8px;
    padding: 6px 10px;
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 4px;
  }
`;

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("zh-TW", { hour12: false });
}

function fmtCost(usd: number | string) {
  const n = typeof usd === "string" ? parseFloat(usd) : usd;
  return isNaN(n) ? "—" : `$${n.toFixed(4)}`;
}

function statusStyle(status: string) {
  if (status === "success") return { background: "rgba(76,175,80,0.15)", color: "#4caf50", border: "1px solid rgba(76,175,80,0.3)" };
  if (status === "failure" || status === "error") return { background: "rgba(239,83,80,0.15)", color: "#ef5350", border: "1px solid rgba(239,83,80,0.3)" };
  return { background: "rgba(255,184,0,0.15)", color: "#ffb800", border: "1px solid rgba(255,184,0,0.3)" };
}

function SyncNote({ reason }: { reason: string }) {
  return (
    <div className="state-panel">
      <span className="badge badge-yellow">資料同步中</span>
      <span className="state-reason">{reason}</span>
    </div>
  );
}

function UsageKpi({ usage }: { usage: LlmUsageSummary }) {
  return (
    <div className="_brain-kpi">
      <div className="_brain-kpi-cell">
        <span className="_brain-kpi-val" style={{ color: "#4caf50" }}>正常</span>
        <span className="_brain-kpi-lbl">端點狀態</span>
      </div>
      <div className="_brain-kpi-cell">
        <span className="_brain-kpi-val">{usage.totalCalls}</span>
        <span className="_brain-kpi-lbl">總呼叫</span>
      </div>
      <div className="_brain-kpi-cell">
        <span className="_brain-kpi-val">{(usage.totalTokens / 1000).toFixed(1)}K</span>
        <span className="_brain-kpi-lbl">Token 數</span>
      </div>
      <div className="_brain-kpi-cell">
        <span className="_brain-kpi-val" style={{ color: "#ffb800" }}>{fmtCost(usage.totalCostUsd)}</span>
        <span className="_brain-kpi-lbl">估計費用</span>
      </div>
      <div className="_brain-kpi-cell">
        <span className="_brain-kpi-val">{usage.byModel.length}</span>
        <span className="_brain-kpi-lbl">模型數</span>
      </div>
    </div>
  );
}

function UsageBreakdown({ usage }: { usage: LlmUsageSummary }) {
  return (
    <>
      <table className="_brain-table">
        <thead>
          <tr>
            <th>模型</th>
            <th>呼叫</th>
            <th>Token</th>
            <th>費用</th>
          </tr>
        </thead>
        <tbody>
          {usage.byModel.length === 0 ? (
            <tr><td colSpan={4} style={{ color: "rgba(255,255,255,0.3)", textAlign: "center" }}>尚無資料</td></tr>
          ) : usage.byModel.map((row) => (
            <tr key={row.modelKey}>
              <td>{row.modelKey}</td>
              <td>{row.calls}</td>
              <td>{(row.tokens / 1000).toFixed(1)}K</td>
              <td>{fmtCost(row.costUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {usage.byModule.length > 0 && (
        <>
          <div style={{ marginTop: 16, marginBottom: 6, fontSize: 10, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.05em" }}>按模組分類</div>
          <table className="_brain-table">
            <thead>
              <tr>
                <th>模組</th>
                <th>呼叫</th>
                <th>Token</th>
                <th>費用</th>
              </tr>
            </thead>
            <tbody>
              {usage.byModule.map((row) => (
                <tr key={row.callerModule}>
                  <td>{row.callerModule}</td>
                  <td>{row.calls}</td>
                  <td>{(row.tokens / 1000).toFixed(1)}K</td>
                  <td>{fmtCost(row.costUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <div className="_brain-disclaimer">{usage.disclaimer}</div>
    </>
  );
}

function ModelRegistry({ models }: { models: LlmModelEntry[] }) {
  return (
    <table className="_brain-table">
      <thead>
        <tr>
          <th>modelKey</th>
          <th>供應商</th>
          <th>名稱</th>
          <th>輸入 / 1M token</th>
          <th>輸出 / 1M token</th>
          <th>最大 context</th>
          <th>啟用</th>
        </tr>
      </thead>
      <tbody>
        {models.length === 0 ? (
          <tr><td colSpan={7} style={{ color: "rgba(255,255,255,0.3)", textAlign: "center" }}>尚無資料</td></tr>
        ) : models.map((m) => (
          <tr key={m.modelKey}>
            <td style={{ color: "#ffb800" }}>{m.modelKey}</td>
            <td>{m.provider}</td>
            <td>{m.displayName}</td>
            <td>{m.inputPricePer1mTokens}</td>
            <td>{m.outputPricePer1mTokens}</td>
            <td>{m.maxContextTokens.toLocaleString()}</td>
            <td>
              <span className="_brain-badge" style={m.isActive ? { background: "rgba(76,175,80,0.15)", color: "#4caf50", border: "1px solid rgba(76,175,80,0.3)" } : { background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.4)", border: "1px solid rgba(255,255,255,0.1)" }}>
                {m.isActive ? "啟用" : "停用"}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RecentCalls({ calls }: { calls: LlmCallEntry[] }) {
  return (
    <table className="_brain-table">
      <thead>
        <tr>
          <th>時間</th>
          <th>模組</th>
          <th>模型</th>
          <th>Prompt</th>
          <th>Completion</th>
          <th>費用</th>
          <th>延遲</th>
          <th>狀態</th>
        </tr>
      </thead>
      <tbody>
        {calls.length === 0 ? (
          <tr><td colSpan={8} style={{ color: "rgba(255,255,255,0.3)", textAlign: "center" }}>尚無記錄</td></tr>
        ) : calls.map((c) => (
          <tr key={c.id}>
            <td style={{ whiteSpace: "nowrap" }}>{fmtDateTime(c.createdAt)}</td>
            <td>{c.callerModule}</td>
            <td>{c.modelKey}</td>
            <td>{c.promptTokens}</td>
            <td>{c.completionTokens}</td>
            <td>{fmtCost(c.costUsd)}</td>
            <td>{c.latencyMs != null ? `${c.latencyMs}ms` : "—"}</td>
            <td>
              <span className="_brain-badge" style={statusStyle(c.status)}>{c.status}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default async function BrainLlmAdminPage() {
  let usage: LlmUsageSummary | null = null;
  let calls: LlmCallEntry[] = [];
  let models: LlmModelEntry[] = [];
  let usageError = false;
  let callsError = false;
  let modelsError = false;

  const sevenDaysAgo = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);

  try {
    const res = await getAdminLlmUsage({ from: sevenDaysAgo, to: today });
    usage = normalizeLlmUsage(res.data);
    if (!usage) usageError = true;
  } catch {
    usageError = true;
  }

  try {
    const res = await getAdminLlmCalls({ limit: 50 });
    calls = normalizeLlmCalls(res.data);
  } catch {
    callsError = true;
  }

  try {
    const res = await getAdminLlmModels();
    models = normalizeLlmModels(res.data);
  } catch {
    modelsError = true;
  }

  return (
    <PageFrame
      code="ADM-BRAIN"
      title="Brain LLM 費用總覽"
      sub="OpenAlice Phase A"
      note="LLM 費用統計 / 模型登錄 / 近期呼叫記錄 — Owner only。費用為估計值，實際帳單以 OpenAI dashboard 為準。"
    >
      <style>{CSS}</style>

      {usage ? <UsageKpi usage={usage} /> : (
        <div className="_brain-kpi">
          <div className="_brain-kpi-cell">
            <span className="_brain-kpi-val" style={{ color: "#ffb800" }}>同步中</span>
            <span className="_brain-kpi-lbl">端點狀態</span>
          </div>
        </div>
      )}

      <Panel code="ADM-BRAIN-USAGE" title="7 日費用摘要" right={`${sevenDaysAgo} → ${today}`}>
        {usageError || !usage
          ? <SyncNote reason="資料同步中 — Phase A DB migration 待 apply 或 Backend 回應異常。Yang 14:00 解鎖後自動可用。" />
          : <UsageBreakdown usage={usage} />
        }
      </Panel>

      <Panel code="ADM-BRAIN-MODELS" title="模型登錄" right={modelsError ? "同步中" : `${models.length} 個模型`}>
        {modelsError
          ? <SyncNote reason="模型登錄暫時無法讀取。" />
          : <ModelRegistry models={models} />
        }
      </Panel>

      <Panel code="ADM-BRAIN-CALLS" title="近期 50 筆呼叫" right={callsError ? "同步中" : `${calls.length} 筆`}>
        {callsError
          ? <SyncNote reason="呼叫記錄暫時無法讀取。" />
          : <RecentCalls calls={calls} />
        }
      </Panel>
    </PageFrame>
  );
}
