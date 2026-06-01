import { PageFrame, Panel } from "@/components/PageFrame";
import {
  getToolCalls,
  getToolRegistry,
  getToolStats,
  type ToolCallEntry,
  type ToolRegistryEntry,
  type ToolStatEntry,
} from "@/lib/api";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const TOOL_REGISTRY_ENDPOINT = "/api/v1/tools/registry";
const TOOL_CALLS_ENDPOINT = "/api/v1/tools/calls?limit=50";
const TOOL_STATS_ENDPOINT = "/api/v1/tools/stats?window=24h";
const TOOL_EXECUTION_ENTRY = "後端 callTool 包裝層";

const TOOL_ZH_COPY: Record<string, { displayName: string; description: string }> = {
  ai_reviewer: {
    displayName: "AI 內容審核",
    description: "檢查內容草稿的合規性、幻覺風險與基本品質；結果只作為審核流程的一層證據。",
  },
  adversarial_reviewer: {
    displayName: "反向壓力審核",
    description: "用較嚴格角度檢查市場偏誤、誘導式語句與隱性指令，避免內容看起來合理但實際有風險。",
  },
  factual_reviewer: {
    displayName: "事實一致性審核",
    description: "比對來源資料，標記可能捏造的數字、公司、事件或未被資料支撐的結論。",
  },
  hallu_rag: {
    displayName: "來源引用檢查",
    description: "用檢索資料檢查引用與來源包是否一致；無法確認時不宣稱通過。",
  },
  finmind_sync: {
    displayName: "FinMind 資料同步",
    description: "同步台股日線、法人買賣超與券資等資料到本地資料庫；需要有效 token 與額度。",
  },
  themes_links_rebuild: {
    displayName: "公司主題關聯重建",
    description: "重建公司與題材主題的關聯圖，清掉過期連結後依目前公司池重新建立。",
  },
  content_drafts_retry: {
    displayName: "內容草稿重跑審核",
    description: "把卡在等待審核的內容草稿重新送回審核流程；一次最多處理 50 筆。",
  },
  get_market_overview: {
    displayName: "大盤總覽",
    description: "讀取加權指數、櫃買指數、成交量與漲跌家數，用於 AI 推薦前的市場狀態判斷。",
  },
  get_sector_rotation: {
    displayName: "類股輪動強度",
    description: "依 OHLCV 與籌碼資料計算類股相對強弱，協助判斷資金正在往哪個族群移動。",
  },
  get_company_technical: {
    displayName: "個股技術面",
    description: "讀取個股 K 線、RSI、均線與量能特徵，提供推薦引擎做進出場與風險判斷。",
  },
  get_institutional_flow: {
    displayName: "三大法人籌碼",
    description: "讀取個股法人買賣超與近 30 日籌碼變化，作為推薦理由或風險排除條件。",
  },
  get_news_top10: {
    displayName: "AI 精選新聞",
    description: "讀取今日 AI 篩選後的重要新聞與情緒判斷，供推薦引擎與市場情報頁使用。",
  },
};

