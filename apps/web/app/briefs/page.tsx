import { PageFrame, Panel } from "@/components/PageFrame";
import { MetricStrip } from "@/components/RadarWidgets";
import { getBriefs, getOpenAliceObservability, type OpenAliceObservability } from "@/lib/api";
import { friendlyDataError } from "@/lib/friendly-error";
import { cleanExternalHeadline, cleanNarrativeText } from "@/lib/operator-copy";
import type { DailyBrief } from "@iuf-trading-room/contracts";

export const dynamic = "force-dynamic";

type OpenAliceSurface = "LIVE" | "STALE" | "BLOCKED";

type OpenAliceState =
  | { state: "LIVE"; surface: OpenAliceSurface; data: OpenAliceObservability; updatedAt: string; source: string }
  | { state: "BLOCKED"; surface: "BLOCKED"; data: null; updatedAt: string; source: string; reason: string };

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function sortBriefs(briefs: DailyBrief[]) {
  return [...briefs].sort((a, b) => {
    const bTime = Date.parse(b.createdAt);
    const aTime = Date.parse(a.createdAt);
    return bTime - aTime;
  });
}

function statusBadge(status: DailyBrief["status"]) {
  return status === "published" ? "badge-green" : "badge-yellow";
}

function statusLabel(status: DailyBrief["status"]) {
  if (status === "published") return "已發布";
  if (status === "draft") return "草稿";
  return status;
}

function surfaceLabel(state: "EMPTY" | "BLOCKED") {
  return state === "EMPTY" ? "無資料" : "暫停";
}

function marketLabel(value: string | null | undefined) {
  if (value === "Attack") return "進攻";
  if (value === "Selective Attack") return "選擇性進攻";
  if (value === "Defense") return "防守";
  if (value === "Preservation") return "保全";
  if (value === "Balanced") return "平衡";
  return value ?? "市場簡報";
}

function producerLabel(value: string | null | undefined) {
  const key = value?.toLowerCase() ?? "";
  if (key.includes("openalice")) return "AI 摘要";
  if (key.includes("worker")) return "系統排程";
  if (key.includes("manual")) return "人工整理";
  return value ?? "--";
}

async function loadOpenAliceStatus(): Promise<OpenAliceState> {
  const updatedAt = new Date().toISOString();
  try {
    const response = await getOpenAliceObservability();
    const data = response.data;
    const surface: OpenAliceSurface =
      data.workerStatus === "healthy" && data.sweepStatus === "healthy"
        ? "LIVE"
        : data.workerStatus === "missing" && data.sweepStatus === "missing"
          ? "BLOCKED"
          : "STALE";

    return {
      state: "LIVE",
      surface,
      data,
      updatedAt,
      source: data.source === "redis" ? "OpenAlice Redis 指標" : "OpenAlice bridge fallback",
    };
  } catch (error) {
    return {
      state: "BLOCKED",
      surface: "BLOCKED",
      data: null,
      updatedAt,
      source: "OpenAlice observability",
      reason: friendlyDataError(error, "OpenAlice 產文狀態暫時無法讀取。"),
    };
  }
}

function openAliceLabel(state: OpenAliceSurface) {
  if (state === "LIVE") return "正常";
  if (state === "STALE") return "過期";
  return "暫停";
}

function openAliceBadge(state: OpenAliceSurface) {
  if (state === "LIVE") return "badge-green";
  if (state === "STALE") return "badge-yellow";
  return "badge-red";
}

function openAliceTone(state: OpenAliceSurface) {
  if (state === "LIVE") return "status-ok";
  if (state === "STALE") return "gold";
  return "status-bad";
}

function statusText(value: string | null | undefined) {
  if (value === "healthy") return "正常";
  if (value === "stale") return "過期";
  if (value === "missing") return "暫停";
  return value ?? "--";
}

function ageText(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "--";
  if (seconds < 60) return `${Math.round(seconds)} 秒前`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} 分前`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} 小時前`;
  return `${Math.round(seconds / 86400)} 天前`;
}

