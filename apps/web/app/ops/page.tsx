import { PageFrame } from "@/components/PageFrame";
import { getOpsSnapshot } from "@/lib/api";
import { friendlyDataError } from "@/lib/friendly-error";
import { cleanExternalHeadline, cleanNarrativeText, cleanRiskRewardText, cleanTradePlanText } from "@/lib/operator-copy";

export const dynamic = "force-dynamic";

type OpsSnapshot = Awaited<ReturnType<typeof getOpsSnapshot>>["data"];
type LoadState =
  | { state: "LIVE"; data: OpsSnapshot | null; updatedAt: string; source: string }
  | { state: "EMPTY"; data: OpsSnapshot | null; updatedAt: string; source: string; reason: string }
  | { state: "BLOCKED"; data: OpsSnapshot | null; updatedAt: string; source: string; reason: string };

async function loadOps(): Promise<LoadState> {
  const source = "營運快照";
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
        reason: "營運快照目前沒有統計、稽核列或佇列工作。",
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
      reason: friendlyDataError(error, "營運監控暫時無法讀取。"),
    };
  }
}

function formatTime(value: string | null | undefined) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString("zh-TW", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-TW", {
    timeZone: "Asia/Taipei",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function stateTone(state: LoadState["state"]) {
  if (state === "LIVE") return "status-ok";
  if (state === "EMPTY") return "gold";
  return "status-bad";
}

function stateLabel(state: LoadState["state"]) {
  if (state === "LIVE") return "正常";
  if (state === "EMPTY") return "無資料";
  return "暫停";
}

function healthLabel(state: string | undefined) {
  if (state === "healthy") return "健康";
  if (state === "stale") return "過期";
  if (!state) return "--";
  return state;
}

function healthColors(state: string | undefined) {
  if (state === "healthy") return { dot: "#4adb88", text: "#4adb88" };
  if (state === "stale") return { dot: "#e2b85c", text: "#e2b85c" };
  return { dot: "#ff6b77", text: "#ff6b77" };
}

function severityTone(value: string | undefined) {
  if (value === "danger") return "status-bad";
  if (value === "warning") return "gold";
  if (value === "success") return "status-ok";
  return "muted";
}

function opsModeLabel(value: string | null | undefined) {
  if (!value) return "--";
  if (value === "production") return "正式";
  if (value === "demo") return "展示";
  if (value === "database") return "資料庫";
  if (value === "memory") return "記憶模式";
  if (value === "disabled") return "停用";
  return value.replace(/[_-]/g, " ");
}

function latestBucketLabel(value: string) {
  const key = value.toLowerCase();
  if (key.includes("theme")) return "主題";
  if (key.includes("compan")) return "公司";
  if (key.includes("signal")) return "訊號";
  if (key.includes("plan")) return "計畫";
  if (key.includes("brief")) return "簡報";
  if (key.includes("review")) return "復盤";
  return value.replace(/[_-]/g, " ");
}

function auditActionLabel(value: string) {
  const key = value.toUpperCase();
  if (key === "READ") return "讀取";
  if (key === "WRITE") return "寫入";
  if (key === "CREATE") return "新增";
  if (key === "UPDATE") return "更新";
  if (key === "DELETE") return "刪除";
  if (key === "LOGIN") return "登入";
  if (key === "LOGOUT") return "登出";
  return value.replace(/[_-]/g, " ");
}

function entityLabel(value: string | null | undefined) {
  if (!value) return "資料列";
  const key = value.toLowerCase();
  if (key.includes("theme")) return "主題";
  if (key.includes("compan")) return "公司";
  if (key.includes("signal")) return "訊號";
  if (key.includes("plan")) return "交易計畫";
  if (key.includes("brief")) return "每日簡報";
  if (key.includes("review")) return "復盤";
  if (key.includes("paper")) return "模擬交易";
  if (key.includes("order")) return "委託";
  return value.replace(/[_-]/g, " ");
}

function cleanOpsLatestText(value: string) {
  return value
    .replace(/\[ORPHAN\]\s*/gi, "")
    .replace(/\[待修-[^\]]+\]\s*To Fix/gi, "待修資料列")
    .replace(/\bTWSE\b/g, "上市")
    .replace(/\bTPEX\b|\bOTC\b/g, "上櫃")
    .replace(/\bObservation\b/g, "觀察")
    .replace(/\bCore\b/g, "核心")
    .replace(/\bDirect\b/g, "直接受惠")
    .replace(/\bIndirect\b/g, "間接受惠")
    .replace(/\bstatus\b/gi, "狀態")
    .replace(/\bready\b/gi, "已就緒")
    .replace(/\bworker\b/gi, "背景服務")
    .replace(/\bdraft\b/gi, "草稿")
    .replace(/\s*\/\s*--\s*$/g, "")
    .trim();
}