const CSS = `
  ._tool-kpi {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(118px, 1fr));
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
    min-width: 0;
  }
  ._tool-kpi-val {
    font-size: 18px;
    font-weight: 700;
    font-family: var(--mono, monospace);
    color: #e0e0e0;
    line-height: 1.1;
    max-width: 100%;
    overflow-wrap: anywhere;
    text-align: center;
  }
  ._tool-kpi-lbl {
    font-size: 10px;
    color: rgba(255,255,255,0.44);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    text-align: center;
  }
  ._tool-truth {
    display: grid;
    gap: 10px;
    padding: 12px;
    margin-bottom: 16px;
    border: 1px solid rgba(255,184,0,0.22);
    border-radius: 6px;
    background: rgba(255,184,0,0.06);
  }
  ._tool-truth-title {
    color: #ffb800;
    font-size: 12px;
    font-weight: 700;
  }
  ._tool-truth-body {
    color: rgba(255,255,255,0.72);
    font-size: 12px;
    line-height: 1.6;
  }
  ._tool-meta-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
    gap: 8px;
  }
  ._tool-meta-cell {
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 6px;
    padding: 8px;
    background: rgba(0,0,0,0.2);
    min-width: 0;
  }
  ._tool-meta-label {
    display: block;
    color: rgba(255,255,255,0.42);
    font-size: 10px;
    margin-bottom: 4px;
    text-transform: uppercase;
  }
  ._tool-meta-value {
    display: block;
    color: rgba(255,255,255,0.78);
    font-size: 11px;
    font-family: var(--mono, monospace);
    overflow-wrap: anywhere;
  }
  ._tool-table-wrap {
    overflow-x: auto;
    width: 100%;
  }
  ._tool-table {
    width: 100%;
    min-width: 1120px;
    border-collapse: collapse;
    font-size: 11px;
  }
  ._tool-table th {
    text-align: left;
    padding: 7px 10px;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: rgba(255,255,255,0.42);
    border-bottom: 1px solid rgba(255,255,255,0.08);
    white-space: nowrap;
  }
  ._tool-table td {
    padding: 8px 10px;
    color: rgba(255,255,255,0.76);
    border-bottom: 1px solid rgba(255,255,255,0.04);
    vertical-align: top;
  }
  ._tool-table tr:last-child td { border-bottom: none; }
  ._tool-table tr:hover td { background: rgba(255,255,255,0.02); }
  ._tool-key {
    color: #ffb800;
    font-family: var(--mono, monospace);
    font-weight: 700;
  }
  ._tool-sub {
    display: block;
    margin-top: 4px;
    color: rgba(255,255,255,0.46);
    font-size: 10px;
    line-height: 1.4;
  }
  ._tool-badge {
    display: inline-flex;
    align-items: center;
    padding: 2px 7px;
    border-radius: 3px;
    font-size: 10px;
    font-weight: 700;
    white-space: nowrap;
  }
  ._tool-badge + ._tool-badge {
    margin-left: 4px;
  }
  ._tool-schema-preview {
    font-size: 10px;
    color: rgba(255,255,255,0.48);
    max-width: 260px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--mono, monospace);
  }
  ._tool-endpoint-stack {
    display: grid;
    gap: 4px;
    min-width: 210px;
  }
  ._tool-tech-details {
    margin-top: 7px;
    min-width: 160px;
  }
  ._tool-tech-details summary {
    cursor: pointer;
    color: #ffb800;
    display: inline-block;
    font-size: 10px;
    font-weight: 700;
    line-height: 1.35;
    white-space: nowrap;
  }
  ._tool-tech-details summary::marker {
    color: rgba(255,184,0,0.65);
  }
  ._tool-tech-body {
    display: grid;
    gap: 4px;
    margin-top: 7px;
    padding-top: 7px;
    border-top: 1px solid rgba(255,255,255,0.08);
  }
  ._tool-endpoint-line {
    display: block;
    color: rgba(255,255,255,0.68);
    font-size: 10px;
    line-height: 1.35;
    font-family: var(--mono, monospace);
    overflow-wrap: anywhere;
  }
  ._tool-stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
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
    font-weight: 700;
    color: #ffb800;
    font-family: var(--mono, monospace);
    margin-bottom: 8px;
  }
  ._tool-stat-row {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    font-size: 10px;
    color: rgba(255,255,255,0.52);
    margin-bottom: 3px;
  }
  ._tool-stat-val {
    font-family: var(--mono, monospace);
    color: rgba(255,255,255,0.82);
    text-align: right;
  }
  @media (max-width: 720px) {
    ._tool-kpi {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    ._tool-table {
      min-width: 1060px;
    }
  }
`;