function BriefStatePanel({
  state,
  reason,
  updatedAt,
}: {
  state: "EMPTY" | "BLOCKED";
  reason: string;
  updatedAt: string;
}) {
  return (
    <Panel code={`BRF-${state}`} title={surfaceLabel(state)} right="每日簡報來源">
      <div className="state-panel">
        <span className={`badge ${state === "EMPTY" ? "badge-yellow" : "badge-red"}`}>{surfaceLabel(state)}</span>
        <span className="tg soft">來源：每日簡報資料庫</span>
        <span className="tg soft">更新 {formatDateTime(updatedAt)}</span>
        <span className="state-reason">{reason}</span>
      </div>
    </Panel>
  );
}

export default async function BriefsPage() {
  let briefs: DailyBrief[] = [];
  let error: string | null = null;
  const requestedAt = new Date().toISOString();
  const openAlice = await loadOpenAliceStatus();

  try {
    const response = await getBriefs();
    briefs = sortBriefs(response.data ?? []);
  } catch (err) {
    error = friendlyDataError(err, "每日簡報暫時無法讀取。");
  }

  const latest = briefs[0] ?? null;
  const publishedCount = briefs.filter((brief) => brief.status === "published").length;
  const draftCount = briefs.filter((brief) => brief.status === "draft").length;
  const totalSections = latest?.sections.length ?? 0;
  const surfaceState = error ? "BLOCKED" : latest ? "LIVE" : "EMPTY";

  return (
    <PageFrame
      code="BRF"
      title="每日簡報"
      sub="台股盤前 / 盤後摘要"
      note="每日簡報 / 真實資料；先建立資料框架，後續再接 OpenAlice 自動產文，不顯示假新聞或假建議。"
    >
      <MetricStrip
        columns={7}
        cells={[
          { label: "狀態", value: surfaceState === "LIVE" ? "正常" : surfaceState === "EMPTY" ? "無資料" : "暫停", tone: surfaceState === "LIVE" ? "status-ok" : surfaceState === "EMPTY" ? "gold" : "status-bad" },
          { label: "簡報數", value: briefs.length },
          { label: "已發布", value: publishedCount, tone: publishedCount > 0 ? "status-ok" : "muted" },
          { label: "草稿", value: draftCount, tone: draftCount > 0 ? "gold" : "muted" },
          { label: "段落", value: latest ? totalSections : "--" },
          { label: "最新日期", value: latest?.date ?? "--" },
          { label: "AI 產文", value: openAliceLabel(openAlice.surface), tone: openAliceTone(openAlice.surface) },
        ]}
      />

      <section className="brief-command-deck">
        <div>
          <span className="tg gold">每日簡報 / 台股情報框架</span>
          <h2>每天要看什麼，先把資料入口定清楚。</h2>
          <p>
            這裡會承接台股盤勢、重大訊息、候選策略、風控狀態與 OpenAlice 摘要。
            現在只顯示正式資料庫內容；未接線前不自動生成假新聞或假建議。
          </p>
        </div>
        <div className="brief-source-card">
          <span>來源狀態</span>
          <strong className={surfaceState === "LIVE" ? "status-ok" : surfaceState === "EMPTY" ? "gold" : "status-bad"}>
            {surfaceState === "LIVE" ? "正式資料" : surfaceState === "EMPTY" ? "等待首份" : "資料暫停"}
          </strong>
          <p>{latest ? `最新簡報 ${latest.date}，共 ${latest.sections.length} 段。` : "尚未取得正式簡報資料，先顯示接線規格。"}</p>
        </div>
      </section>

      <Panel code="BRF-AI-STAT" title="OpenAlice 產文狀態" sub="worker / sweep / queue" right={openAliceLabel(openAlice.surface)}>
        <div className="state-panel brief-openalice-state">
          <span className={`badge ${openAliceBadge(openAlice.surface)}`}>{openAliceLabel(openAlice.surface)}</span>
          <span className="tg soft">來源：{openAlice.source}</span>
          <span className="tg soft">檢查：{formatDateTime(openAlice.updatedAt)}</span>
          {openAlice.state === "BLOCKED" ? (
            <span className="state-reason">{openAlice.reason}</span>
          ) : (
            <div className="brief-openalice-grid">
              <span>worker：<strong>{statusText(openAlice.data.workerStatus)}</strong></span>
              <span>sweep：<strong>{statusText(openAlice.data.sweepStatus)}</strong></span>
              <span>最後心跳：<strong>{ageText(openAlice.data.workerHeartbeatAgeSeconds)}</strong></span>
              <span>最後掃描：<strong>{ageText(openAlice.data.lastSweepAgeSeconds)}</strong></span>
              <span>排隊：<strong>{openAlice.data.metrics.queuedJobs}</strong></span>
              <span>執行中：<strong>{openAlice.data.metrics.runningJobs}</strong></span>
              <span>過期執行：<strong>{openAlice.data.metrics.staleRunningJobs}</strong></span>
              <span>裝置：<strong>{openAlice.data.metrics.activeDevices}</strong></span>
            </div>
          )}
          <span className="state-reason">
            此面板只揭露 OpenAlice 是否有新產文能力；不把舊簡報改寫成新簡報，也不產生買賣建議。
          </span>
        </div>
      </Panel>

      {(error || !latest) && (
        <div className="brief-empty-grid">
          {error ? (
            <BriefStatePanel
              state="BLOCKED"
              reason={`簡報資料暫時無法讀取。負責：內容與後端資料管線。${error}`}
              updatedAt={requestedAt}
            />
          ) : (
            <BriefStatePanel
              state="EMPTY"
              reason="目前工作區沒有每日簡報資料列，不顯示假簡報。"
              updatedAt={requestedAt}
            />
          )}
          <Panel code="BRF-SPEC" title="接線目標" sub="先資料框架，後 AI 產文" right="待接">
            <div className="brief-spec-list">
              <span>盤勢：TAIEX / TPEx / 成交量 / 漲跌家數 / 外資買賣超。</span>
              <span>焦點：FinMind 財報、月營收、法人、融資券與重大訊息。</span>
              <span>策略：策略想法與策略批次只做候選摘要，不直接轉單。</span>
              <span>風控：交易模式、kill-switch、帳戶風險與可用資金狀態。</span>
            </div>
          </Panel>
          <Panel code="BRF-AI" title="OpenAlice 摘要" sub="後續接線" right="不造假">
            <div className="brief-spec-list">
              <span>OpenAlice 只能根據已入庫資料產生摘要，不能憑空寫新聞。</span>
              <span>每段摘要需保留來源類型與更新時間，方便回查。</span>
              <span>沒有資料時顯示 EMPTY / BLOCKED，不放漂亮但無依據的文字。</span>
            </div>
          </Panel>
        </div>
      )}

      {!error && latest && (
        <>
          <section className="daily-brief-sheet">
            <div className="daily-brief-head">
              <div>
                <span className="tg panel-code">每日簡報</span>
                <h2>{latest.date}</h2>
                <p>台股操作摘要 / 正式資料庫</p>
              </div>
              <div className="daily-brief-meta">
                <span className="badge badge-green">正常</span>
                <span>盤勢：{marketLabel(latest.marketState)}</span>
                <span>來源：每日簡報資料庫</span>
                <span>更新 {formatDateTime(latest.createdAt)}</span>
              </div>
            </div>

            <div className="daily-brief-body">
              {latest.sections.map((section) => (
                <article className="brief-section" key={`${latest.id}-${section.heading}`}>
                  <h2>{cleanExternalHeadline(section.heading, "日報段落")}</h2>
                  <p>{cleanNarrativeText(section.body, "段落尚未完成中文整理；保留來源紀錄。")}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="daily-brief-history">
            <div className="plans-surface-head compact">
              <div>
                <span className="tg panel-code">簡報歷史</span>
                <h2>資料庫紀錄</h2>
              </div>
              <span className="tg soft">{briefs.length} 筆</span>
            </div>
            <div className="brief-history-table">
              <div className="brief-history-row table-head">
                <span>日期</span>
                <span>盤勢</span>
                <span>狀態</span>
                <span>產生者</span>
                <span>建立</span>
              </div>
              {briefs.map((brief) => (
                <div className="brief-history-row" key={brief.id}>
                  <span className="tg gold">{brief.date}</span>
                  <span className="tg">{marketLabel(brief.marketState)}</span>
                  <span className={`badge ${statusBadge(brief.status)}`}>{statusLabel(brief.status)}</span>
                  <span className="tg soft">{producerLabel(brief.generatedBy)}</span>
                  <span className="tg soft">{formatDateTime(brief.createdAt)}</span>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </PageFrame>
  );
}
