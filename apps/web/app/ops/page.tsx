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
      <span className={stateTone(result.state)} style={{ fontWeight: 700 }}>{stateLabel(result.state)}</span>
      <span>來源：{result.source}</span>
      <span>更新 {formatTime(result.updatedAt)}</span>
      {result.state !== "LIVE" && <span>{result.reason}</span>}
    </div>
  );
}

function EmptyOrBlocked({ result }: { result: LoadState }) {
  if (result.state === "LIVE") return null;
  return (
    <div className="terminal-note">
      <span className={`tg ${stateTone(result.state)}`}>{stateLabel(result.state)}</span>{" "}
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
      title="營運監控"
      sub="系統快照"
      note="營運監控 / 正式營運快照；不顯示假健康檢查或假工作。"
    >
      <MetricStrip
        cells={[
          { label: "狀態", value: stateLabel(result.state), tone: stateTone(result.state) },
          { label: "主題", value: data ? stats?.themes ?? 0 : "--" },
          { label: "公司", value: data ? stats?.companies ?? 0 : "--" },
          { label: "訊號", value: data ? stats?.signals ?? 0 : "--" },
          { label: "佇列", value: data ? queue?.totalJobs ?? 0 : "--", tone: (queue?.failed ?? 0) > 0 ? "down" : "muted" },
          { label: "稽核", value: data ? data.audit.total : "--", tone: data && data.audit.total > 0 ? "gold" : "muted" },
          { label: "Worker", value: healthLabel(obs?.workerStatus), tone: obs ? healthTone(obs.workerStatus) : "muted" },
        ]}
        columns={7}
      />

      <div className="main-grid">
        <div>
          <Panel code="OPS-SRC" title={`${formatTime(result.updatedAt)} 台北`} sub="快照來源" right={stateLabel(result.state)}>
            <SourceLine result={result} />
            <EmptyOrBlocked result={result} />
            {data && (
              <div style={{ border: "1px solid var(--night-rule-strong)" }}>
                {[
                  ["工作區", `${data.workspace.name} / ${data.workspace.slug}`],
                  ["產生時間", data.generatedAt],
                  ["核心公司", String(data.stats.coreCompanies)],
                  ["直接受惠", String(data.stats.directCompanies)],
                  ["進行計畫", String(data.stats.activePlans)],
                  ["審核佇列", String(data.stats.reviewQueue)],
                  ["已發布簡報", String(data.stats.publishedBriefs)],
                  ["偏多訊號", String(data.stats.bullishSignals)],
                ].map(([label, value]) => (
                  <div className="row limit-row" key={label}>
                    <span className="tg gold">{label}</span>
                    <span className="tg" style={{ gridColumn: "span 2", textAlign: "right" }}>{value}</span>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel code="JOB-Q" title="OpenAlice 佇列" sub="背景執行觀測" right={healthLabel(obs?.workerStatus) ?? "暫停"}>
            {!data && <div className="terminal-note"><span className="tg down">暫停</span> 營運快照無法讀取時，OpenAlice 觀測先隱藏。</div>}
            {data && !obs && <div className="terminal-note"><span className="tg gold">無資料</span> 沒有 OpenAlice 觀測 payload。</div>}
            {obs && queue && (
              <>
                {[
                  ["Worker", healthLabel(obs.workerStatus), healthTone(obs.workerStatus)],
                  ["掃描", healthLabel(obs.sweepStatus), healthTone(obs.sweepStatus)],
                  ["模式", obs.metrics.mode, "muted"],
                  ["排隊", String(queue.queued), queue.queued > 0 ? "gold" : "muted"],
                  ["執行中", String(queue.running), queue.running > 0 ? "up" : "muted"],
                  ["失敗", String(queue.failed), queue.failed > 0 ? "down" : "muted"],
                  ["過期執行", String(obs.metrics.staleRunningJobs), obs.metrics.staleRunningJobs > 0 ? "down" : "muted"],
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
          <Panel code="LAT-ROW" title="最新資料列" sub="主題 / 公司 / 訊號 / 計畫" right="資料庫">
            {!data && <div className="terminal-note"><span className="tg down">暫停</span> 營運快照無法讀取時，最新資料列先隱藏。</div>}
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
              <div className="terminal-note"><span className="tg gold">無資料</span> 快照中沒有最新資料列。</div>
            )}
          </Panel>
        </div>

        <div>
          <Panel code="AUD-SUM" title="稽核摘要" sub="近 24 小時" right={data ? `${data.audit.total} 筆` : "暫停"}>
            {!data && <div className="terminal-note"><span className="tg down">暫停</span> 營運快照無法讀取時，稽核摘要先隱藏。</div>}
            {data?.audit.actions.length === 0 && <div className="terminal-note"><span className="tg gold">無資料</span> 沒有稽核摘要。</div>}
            {data?.audit.actions.map((item) => (
              <div className="row limit-row" key={item.action}>
                <span className="tg gold">{item.action}</span>
                <span className="num" style={{ gridColumn: "span 2", textAlign: "right" }}>{item.count}</span>
              </div>
            ))}
          </Panel>

          <Panel code="AUD-TBL" title="稽核事件" sub="最近寫入 / 讀取" right={data ? `${data.audit.recent.length} 筆` : "暫停"}>
            {!data && <div className="terminal-note"><span className="tg down">暫停</span> 營運快照無法讀取時，稽核事件先隱藏。</div>}
            {data?.audit.recent.length === 0 && <div className="terminal-note"><span className="tg gold">無資料</span> 沒有最近稽核列。</div>}
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