function badgeStyle(kind: "ok" | "warn" | "bad" | "muted" | "info") {
  if (kind === "ok") return { background: "rgba(76,175,80,0.15)", color: "#4caf50", border: "1px solid rgba(76,175,80,0.3)" };
  if (kind === "bad") return { background: "rgba(239,83,80,0.15)", color: "#ef5350", border: "1px solid rgba(239,83,80,0.3)" };
  if (kind === "info") return { background: "rgba(33,150,243,0.15)", color: "#42a5f5", border: "1px solid rgba(33,150,243,0.3)" };
  if (kind === "muted") return { background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.55)", border: "1px solid rgba(255,255,255,0.1)" };
  return { background: "rgba(255,184,0,0.15)", color: "#ffb800", border: "1px solid rgba(255,184,0,0.3)" };
}

function toolTypeBadgeStyle(toolType: string) {
  if (toolType === "llm") return badgeStyle("info");
  if (toolType === "review") return { background: "rgba(156,39,176,0.15)", color: "#ce93d8", border: "1px solid rgba(156,39,176,0.3)" };
  if (toolType === "data_sync") return { background: "rgba(0,150,136,0.15)", color: "#4db6ac", border: "1px solid rgba(0,150,136,0.3)" };
  if (toolType === "cron") return { background: "rgba(255,152,0,0.15)", color: "#ffa726", border: "1px solid rgba(255,152,0,0.3)" };
  if (toolType === "admin_action") return badgeStyle("warn");
  return badgeStyle("muted");
}

function callerTypeBadgeStyle(callerType: string) {
  if (callerType === "llm") return badgeStyle("info");
  if (callerType === "cron") return { background: "rgba(255,152,0,0.15)", color: "#ffa726", border: "1px solid rgba(255,152,0,0.3)" };
  if (callerType === "admin_action") return badgeStyle("warn");
  return badgeStyle("muted");
}

function toolTypeLabel(toolType: string) {
  const labels: Record<string, string> = {
    llm: "AI 工具",
    review: "審核工具",
    data_sync: "資料同步",
    cron: "排程工具",
    admin_action: "管理操作",
  };
  return labels[toolType] ?? "工具";
}

function callerTypeLabel(callerType: string) {
  const labels: Record<string, string> = {
    llm: "AI 流程",
    brain_react: "AI 分析流程",
    cron: "排程",
    admin_action: "管理操作",
  };
  return labels[callerType] ?? "系統流程";
}

function statusBadgeStyle(status: string) {
  if (status === "success") return badgeStyle("ok");
  if (status === "failure" || status === "error") return badgeStyle("bad");
  if (status === "timeout") return badgeStyle("warn");
  if (status === "pending") return badgeStyle("info");
  return badgeStyle("muted");
}

function statusLabel(status: string | null | undefined) {
  if (status === "success") return "成功";
  if (status === "failure" || status === "error") return "失敗";
  if (status === "timeout") return "逾時";
  if (status === "pending") return "處理中";
  return "無紀錄";
}

function fmtDT(iso: string | null | undefined) {
  if (!iso) return "無紀錄";
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return "時間格式錯誤";
  return dt.toLocaleString("zh-TW", { hour12: false });
}