function latestRowText(label: string, subtitle?: string | null) {
  const main = cleanOpsLatestText(cleanTradePlanText(label, cleanExternalHeadline(label, "資料列尚未完成中文整理")));
  const sub = subtitle ? cleanOpsLatestText(cleanRiskRewardText(cleanNarrativeText(subtitle, subtitle))) : "";
  if (!sub || sub === "--") return main;
  return sub ? `${main} / ${sub}` : main;
}

function workspaceLabel(value: string | null | undefined) {
  if (!value) return "主控工作區";
  if (/primary desk/i.test(value)) return "主控工作區";
  return cleanOpsLatestText(value);
}

const OPS_CSS = `
._ops-hero-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 1px;
  background: rgba(220,228,240,0.09);
  border: 1px solid rgba(220,228,240,0.13);
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: 28px;
}
._ops-hero-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 18px 20px;
  background: rgba(8,11,16,0.82);
  transition: background 0.15s;
}
._ops-hero-cell:hover { background: rgba(255,255,255,0.03); }
._ops-hero-val {
  font-size: 28px;
  font-weight: 800;
  letter-spacing: -0.5px;
  line-height: 1;
  font-family: var(--mono, monospace);
  font-variant-numeric: tabular-nums;
}
._ops-hero-lbl {
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgba(145,160,181,0.65);
  font-family: var(--mono, monospace);
}
._ops-main-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 16px;
  margin-top: 0;
}
._ops-panel {
  background: rgba(8,11,16,0.65);
  border: 1px solid rgba(220,228,240,0.09);
  border-radius: 4px;
  overflow: hidden;
}
._ops-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 14px 18px 12px;
  border-bottom: 1px solid rgba(220,228,240,0.07);
  background: rgba(255,255,255,0.02);
}
._ops-panel-code {
  font-size: 9px;
  font-family: var(--mono, monospace);
  letter-spacing: 0.08em;
  color: rgba(145,160,181,0.45);
  text-transform: uppercase;
}
._ops-panel-title {
  font-size: 13px;
  font-weight: 700;
  color: #e7ecf3;
}
._ops-panel-sub {
  font-size: 11px;
  color: rgba(145,160,181,0.6);
  margin-left: auto;
}
._ops-panel-body {
  padding: 14px 18px;
}
._ops-kv-list {
  display: grid;
  gap: 0;
}
._ops-kv-row {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 12px;
  align-items: center;
  padding: 8px 0;
  border-bottom: 1px solid rgba(220,228,240,0.05);
}
._ops-kv-row:last-child { border-bottom: none; }
._ops-kv-label {
  font-size: 11px;
  font-family: var(--mono, monospace);
  color: rgba(200,148,63,0.85);
  letter-spacing: 0.02em;
  white-space: nowrap;
}
._ops-kv-value {
  font-size: 12px;
  color: rgba(220,228,240,0.8);
  text-align: right;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--mono, monospace);
}
._ops-health-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  margin-right: 6px;
  flex-shrink: 0;
}
._ops-health-ok { background: #4adb88; box-shadow: 0 0 5px rgba(46,204,113,0.55); }
._ops-health-warn { background: #e2b85c; }
._ops-health-bad { background: #ff6b77; }
._ops-queue-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 0;
  border-bottom: 1px solid rgba(220,228,240,0.05);
}
._ops-queue-row:last-child { border-bottom: none; }
._ops-telex-row {
  display: grid;
  grid-template-columns: 88px 60px 1fr;
  gap: 8px;
  align-items: center;
  padding: 7px 0;
  border-bottom: 1px solid rgba(220,228,240,0.05);
}
._ops-telex-row:last-child { border-bottom: none; }
._ops-telex-ts {
  font-size: 10px;
  font-family: var(--mono, monospace);
  color: rgba(145,160,181,0.55);
}
._ops-telex-cat {
  font-size: 10px;
  font-family: var(--mono, monospace);
  color: rgba(200,148,63,0.8);
}
._ops-telex-txt {
  font-size: 11px;
  color: rgba(220,228,240,0.7);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
._ops-audit-action {
  font-size: 10px;
  font-family: var(--mono, monospace);
  padding: 2px 7px;
  border-radius: 2px;
}
._ops-audit-create { background: rgba(46,204,113,0.10); color: #4adb88; }
._ops-audit-update { background: rgba(200,148,63,0.10); color: #e2b85c; }
._ops-audit-delete { background: rgba(230,57,70,0.10); color: #ff6b77; }
._ops-audit-read { background: rgba(145,160,181,0.08); color: #91a0b5; }
._ops-audit-other { background: rgba(145,160,181,0.05); color: #566276; }
._ops-empty-note {
  padding: 18px 0;
  font-size: 12px;
  color: rgba(145,160,181,0.55);
  text-align: center;
  font-style: italic;
}
._ops-blocked-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding: 56px 32px;
  text-align: center;
}
._ops-blocked-icon {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: rgba(230,57,70,0.07);
  border: 2px solid rgba(230,57,70,0.35);
  display: flex;
  align-items: center;
  justify-content: center;
}
@media (max-width: 960px) {
  ._ops-main-grid { grid-template-columns: 1fr 1fr; }
}
@media (max-width: 640px) {
  ._ops-main-grid { grid-template-columns: 1fr; }
  ._ops-hero-row { grid-template-columns: 1fr 1fr; }
  ._ops-telex-row { grid-template-columns: 70px 50px 1fr; }
}
`;

