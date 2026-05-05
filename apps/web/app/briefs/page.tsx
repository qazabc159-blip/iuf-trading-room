import { PageFrame, Panel } from "@/components/PageFrame";
import { MetricStrip } from "@/components/RadarWidgets";
import { getBriefs, getContentDrafts, getOpenAliceObservability } from "@/lib/api";
import { friendlyDataError } from "@/lib/friendly-error";
import { cleanExternalHeadline, cleanNarrativeText } from "@/lib/operator-copy";
import type { DailyBrief } from "@iuf-trading-room/contracts";

export const dynamic = "force-dynamic";

type BriefFreshness =
  | { state: "CURRENT"; label: "今日"; tone: "status-ok"; reason: string }
  | { state: "STALE"; label: "過期"; tone: "status-bad"; reason: string }
  | { state: "UNDATED"; label: "待確認"; tone: "gold"; reason: string };

type OpenAlicePanelState = {
  state: "LIVE" | "STALE" | "MISSING" | "BLOCKED";
  label: string;
  tone: "status-ok" | "status-bad" | "gold";
  note: string;
  updatedAt: string | null;
};

const TAIPEI_TIME_ZONE = "Asia/Taipei";

function taipeiDateKey(value: Date | string = new Date()) {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TAIPEI_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("zh-TW", {
    timeZone: TAIPEI_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatAge(value: string | null | undefined) {
  if (!value) return "--";
  const time = Date.parse(value);
  if (Number.isNaN(time)) return "--";
  const minutes = Math.max(0, Math.floor((Date.now() - time) / 60000));
  if (minutes < 60) return `${minutes} 分鐘前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} 小時前`;
  return `${Math.floor(hours / 24)} 天前`;
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

function classifyBriefFreshness(brief: DailyBrief | null, requestedAt: string): BriefFreshness {
  if (!brief) {
    return {
      state: "UNDATED",
      label: "待確認",
      tone: "gold",
      reason: "目前沒有正式每日簡報資料列。",
    };
  }
  const today = taipeiDateKey(requestedAt);
  const briefDate = (brief.date ?? "").slice(0, 10);
  if (!briefDate) {
    return {
      state: "UNDATED",
      label: "待確認",
      tone: "gold",
      reason: "這份簡報沒有可判讀的日期，不能當成今日摘要。",
    };
  }
  if (briefDate !== today) {
    return {
      state: "STALE",
      label: "過期",
      tone: "status-bad",
      reason: `最新正式簡報是 ${briefDate}，不是今日台北日期 ${today}。OpenAlice 可能未產出、仍待審核，或 worker fallback 被舊草稿擋住。`,
    };
  }
  return {
    state: "CURRENT",
    label: "今日",
    tone: "status-ok",
    reason: "正式每日簡報日期等於今日台北日期。",
  };
}

function sourceBadgeClass(freshness: BriefFreshness, brief: DailyBrief | null) {
  if (!brief) return "badge-yellow";
  if (freshness.state === "CURRENT" && brief.status === "published") return "badge-green";
  if (freshness.state === "STALE") return "badge-red";
  return "badge-yellow";
}

function sourceStatusLabel(freshness: BriefFreshness, brief: DailyBrief | null) {
  if (!brief) return "無資料";
  if (freshness.state === "STALE") return "過期";
  if (brief.status === "published") return "正常";
  return "草稿";
}

async function loadOpenAlicePanel(): Promise<OpenAlicePanelState> {
  const checkedAt = new Date().toISOString();
  try {
    const response = await getOpenAliceObservability();
    const obs = response.data;
    if (obs.workerStatus === "healthy" && obs.sweepStatus === "healthy") {
      return {
        state: "LIVE",
        label: "正常",
        tone: "status-ok",
        note: `背景服務與掃描正常；最近心跳 ${formatAge(obs.workerHeartbeatAt)}。`,
        updatedAt: obs.workerHeartbeatAt ?? checkedAt,
      };
    }
    if (obs.workerStatus === "missing") {
      return {
        state: "MISSING",
        label: "未連線",
        tone: "status-bad",
        note: "OpenAlice runner 沒有可用心跳；正式簡報可能只能停在舊資料或後端 fallback。",
        updatedAt: obs.workerHeartbeatAt,
      };
    }
    return {
      state: "STALE",
      label: "過期",
      tone: "status-bad",
      note: `OpenAlice worker=${obs.workerStatus}、sweep=${obs.sweepStatus}；最近心跳 ${formatAge(obs.workerHeartbeatAt)}。`,
      updatedAt: obs.workerHeartbeatAt ?? obs.lastSweepAt,
    };
  } catch (error) {
    return {
      state: "BLOCKED",
      label: "無法讀取",
      tone: "status-bad",
      note: friendlyDataError(error, "OpenAlice 觀測端點暫時無法讀取。"),
      updatedAt: checkedAt,
    };
  }
}

async function loadDailyBriefDraftCount() {
  try {
    const response = await getContentDrafts({ status: "awaiting_review", limit: 50 });
    return response.data.filter((draft) => draft.targetTable === "daily_briefs").length;
  } catch {
    return null;
  }
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
  const [openAliceState, pendingBriefDrafts] = await Promise.all([
    loadOpenAlicePanel(),
    loadDailyBriefDraftCount(),
  ]);

  try {
    const response = await getBriefs();
    briefs = sortBriefs(response.data ?? []);
  } catch (err) {
    error = friendlyDataError(err, "每日簡報暫時無法讀取。");
  }

  const latest = briefs[0] ?? null;
  const freshness = classifyBriefFreshness(latest, requestedAt);
  const publishedCount = briefs.filter((brief) => brief.status === "published").length;
  const draftCount = briefs.filter((brief) => brief.status === "draft").length;
  const totalSections = latest?.sections.length ?? 0;
  const surfaceState = error ? "BLOCKED" : latest ? freshness.state === "STALE" ? "STALE" : "LIVE" : "EMPTY";
  const stateText = surfaceState === "LIVE" ? "正常" : surfaceState === "STALE" ? "過期" : surfaceState === "EMPTY" ? "無資料" : "暫停";
  const stateTone = surfaceState === "LIVE" ? "status-ok" : surfaceState === "EMPTY" ? "gold" : "status-bad";

  return (
    <PageFrame
      code="BRF"
      title="每日簡報"
      sub="台股盤前 / 盤後摘要"
      note="每日簡報 / 真實資料；先建立資料框架，後續再接 OpenAlice 自動產文，不顯示假新聞或假建議。"
    >
      <MetricStrip
        columns={6}
        cells={[
          { label: "狀態", value: stateText, tone: stateTone },
          { label: "簡報數", value: briefs.length },
          { label: "已發布", value: publishedCount, tone: publishedCount > 0 ? "status-ok" : "muted" },
          { label: "草稿", value: draftCount, tone: draftCount > 0 ? "gold" : "muted" },
          { label: "段落", value: latest ? totalSections : "--" },
          { label: "最新日期", value: latest?.date ?? "--" },
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
          <strong className={stateTone}>
            {surfaceState === "LIVE" ? "正式資料" : surfaceState === "STALE" ? "正式資料過期" : surfaceState === "EMPTY" ? "等待首份" : "資料暫停"}
          </strong>
          <p>{latest ? `最新簡報 ${latest.date}，共 ${latest.sections.length} 段。${freshness.reason}` : "尚未取得正式簡報資料，先顯示接線規格。"}</p>
        </div>
      </section>

      <section className="brief-ops-strip">
        <Panel code="BRF-FRESH" title="新鮮度檢查" sub="台北日期 / 正式資料庫" right={freshness.label}>
          <div className="state-panel">
            <span className={`badge ${sourceBadgeClass(freshness, latest)}`}>{sourceStatusLabel(freshness, latest)}</span>
            <span className="tg soft">今日台北日期：{taipeiDateKey(requestedAt)}</span>
            <span className="tg soft">最新資料：{latest?.date ?? "--"}</span>
            <span className="state-reason">{freshness.reason}</span>
          </div>
        </Panel>
        <Panel code="BRF-OA" title="OpenAlice 產文鏈路" sub="runner / worker / review" right={openAliceState.label}>
          <div className="state-panel">
            <span className={`badge ${openAliceState.tone === "status-ok" ? "badge-green" : openAliceState.tone === "gold" ? "badge-yellow" : "badge-red"}`}>
              {openAliceState.label}
            </span>
            <span className="tg soft">心跳：{formatAge(openAliceState.updatedAt)}</span>
            <span className="tg soft">待審每日簡報草稿：{pendingBriefDrafts === null ? "無法讀取" : `${pendingBriefDrafts} 筆`}</span>
            <span className="state-reason">{openAliceState.note}</span>
          </div>
        </Panel>
      </section>

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
                <span className={`badge ${sourceBadgeClass(freshness, latest)}`}>{sourceStatusLabel(freshness, latest)}</span>
                <span>盤勢：{marketLabel(latest.marketState)}</span>
                <span>來源：{producerLabel(latest.generatedBy)}</span>
                <span>更新 {formatDateTime(latest.createdAt)}</span>
              </div>
            </div>
            {freshness.state === "STALE" && (
              <div className="terminal-note brief-stale-warning">
                <span className="tg status-bad">過期</span> {freshness.reason}
              </div>
            )}

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