function fmtLatency(ms: number | null) {
  if (ms == null) return "未回報";
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms}ms`;
}

function errorRatePct(rate: number) {
  return rate > 1 ? rate : rate * 100;
}

function shortJson(value: unknown) {
  if (value == null) return "未定義輸入欄位";
  if (typeof value === "object" && value !== null) {
    const maybeSchema = value as { properties?: Record<string, unknown>; required?: unknown[] };
    const names = Object.keys(maybeSchema.properties ?? {});
    if (names.length > 0) return `已定義 ${names.length} 個輸入欄位`;
  }
  const text = JSON.stringify(value);
  return text && text !== "{}" ? "已定義輸入格式" : "不需輸入";
}

function toolDetailEndpoint(toolKey: string) {
  return `${TOOL_REGISTRY_ENDPOINT}/${encodeURIComponent(toolKey)}`;
}

function productSummary(value: string | null | undefined, emptyLabel: string) {
  if (!value) return emptyLabel;
  const text = value.trim();
  if (!text) return emptyLabel;
  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (Array.isArray(parsed)) return `已回傳 ${parsed.length} 筆正式結果`;
      if (parsed && typeof parsed === "object") return `已回傳 ${Object.keys(parsed).length} 個結果欄位`;
      return "已回傳正式結果";
    } catch {
      return "已回傳正式結果，原始內容已隱藏";
    }
  }
  return text
    .replaceAll("sourceState", "資料狀態")
    .replaceAll("brain_react", "AI 分析流程")
    .replaceAll("owner", "管理權限");
}

function latestCallByTool(calls: ToolCallEntry[]) {
  const map = new Map<string, ToolCallEntry>();
  for (const call of calls) {
    if (!map.has(call.toolKey)) map.set(call.toolKey, call);
  }
  return map;
}

function statByTool(stats: ToolStatEntry[]) {
  const map = new Map<string, ToolStatEntry>();
  for (const stat of stats) map.set(stat.toolKey, stat);
  return map;
}

function toolCopy(tool: ToolRegistryEntry) {
  return TOOL_ZH_COPY[tool.toolKey] ?? {
    displayName: tool.displayName,
    description: tool.description ?? "尚未建立中文工具說明；需補 ToolCenter registry copy。",
  };
}

function readiness(tool: ToolRegistryEntry, stat: ToolStatEntry | undefined, latest: ToolCallEntry | undefined) {
  if (!tool.isActive) {
    return {
      label: "未啟用",
      kind: "muted" as const,
      detail: "工具目前停用，不應被當成可用功能。",
    };
  }
  if (latest?.status === "success") {
    return {
      label: "可執行，有成功紀錄",
      kind: "ok" as const,
      detail: "近期已有成功執行紀錄，仍需管理權限。",
    };
  }
  if (latest?.status === "failure" || latest?.status === "timeout") {
    return {
      label: "可執行但需檢查",
      kind: "bad" as const,
      detail: `最近一次為${statusLabel(latest.status)}；先看錯誤摘要與執行紀錄。`,
    };
  }
  if (stat && stat.totalCalls > 0) {
    const pct = errorRatePct(stat.errorRate);
    return {
      label: pct > 25 ? "執行紀錄偏不穩" : "可執行，需觀察",
      kind: pct > 25 ? "warn" as const : "ok" as const,
      detail: `24h ${stat.totalCalls} 次；錯誤率 ${pct.toFixed(1)}%。`,
    };
  }
  return {
    label: "已登錄，待執行證據",
    kind: "warn" as const,
    detail: "工具已登錄，但尚無近期成功紀錄；前端不宣稱已成功。",
  };
}

function TruthPanel({
  title,
  detail,
  next,
}: {
  title: string;
  detail: string;
  next: string;
}) {
  return (
    <div className="_tool-truth">
      <div className="_tool-truth-title">{title}</div>
      <div className="_tool-truth-body">{detail}</div>
      <div className="_tool-meta-grid">
        <div className="_tool-meta-cell">
          <span className="_tool-meta-label">資料來源</span>
          <span className="_tool-meta-value">工具登錄</span>
          <span className="_tool-meta-value">近期呼叫紀錄</span>
          <span className="_tool-meta-value">24h 統計</span>
        </div>
        <div className="_tool-meta-cell">
          <span className="_tool-meta-label">資料狀態</span>
          <span className="_tool-meta-value">管理登入後讀取正式資料</span>
        </div>
        <div className="_tool-meta-cell">
          <span className="_tool-meta-label">下一步</span>
          <span className="_tool-meta-value">{next}</span>
        </div>
      </div>
    </div>
  );
}

function RegistryTable({
  tools,
  calls,
  stats,
}: {
  tools: ToolRegistryEntry[];
  calls: ToolCallEntry[];
  stats: ToolStatEntry[];
}) {
  const latest = latestCallByTool(calls);
  const byStat = statByTool(stats);

  if (tools.length === 0) {
    return (
      <TruthPanel
        title="目前沒有 ToolCenter 工具登錄"
        detail="工具登錄資料可讀但回傳 0 筆；此頁不補展示工具，也不把空資料當成可執行能力。"
        next="確認 ToolCenter seed 與工具登錄資料是否已寫入。"
      />
    );
  }

  return (
    <div className="_tool-table-wrap">
      <table className="_tool-table">
        <thead>
          <tr>
            <th>工具</th>
            <th>類型</th>
            <th>執行狀態</th>
            <th>權限 / 入口</th>
            <th>最後執行證據</th>
            <th>說明</th>
            <th>輸入欄位</th>
          </tr>
        </thead>
        <tbody>
          {tools.map((tool) => {
            const toolStat = byStat.get(tool.toolKey);
            const toolLatest = latest.get(tool.toolKey);
            const state = readiness(tool, toolStat, toolLatest);
            const copy = toolCopy(tool);
            return (
              <tr key={tool.toolKey}>
                <td>
                  <span className="_tool-key">{tool.toolKey}</span>
                  <span className="_tool-sub">版本 {tool.version}</span>
                </td>
                <td>
                  <span className="_tool-badge" style={toolTypeBadgeStyle(tool.toolType)}>{toolTypeLabel(tool.toolType)}</span>
                  {!tool.isActive && <span className="_tool-badge" style={badgeStyle("muted")}>展示/停用</span>}
                </td>
                <td>
                  <span className="_tool-badge" style={badgeStyle(state.kind)}>{state.label}</span>
                  <span className="_tool-sub">{state.detail}</span>
                </td>
                <td>
                  <span className="_tool-badge" style={badgeStyle("warn")}>管理權限</span>
                  <span className="_tool-sub">登錄：管理權限可讀</span>
                  <span className="_tool-sub">執行：只能由後端受控流程觸發；此頁沒有手動執行按鈕。</span>
                  <details className="_tool-tech-details">
                    <summary>查看技術細節</summary>
                    <span className="_tool-tech-body">
                      <span className="_tool-endpoint-line">資料端點 GET {toolDetailEndpoint(tool.toolKey)}</span>
                      <span className="_tool-endpoint-line">稽核 {TOOL_CALLS_ENDPOINT}&amp;toolKey={encodeURIComponent(tool.toolKey)}</span>
                      <span className="_tool-endpoint-line">執行入口 {TOOL_EXECUTION_ENTRY}</span>
                    </span>
                  </details>
                </td>
                <td>
                  <span className="_tool-badge" style={statusBadgeStyle(toolLatest?.status ?? "none")}>{statusLabel(toolLatest?.status)}</span>
                  <span className="_tool-sub">{fmtDT(toolLatest?.createdAt)}</span>
                  <span className="_tool-sub">24h：{toolStat?.totalCalls ?? 0} 次 / 錯誤率 {toolStat ? `${errorRatePct(toolStat.errorRate).toFixed(1)}%` : "無統計"}</span>
                </td>
                <td>
                  {copy.displayName}
                  <span className="_tool-sub">{copy.description}</span>
                </td>
                <td>
                  <div className="_tool-schema-preview">{shortJson(tool.inputSchema)}</div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function StatsGrid({ stats, calls }: { stats: ToolStatEntry[]; calls: ToolCallEntry[] }) {
  const totalCalls = stats.reduce((sum, stat) => sum + stat.totalCalls, 0);
  const latestCallAt = calls[0]?.createdAt;
  const zeroWindowDetail = latestCallAt
    ? `過去 24 小時沒有工具呼叫統計；最近一筆工具呼叫是 ${fmtDT(latestCallAt)}，所以只會出現在下方「近期 50 筆呼叫」，不會計入 24h 統計。`
    : "統計資料端點可讀，但沒有近期呼叫統計；這代表沒有可展示的執行量，不代表工具已成功。";

  if (stats.length === 0) {
    return (
      <TruthPanel
        title="24h 統計目前為空"
        detail={zeroWindowDetail}
        next="等 cron / Brain / admin action 真的透過 callTool 執行後，此區才會出現成功率與延遲。"
      />
    );
  }

  return (
    <>
      {totalCalls === 0 && (
        <TruthPanel
          title="24h 統計目前為 0"
          detail={zeroWindowDetail}
          next="下方仍列出每個工具的 24h 統計列；全部為 0 時代表視窗內沒有真呼叫，不是前端漏資料。"
        />
      )}
      <div className="_tool-stats-grid">
        {stats.map((s) => (
          <div key={s.toolKey} className="_tool-stat-card">
            <div className="_tool-stat-key">{s.toolKey}</div>
            <div className="_tool-stat-row"><span>總呼叫</span><span className="_tool-stat-val">{s.totalCalls}</span></div>
            <div className="_tool-stat-row"><span>成功</span><span className="_tool-stat-val" style={{ color: "#4caf50" }}>{s.successCalls}</span></div>
            <div className="_tool-stat-row"><span>失敗</span><span className="_tool-stat-val" style={{ color: s.failureCalls > 0 ? "#ef5350" : "rgba(255,255,255,0.82)" }}>{s.failureCalls}</span></div>
            <div className="_tool-stat-row"><span>逾時</span><span className="_tool-stat-val" style={{ color: s.timeoutCalls > 0 ? "#ffb800" : "rgba(255,255,255,0.82)" }}>{s.timeoutCalls}</span></div>
            <div className="_tool-stat-row"><span>錯誤率</span><span className="_tool-stat-val" style={{ color: errorRatePct(s.errorRate) > 25 ? "#ef5350" : "#4caf50" }}>{errorRatePct(s.errorRate).toFixed(1)}%</span></div>
            <div className="_tool-stat-row"><span>平均延遲</span><span className="_tool-stat-val">{fmtLatency(s.avgLatencyMs)}</span></div>
          </div>
        ))}
      </div>
    </>
  );
}

function CallsTable({ calls }: { calls: ToolCallEntry[] }) {
  if (calls.length === 0) {
    return (
      <TruthPanel
        title="目前沒有近期工具呼叫"
        detail="呼叫紀錄資料端點可讀，但沒有記錄；此頁不顯示示意成功紀錄。"
        next="需要 Brain、排程或管理操作經由 callTool 包裝層產生真實工具呼叫紀錄。"
      />
    );
  }

  return (
    <div className="_tool-table-wrap">
      <table className="_tool-table">
        <thead>
          <tr>
            <th>時間</th>
            <th>工具</th>
            <th>呼叫者</th>
            <th>狀態</th>
            <th>延遲</th>
            <th>輸入摘要</th>
            <th>輸出 / 錯誤摘要</th>
          </tr>
        </thead>
        <tbody>
          {calls.map((call) => (
            <tr key={call.id}>
              <td style={{ whiteSpace: "nowrap" }}>{fmtDT(call.createdAt)}</td>
              <td><span className="_tool-key">{call.toolKey}</span></td>
              <td><span className="_tool-badge" style={callerTypeBadgeStyle(call.callerType)}>{callerTypeLabel(call.callerType)}</span></td>
              <td><span className="_tool-badge" style={statusBadgeStyle(call.status)}>{statusLabel(call.status)}</span></td>
              <td>{fmtLatency(call.latencyMs)}</td>
              <td><span className="_tool-sub">{productSummary(call.inputSummary, "未記錄輸入摘要")}</span></td>
              <td>
                <span className="_tool-sub">{productSummary(call.outputSummary ?? call.errorMessage, "未記錄輸出摘要")}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function ToolsAdminPage() {
  let activeTools: ToolRegistryEntry[] = [];
  let inactiveTools: ToolRegistryEntry[] = [];
  let calls: ToolCallEntry[] = [];
  let stats: ToolStatEntry[] = [];
  let toolsError = false;
  let inactiveToolsError = false;
  let callsError = false;
  let statsError = false;

  try {
    const res = await getToolRegistry({ isActive: true });
    activeTools = res.data?.tools ?? [];
  } catch {
    toolsError = true;
  }

  try {
    const res = await getToolRegistry({ isActive: false });
    inactiveTools = res.data?.tools ?? [];
  } catch {
    inactiveToolsError = true;
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

  const tools = [...activeTools, ...inactiveTools];
  const blocked = toolsError || callsError || statsError;
  const usableCount = tools.filter((tool) => tool.isActive).length;
  const observedSuccessCount = new Set(calls.filter((call) => call.status === "success").map((call) => call.toolKey)).size;

  return (
    <PageFrame
      code="ADM-TOOL"
      title="ToolCenter 登錄瀏覽器"
      sub="OpenAlice 工具登錄"
      note="只讀工具登錄、24h 統計與近期呼叫記錄；此頁沒有手動執行按鈕，不把未驗證工具顯示成已成功。"
    >
      <style>{CSS}</style>

      <div className="_tool-kpi">
        <div className="_tool-kpi-cell">
          <span className="_tool-kpi-val" style={{ color: blocked ? "#ffb800" : "#4caf50" }}>{blocked ? "受阻" : "可讀"}</span>
          <span className="_tool-kpi-lbl">資料狀態</span>
        </div>
        <div className="_tool-kpi-cell">
          <span className="_tool-kpi-val">{usableCount}</span>
          <span className="_tool-kpi-lbl">可用登錄</span>
        </div>
        <div className="_tool-kpi-cell">
          <span className="_tool-kpi-val">{inactiveToolsError ? "?" : inactiveTools.length}</span>
          <span className="_tool-kpi-lbl">停用/展示</span>
        </div>
        <div className="_tool-kpi-cell">
          <span className="_tool-kpi-val">{stats.length > 0 ? stats.reduce((s, r) => s + r.totalCalls, 0) : 0}</span>
          <span className="_tool-kpi-lbl">24h 呼叫</span>
        </div>
        <div className="_tool-kpi-cell">
          <span className="_tool-kpi-val">{observedSuccessCount}</span>
          <span className="_tool-kpi-lbl">成功證據</span>
        </div>
      </div>

      {blocked && (
        <TruthPanel
          title="ToolCenter 目前不是完整可讀狀態"
          detail="至少一個 ToolCenter 資料來源未能讀取；前端已停止用空表格假裝正常，並明確列出資料狀態。"
          next="重新驗證管理登入狀態；若仍失敗，再檢查 ToolCenter 權限、migration 與工具呼叫紀錄寫入。"
        />
      )}

      <Panel code="ADM-TOOL-REG" title="工具登錄表" right={toolsError ? "受阻" : `${tools.length} 工具`}>
        {toolsError
          ? (
            <TruthPanel
              title="工具登錄無法讀取"
              detail="工具登錄資料未通過管理登入或後端不可用；此頁不顯示備用工具清單。"
              next="確認管理登入狀態，再檢查 ToolCenter 登錄資料。"
            />
          )
          : <RegistryTable tools={tools} calls={calls} stats={stats} />
        }
      </Panel>

      <Panel code="ADM-TOOL-STATS" title="24h 工具統計" right={statsError ? "受阻" : `${stats.length} 工具`}>
        {statsError
          ? (
            <TruthPanel
              title="工具統計無法讀取"
              detail="工具統計未回正式資料；錯誤率與延遲不可被估算。"
              next="重新驗證管理登入狀態，再檢查工具統計與工具呼叫紀錄聚合。"
            />
          )
          : <StatsGrid stats={stats} calls={calls} />
        }
      </Panel>

      <Panel code="ADM-TOOL-CALLS" title="近期 50 筆呼叫" right={callsError ? "受阻" : `${calls.length} 筆`}>
        {callsError
          ? (
            <TruthPanel
              title="工具呼叫記錄無法讀取"
              detail="工具呼叫紀錄未回正式資料；不能顯示任何推測的 last run。"
              next="確認 callTool 包裝層是否有寫入工具呼叫紀錄；若資料存在但讀取失敗，再檢查 route/auth。"
            />
          )
          : <CallsTable calls={calls} />
        }
      </Panel>
    </PageFrame>
  );
}
