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

const LLM_USAGE_ENDPOINT = "/api/v1/admin/llm/usage";
const LLM_CALLS_ENDPOINT = "/api/v1/admin/llm/calls?limit=50";
const LLM_MODELS_ENDPOINT = "/api/v1/admin/llm/models";

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
  ._brain-table-wrap {
    width: 100%;
    overflow-x: auto;
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
  ._brain-truth-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 10px;
    margin-bottom: 16px;
  }
  ._brain-truth-card {
    border: 1px solid rgba(255,184,0,0.16);
    background: rgba(0,0,0,0.24);
    border-radius: 6px;
    padding: 10px 12px;
  }
  ._brain-truth-kicker {
    font-size: 10px;
    color: rgba(255,184,0,0.78);
    font-family: var(--mono, monospace);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 5px;
  }
  ._brain-truth-title {
    font-size: 13px;
    color: rgba(255,255,255,0.86);
    margin-bottom: 4px;
  }
  ._brain-truth-body {
    font-size: 11px;
    color: rgba(255,255,255,0.55);
    line-height: 1.55;
  }
  ._brain-est {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  ._brain-est-pill {
    display: inline-flex;
    align-items: center;
    padding: 1px 5px;
    border-radius: 3px;
    border: 1px solid rgba(255,184,0,0.32);
    color: #ffb800;
    background: rgba(255,184,0,0.1);
    font-size: 9px;
    font-family: var(--mono, monospace);
  }
  ._brain-muted {
    color: rgba(255,255,255,0.45);
  }
  ._brain-state-list {
    margin: 8px 0 0;
    padding-left: 18px;
    color: rgba(255,255,255,0.52);
    font-size: 11px;
    line-height: 1.6;
  }
`;

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("zh-TW", { hour12: false });
}

function formatCost(usd: number | string) {
  const n = typeof usd === "string" ? parseFloat(usd) : usd;
  return isNaN(n) ? "—" : `$${n.toFixed(4)}`;
}

function EstimateBadge() {
  return <span className="_brain-est-pill">估算 EST</span>;
}

function EstimatedCost({ value }: { value: number | string }) {
  return (
    <span className="_brain-est">
      {formatCost(value)}
      <EstimateBadge />
    </span>
  );
}

function statusStyle(status: string) {
  if (status === "success") return { background: "rgba(76,175,80,0.15)", color: "#4caf50", border: "1px solid rgba(76,175,80,0.3)" };
  if (status === "failure" || status === "error") return { background: "rgba(239,83,80,0.15)", color: "#ef5350", border: "1px solid rgba(239,83,80,0.3)" };
  return { background: "rgba(255,184,0,0.15)", color: "#ffb800", border: "1px solid rgba(255,184,0,0.3)" };
}

function TruthSummary({ from, to }: { from: string; to: string }) {
  return (
    <div className="_brain-truth-grid">
      <div className="_brain-truth-card">
        <div className="_brain-truth-kicker">SOURCE</div>
        <div className="_brain-truth-title">營運資料庫，不是真實帳單</div>
        <div className="_brain-truth-body">
          使用 <code>{LLM_USAGE_ENDPOINT}</code>、<code>{LLM_CALLS_ENDPOINT}</code>、<code>{LLM_MODELS_ENDPOINT}</code>。
          來源表為 <code>llm_calls</code>、<code>llm_cost_daily</code>、<code>llm_models_registry</code>。
        </div>
      </div>
      <div className="_brain-truth-card">
        <div className="_brain-truth-kicker">CALCULATION</div>
        <div className="_brain-truth-title">費用以 token 與登錄單價推估</div>
        <div className="_brain-truth-body">
          視窗：{from} 到 {to}。<code>cost_usd</code> 是系統紀錄的估算值（ESTIMATE ONLY）；
          實際付款、折扣、稅費與調整仍以 OpenAI dashboard 或供應商帳單為準。
        </div>
      </div>
      <div className="_brain-truth-card">
        <div className="_brain-truth-kicker">資料責任 / 下一步</div>
        <div className="_brain-truth-title">估算資料維護狀態</div>
        <div className="_brain-truth-body">
          目前由系統內部紀錄 LLM 呼叫與模型單價。若要顯示真實帳單，需串正式供應商 billing API；
          未串前所有美元數字一律標為估算。
        </div>
      </div>
    </div>
  );
}

function SyncNote({
  title,
  reason,
  endpoint,
  next,
}: {
  title: string;
  reason: string;
  endpoint: string;
  next: string;
}) {
  return (
    <div className="state-panel">
      <span className="badge badge-yellow">{title}</span>
      <span className="state-reason">{reason}</span>
      <ul className="_brain-state-list">
        <li>資料來源：<code>{endpoint}</code></li>
        <li>資料責任：系統營運紀錄</li>
        <li>下一步：{next}</li>
      </ul>
    </div>
  );
}

function UsageKpi({ usage }: { usage: LlmUsageSummary }) {
  return (
    <div className="_brain-kpi">
      <div className="_brain-kpi-cell">
        <span className="_brain-kpi-val" style={{ color: "#4caf50" }}>正常</span>
        <span className="_brain-kpi-lbl">資料服務</span>
      </div>
      <div className="_brain-kpi-cell">
        <span className="_brain-kpi-val">{usage.totalCalls}</span>
        <span className="_brain-kpi-lbl">DB 呼叫紀錄</span>
      </div>
      <div className="_brain-kpi-cell">
        <span className="_brain-kpi-val">{(usage.totalTokens / 1000).toFixed(1)}K</span>
        <span className="_brain-kpi-lbl">DB token 紀錄</span>
      </div>
      <div className="_brain-kpi-cell">
        <span className="_brain-kpi-val" style={{ color: "#ffb800" }}><EstimatedCost value={usage.totalCostUsd} /></span>
        <span className="_brain-kpi-lbl">推估費用 非帳單</span>
      </div>
      <div className="_brain-kpi-cell">
        <span className="_brain-kpi-val">{usage.byModel.length}</span>
        <span className="_brain-kpi-lbl">登錄模型數</span>
      </div>
    </div>
  );
}

function UsageBreakdown({ usage }: { usage: LlmUsageSummary }) {
  return (
    <>
      <div className="_brain-table-wrap">
        <table className="_brain-table">
          <thead>
            <tr>
              <th>模型</th>
              <th>呼叫（DB 記錄）</th>
              <th>Token（DB 記錄）</th>
              <th>費用（估算，非帳單）</th>
            </tr>
          </thead>
          <tbody>
            {usage.byModel.length === 0 ? (
              <tr><td colSpan={4} style={{ color: "rgba(255,255,255,0.3)", textAlign: "center" }}>目前沒有 LLM 呼叫紀錄，因此不顯示費用。</td></tr>
            ) : usage.byModel.map((row) => (
              <tr key={row.modelKey}>
                <td>{row.modelKey}</td>
                <td>{row.calls}</td>
                <td>{(row.tokens / 1000).toFixed(1)}K</td>
                <td><EstimatedCost value={row.costUsd} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {usage.byModule.length > 0 && (
        <>
          <div style={{ marginTop: 16, marginBottom: 6, fontSize: 10, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.05em" }}>按模組分類</div>
          <div className="_brain-table-wrap">
            <table className="_brain-table">
              <thead>
                <tr>
                  <th>模組</th>
                  <th>呼叫（DB 記錄）</th>
                  <th>Token（DB 記錄）</th>
                  <th>費用（估算，非帳單）</th>
                </tr>
              </thead>
              <tbody>
                {usage.byModule.map((row) => (
                  <tr key={row.callerModule}>
                    <td>{row.callerModule}</td>
                    <td>{row.calls}</td>
                    <td>{(row.tokens / 1000).toFixed(1)}K</td>
                    <td><EstimatedCost value={row.costUsd} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <div className="_brain-disclaimer">
        {usage.disclaimer}。本頁只顯示 IUF operational ledger 的估算，不代表 provider invoice、信用卡扣款或正式帳單。
      </div>
    </>
  );
}

function ModelRegistry({ models }: { models: LlmModelEntry[] }) {
  return (
    <>
      <div className="_brain-table-wrap">
        <table className="_brain-table">
          <thead>
            <tr>
              <th>modelKey</th>
              <th>供應商</th>
              <th>名稱</th>
              <th>輸入登錄單價 / 1M token</th>
              <th>輸出登錄單價 / 1M token</th>
              <th>最大 context</th>
              <th>啟用</th>
            </tr>
          </thead>
          <tbody>
            {models.length === 0 ? (
              <tr><td colSpan={7} style={{ color: "rgba(255,255,255,0.3)", textAlign: "center" }}>尚無模型登錄資料；無法推估成本。</td></tr>
            ) : models.map((m) => (
              <tr key={m.modelKey}>
                <td style={{ color: "#ffb800" }}>{m.modelKey}</td>
                <td>{m.provider}</td>
                <td>{m.displayName}</td>
                <td><span className="_brain-est">{m.inputPricePer1mTokens}<EstimateBadge /></span></td>
                <td><span className="_brain-est">{m.outputPricePer1mTokens}<EstimateBadge /></span></td>
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
      </div>
      <div className="_brain-disclaimer">
        模型單價只用於本系統估算，並非即時 provider price sheet；若供應商價格更新，需同步更新登錄表。
      </div>
    </>
  );
}

function RecentCalls({ calls }: { calls: LlmCallEntry[] }) {
  return (
    <div className="_brain-table-wrap">
      <table className="_brain-table">
        <thead>
          <tr>
            <th>時間</th>
            <th>模組</th>
            <th>模型</th>
            <th>Prompt token</th>
            <th>Completion token</th>
            <th>費用（估算，非帳單）</th>
            <th>延遲</th>
            <th>狀態</th>
          </tr>
        </thead>
        <tbody>
          {calls.length === 0 ? (
            <tr><td colSpan={8} style={{ color: "rgba(255,255,255,0.3)", textAlign: "center" }}>目前尚無近期 LLM 呼叫紀錄。</td></tr>
          ) : calls.map((c) => (
            <tr key={c.id}>
              <td style={{ whiteSpace: "nowrap" }}>{fmtDateTime(c.createdAt)}</td>
              <td>{c.callerModule}</td>
              <td>{c.modelKey}</td>
              <td>{c.promptTokens}</td>
              <td>{c.completionTokens}</td>
              <td><EstimatedCost value={c.costUsd} /></td>
              <td>{c.latencyMs != null ? `${c.latencyMs}ms` : "—"}</td>
              <td>
                <span className="_brain-badge" style={statusStyle(c.status)}>{c.status}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
      note="管理頁。此頁是 LLM operational ledger，不是正式帳單；所有 cost_usd / token cost 皆為估算。"
    >
      <style>{CSS}</style>

      <TruthSummary from={sevenDaysAgo} to={today} />

      {usage ? <UsageKpi usage={usage} /> : (
        <div className="_brain-kpi">
          <div className="_brain-kpi-cell">
            <span className="_brain-kpi-val" style={{ color: "#ffb800" }}>BLOCKED</span>
            <span className="_brain-kpi-lbl">資料暫不可讀</span>
          </div>
        </div>
      )}

      <Panel code="ADM-BRAIN-USAGE" title="7 日費用摘要（估算）" right={`${sevenDaysAgo} → ${today}`}>
        {usageError || !usage
          ? <SyncNote
              title="用量資料不可讀"
              reason="登入狀態未通過、資料服務回應異常，或 LLM ledger 尚未寫入資料。頁面不會把 0 或錯誤值當成真實帳單。"
              endpoint={`${LLM_USAGE_ENDPOINT}?from=${sevenDaysAgo}&to=${today}`}
              next="確認登入狀態、資料服務健康度，以及 llm_calls / llm_cost_daily 是否有紀錄。"
            />
          : <UsageBreakdown usage={usage} />
        }
      </Panel>

      <Panel code="ADM-BRAIN-MODELS" title="模型登錄與估算單價" right={modelsError ? "BLOCKED" : `${models.length} 個模型`}>
        {modelsError
          ? <SyncNote
              title="模型登錄不可讀"
              reason="無法讀取 LLM 模型登錄表，因此不可推估成本。"
              endpoint={LLM_MODELS_ENDPOINT}
              next="確認模型登錄資料表與管理權限是否可用。"
            />
          : <ModelRegistry models={models} />
        }
      </Panel>

      <Panel code="ADM-BRAIN-CALLS" title="近期 50 筆呼叫紀錄" right={callsError ? "BLOCKED" : `${calls.length} 筆`}>
        {callsError
          ? <SyncNote
              title="呼叫紀錄不可讀"
              reason="無法讀取近期 LLM 呼叫紀錄；不顯示空白表格或假資料。"
              endpoint={LLM_CALLS_ENDPOINT}
              next="確認 llm_calls 是否有寫入，以及管理登入狀態是否有效。"
            />
          : <RecentCalls calls={calls} />
        }
      </Panel>
    </PageFrame>
  );
}