function auditActionClass(action: string) {
  const key = action.toUpperCase();
  if (key === "CREATE") return "_ops-audit-create";
  if (key === "UPDATE" || key === "WRITE") return "_ops-audit-update";
  if (key === "DELETE") return "_ops-audit-delete";
  if (key === "READ") return "_ops-audit-read";
  return "_ops-audit-other";
}

export default async function OpsPage() {
  const result = await loadOps();
  const data = result.data;
  const stats = data?.stats;
  const queue = data?.openAlice.queue;
  const obs = data?.openAlice.observability;
  const healthC = healthColors(obs?.workerStatus);

  return (
    <PageFrame
      code="OPS"
      title="營運監控"
      sub="系統快照"
      note="營運監控 / 正式營運快照；不顯示假健康檢查或假工作。"
    >
      <style>{OPS_CSS}</style>

      {/* Hero KPI row */}
      <div className="_ops-hero-row">
        <div className="_ops-hero-cell">
          <span className="_ops-hero-val" style={{ color: result.state === "LIVE" ? "#e7ecf3" : "#566276" }}>
            {data ? stateLabel(result.state) : "--"}
          </span>
          <span className="_ops-hero-lbl">系統狀態</span>
        </div>
        <div className="_ops-hero-cell">
          <span className="_ops-hero-val" style={{ color: data ? "#e2b85c" : "#566276" }}>
            {data ? (stats?.themes ?? 0).toLocaleString("zh-TW") : "--"}
          </span>
          <span className="_ops-hero-lbl">主題</span>
        </div>
        <div className="_ops-hero-cell">
          <span className="_ops-hero-val" style={{ color: data ? "#e2b85c" : "#566276" }}>
            {data ? (stats?.companies ?? 0).toLocaleString("zh-TW") : "--"}
          </span>
          <span className="_ops-hero-lbl">主檔列數</span>
        </div>
        <div className="_ops-hero-cell">
          <span className="_ops-hero-val" style={{ color: data && (queue?.failed ?? 0) > 0 ? "#ff6b77" : data ? "#4adb88" : "#566276" }}>
            {data ? (queue?.totalJobs ?? 0) : "--"}
          </span>
          <span className="_ops-hero-lbl">佇列工作</span>
        </div>
        <div className="_ops-hero-cell">
          <span className="_ops-hero-val" style={{ color: data && data.audit.total > 0 ? "#e2b85c" : "#566276" }}>
            {data ? data.audit.total : "--"}
          </span>
          <span className="_ops-hero-lbl">今日稽核</span>
        </div>
        <div className="_ops-hero-cell">
          <span className="_ops-hero-val" style={{ color: obs ? healthC.text : "#566276", fontSize: 16, paddingTop: 6 }}>
            <span className={`_ops-health-dot ${obs?.workerStatus === "healthy" ? "_ops-health-ok" : obs?.workerStatus === "stale" ? "_ops-health-warn" : "_ops-health-bad"}`} />
            {obs ? healthLabel(obs.workerStatus) : "--"}
          </span>
          <span className="_ops-hero-lbl">背景服務</span>
        </div>
      </div>

      <div className="parity-kpi-bar">
        <div className="parity-kpi-cell">
          <span className="parity-kpi-label">系統狀態</span>
          <span className={`parity-kpi-value ${result.state === "LIVE" ? "ok" : result.state === "EMPTY" ? "warn" : "bad"}`}>
            {result.state === "LIVE" ? "可用" : result.state === "EMPTY" ? "待補" : "需處理"}
          </span>
          <span className="parity-kpi-sub">營運監控</span>
        </div>
        <div className="parity-kpi-cell">
          <span className="parity-kpi-label">主題</span>
          <span className="parity-kpi-value">{result.state !== "BLOCKED" && result.data ? result.data.stats.themes : "--"}</span>
          <span className="parity-kpi-sub">台股主題</span>
        </div>
        <div className="parity-kpi-cell">
          <span className="parity-kpi-label">公司</span>
          <span className="parity-kpi-value">{result.state !== "BLOCKED" && result.data ? result.data.stats.companies : "--"}</span>
          <span className="parity-kpi-sub">公司池</span>
        </div>
        <div className="parity-kpi-cell">
          <span className="parity-kpi-label">訊號</span>
          <span className={`parity-kpi-value ${result.state !== "BLOCKED" && result.data && result.data.stats.signals > 0 ? "ok" : "dim"}`}>
            {result.state !== "BLOCKED" && result.data ? result.data.stats.signals : "--"}
          </span>
          <span className="parity-kpi-sub">本輪訊號</span>
        </div>
      </div>

      {/* BLOCKED */}
      {result.state === "BLOCKED" && (
        <div className="_ops-blocked-state">
          <div className="_ops-blocked-icon">
            <span style={{ color: "#ff6b77", fontSize: 22 }}>✕</span>
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#c6d0de", marginBottom: 6 }}>營運快照暫停</div>
            <div style={{ fontSize: 13, color: "#566276", lineHeight: 1.6 }}>
              {(result as Extract<LoadState, { state: "BLOCKED" }>).reason}
            </div>
          </div>
        </div>
      )}

      {/* Main content grid */}
      {data && (
        <div className="_ops-main-grid">

          {/* Col 1: Snapshot stats + Queue */}
          <div>
            <div className="_ops-panel">
              <div className="_ops-panel-head">
                <span className="_ops-panel-code">OPS-SRC</span>
                <span className="_ops-panel-title">營運快照</span>
                <span className="_ops-panel-sub">更新 {formatTime(result.updatedAt)}</span>
              </div>
              <div className="_ops-panel-body">
                <div className="_ops-kv-list">
                  {[
                    ["工作區", workspaceLabel(data.workspace.name)],
                    ["產生時間", formatDateTime(data.generatedAt)],
                    ["核心公司", String(data.stats.coreCompanies)],
                    ["直接受惠", String(data.stats.directCompanies)],
                    ["進行計畫", String(data.stats.activePlans)],
                    ["審核佇列", String(data.stats.reviewQueue)],
                    ["已發布簡報", String(data.stats.publishedBriefs)],
                    ["偏多訊號", String(data.stats.bullishSignals)],
                  ].map(([label, value]) => (
                    <div key={label} className="_ops-kv-row">
                      <span className="_ops-kv-label">{label}</span>
                      <span className="_ops-kv-value">{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Queue panel */}
            <div className="_ops-panel" style={{ marginTop: 14 }}>
              <div className="_ops-panel-head">
                <span className="_ops-panel-code">JOB-Q</span>
                <span className="_ops-panel-title">背景佇列</span>
                <span className="_ops-panel-sub" style={{ color: obs ? healthC.text : undefined }}>
                  {obs ? (
                    <>
                      <span className={`_ops-health-dot ${obs.workerStatus === "healthy" ? "_ops-health-ok" : obs.workerStatus === "stale" ? "_ops-health-warn" : "_ops-health-bad"}`} />
                      {healthLabel(obs.workerStatus)}
                    </>
                  ) : "暫停"}
                </span>
              </div>
              <div className="_ops-panel-body">
                {(!data || !obs) && <div className="_ops-empty-note">無佇列觀測資料</div>}
                {obs && queue && (
                  <div className="_ops-kv-list">
                    {[
                      ["背景服務", healthLabel(obs.workerStatus), healthColors(obs.workerStatus).text],
                      ["掃描", healthLabel(obs.sweepStatus), healthColors(obs.sweepStatus).text],
                      ["模式", opsModeLabel(obs.metrics.mode), undefined],
                      ["排隊", String(queue.queued), queue.queued > 0 ? "#e2b85c" : undefined],
                      ["執行中", String(queue.running), queue.running > 0 ? "#4adb88" : undefined],
                      ["失敗", String(queue.failed), queue.failed > 0 ? "#ff6b77" : undefined],
                      ["過期執行", String(obs.metrics.staleRunningJobs), obs.metrics.staleRunningJobs > 0 ? "#ff6b77" : undefined],
                    ].map(([label, value, color]) => (
                      <div key={label} className="_ops-kv-row">
                        <span className="_ops-kv-label">{label}</span>
                        <span className="_ops-kv-value" style={color ? { color } : undefined}>{value}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Col 2: Latest rows */}
          <div>
            <div className="_ops-panel">
              <div className="_ops-panel-head">
                <span className="_ops-panel-code">LAT-ROW</span>
                <span className="_ops-panel-title">最新資料列</span>
                <span className="_ops-panel-sub">主題 / 公司 / 訊號 / 計畫</span>
              </div>
              <div className="_ops-panel-body">
                {Object.entries(data.latest).flatMap(([bucket, rows]) =>
                  rows.slice(0, 3).map((row) => (
                    <div key={`${bucket}-${row.id}`} className="_ops-telex-row">
                      <span className="_ops-telex-ts">{formatDateTime(row.timestamp)}</span>
                      <span className="_ops-telex-cat">{latestBucketLabel(bucket)}</span>
                      <span className="_ops-telex-txt">
                        {latestRowText(row.label, row.subtitle)}
                      </span>
                    </div>
                  ))
                )}
                {Object.values(data.latest).every((rows) => rows.length === 0) && (
                  <div className="_ops-empty-note">快照中沒有最新資料列</div>
                )}
              </div>
            </div>
          </div>

          {/* Col 3: Audit */}
          <div>
            <div className="_ops-panel">
              <div className="_ops-panel-head">
                <span className="_ops-panel-code">AUD-SUM</span>
                <span className="_ops-panel-title">稽核摘要</span>
                <span className="_ops-panel-sub">近 24 小時</span>
              </div>
              <div className="_ops-panel-body">
                {data.audit.actions.length === 0 && <div className="_ops-empty-note">沒有稽核摘要</div>}
                {data.audit.actions.map((item) => (
                  <div key={item.action} className="_ops-kv-row">
                    <span className="_ops-kv-label">{auditActionLabel(item.action)}</span>
                    <span className="_ops-kv-value">{item.count}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="_ops-panel" style={{ marginTop: 14 }}>
              <div className="_ops-panel-head">
                <span className="_ops-panel-code">AUD-TBL</span>
                <span className="_ops-panel-title">稽核事件</span>
                <span className="_ops-panel-sub">{data.audit.recent.length} 筆</span>
              </div>
              <div className="_ops-panel-body">
                {data.audit.recent.length === 0 && <div className="_ops-empty-note">沒有最近稽核列</div>}
                {data.audit.recent.slice(0, 10).map((event) => (
                  <div key={event.id} className="_ops-telex-row">
                    <span className="_ops-telex-ts">{formatDateTime(event.createdAt)}</span>
                    <span className={`_ops-audit-action ${auditActionClass(event.action)}`}>
                      {auditActionLabel(event.action)}
                    </span>
                    <span className="_ops-telex-txt">
                      {entityLabel(event.entityType)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

        </div>
      )}

      {/* Empty state */}
      {result.state === "EMPTY" && (
        <div className="_ops-blocked-state">
          <div className="_ops-blocked-icon" style={{ background: "rgba(200,148,63,0.07)", borderColor: "rgba(200,148,63,0.35)" }}>
            <span style={{ color: "#e2b85c", fontSize: 22 }}>◌</span>
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#c6d0de", marginBottom: 6 }}>快照目前沒有資料</div>
            <div style={{ fontSize: 13, color: "#566276", lineHeight: 1.6 }}>
              {(result as Extract<LoadState, { state: "EMPTY" }>).reason}
            </div>
          </div>
        </div>
      )}
    </PageFrame>
  );
}
