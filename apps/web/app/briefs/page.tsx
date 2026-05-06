import { PageFrame, Panel } from "@/components/PageFrame";
import { MetricStrip } from "@/components/RadarWidgets";
import { ContentDraftOverrideActions } from "@/components/ContentDraftOverrideActions";
import { getBriefs, getContentDrafts, getOpenAliceJobs, getOpenAliceObservability, getSession, type ContentDraftEntry, type OpenAliceJobEntry, type OpenAliceObservability } from "@/lib/api";
import { friendlyDataError } from "@/lib/friendly-error";
import { briefAgeCopy, briefAgeDays, briefFreshnessBadge, briefFreshnessLabel, briefFreshnessTone, type BriefFreshness } from "@/lib/freshness";
import { cleanExternalHeadline, cleanNarrativeText } from "@/lib/operator-copy";
import type { DailyBrief } from "@iuf-trading-room/contracts";
import Link from "next/link";

export const dynamic = "force-dynamic";

type OpenAliceSurface = "LIVE" | "STALE" | "BLOCKED";

type OpenAliceState =
  | { state: "LIVE"; surface: OpenAliceSurface; data: OpenAliceObservability; updatedAt: string; source: string }
  | { state: "BLOCKED"; surface: "BLOCKED"; data: null; updatedAt: string; source: string; reason: string };

type OpenAliceJobsState =
  | { state: "LIVE"; data: OpenAliceJobEntry[]; updatedAt: string; source: string }
  | { state: "EMPTY"; data: []; updatedAt: string; source: string; reason: string }
  | { state: "BLOCKED"; data: []; updatedAt: string; source: string; reason: string };

type DailyBriefDraftsState =
  | { state: "LIVE"; data: ContentDraftEntry[]; updatedAt: string; source: string }
  | { state: "EMPTY"; data: []; updatedAt: string; source: string; reason: string }
  | { state: "BLOCKED"; data: []; updatedAt: string; source: string; reason: string };

type DailyBriefSurfaceState =
  | { state: "PUBLISHED"; today: string; brief: DailyBrief; latest: DailyBrief | null; drafts: ContentDraftEntry[] }
  | { state: "AWAITING_REVIEW"; today: string; latest: DailyBrief | null; drafts: ContentDraftEntry[] }
  | { state: "MISSING"; today: string; latest: DailyBrief | null; drafts: ContentDraftEntry[] }
  | { state: "ERROR"; today: string; latest: DailyBrief | null; drafts: ContentDraftEntry[]; reason: string };

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

function todayTaipeiDate() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
}

function loadBriefDate(brief: DailyBrief) {
  return brief.date.slice(0, 10);
}

function draftTargetDate(draft: ContentDraftEntry) {
  const payload = asRecord(draft.payload);
  return stringField(payload, "date")
    ?? stringField(payload, "targetDate")
    ?? draft.targetEntityId
    ?? null;
}

function isTodayDailyBriefDraft(draft: ContentDraftEntry, today: string) {
  return draft.targetTable === "daily_briefs" && draftTargetDate(draft)?.slice(0, 10) === today;
}

function buildDailyBriefSurface(
  params: {
    today: string;
    briefs: DailyBrief[];
    drafts: ContentDraftEntry[];
    error: string | null;
  }
): DailyBriefSurfaceState {
  const latest = params.briefs[0] ?? null;
  const todayBrief = params.briefs.find((brief) => loadBriefDate(brief) === params.today && brief.status === "published") ?? null;
  const todayDrafts = params.drafts.filter((draft) => isTodayDailyBriefDraft(draft, params.today));

  if (params.error) {
    return { state: "ERROR", today: params.today, latest, drafts: todayDrafts, reason: params.error };
  }
  if (todayBrief) {
    return { state: "PUBLISHED", today: params.today, brief: todayBrief, latest, drafts: todayDrafts };
  }
  if (todayDrafts.length > 0) {
    return { state: "AWAITING_REVIEW", today: params.today, latest, drafts: todayDrafts };
  }
  return { state: "MISSING", today: params.today, latest, drafts: todayDrafts };
}

function dailyBriefSurfaceLabel(state: DailyBriefSurfaceState["state"]) {
  if (state === "PUBLISHED") return "今日已發布";
  if (state === "AWAITING_REVIEW") return "AI 審核中";
  if (state === "MISSING") return "尚未生成";
  return "讀取錯誤";
}

function dailyBriefSurfaceBadge(state: DailyBriefSurfaceState["state"]) {
  if (state === "PUBLISHED") return "badge-green";
  if (state === "AWAITING_REVIEW") return "badge-yellow";
  if (state === "MISSING") return "badge-yellow";
  return "badge-red";
}

function dailyBriefSurfaceTone(state: DailyBriefSurfaceState["state"]) {
  if (state === "PUBLISHED") return "status-ok";
  if (state === "ERROR") return "status-bad";
  return "gold";
}

const ADVICE_PATTERNS = [
  /強烈買進/g,
  /建議買進/g,
  /買進/g,
  /賣出/g,
  /目標價/g,
  /必賺/g,
  /保證獲利/g,
  /all\s*in/gi,
];

function maskInvestmentAdvice(text: string) {
  return ADVICE_PATTERNS.reduce((next, pattern) => next.replace(pattern, "【已遮蔽投資建議字眼】"), text);
}

function hasInvestmentAdvice(text: string) {
  return ADVICE_PATTERNS.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(text);
  });
}

function sortBriefs(briefs: DailyBrief[]) {
  return [...briefs].sort((a, b) => {
    const bTime = Date.parse(b.createdAt);
    const aTime = Date.parse(a.createdAt);
    return bTime - aTime;
  });
}

function sortJobs(jobs: OpenAliceJobEntry[]) {
  return [...jobs].sort((a, b) => Date.parse(jobTime(b)) - Date.parse(jobTime(a)));
}

function jobTime(job: OpenAliceJobEntry) {
  return job.completedAt ?? job.claimedAt ?? job.createdAt;
}

function draftTime(draft: ContentDraftEntry) {
  return draft.updatedAt ?? draft.createdAt;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringField(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
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

function jobStatusLabel(value: string | null | undefined) {
  if (value === "queued") return "排隊";
  if (value === "running") return "執行中";
  if (value === "draft_ready") return "草稿待審";
  if (value === "validation_failed") return "驗證失敗";
  if (value === "failed") return "失敗";
  if (value === "published") return "已發布";
  if (value === "rejected") return "已退回";
  return value ?? "--";
}

function jobStatusBadge(value: string | null | undefined) {
  if (value === "published" || value === "draft_ready") return "badge-green";
  if (value === "queued" || value === "running") return "badge-yellow";
  return "badge-red";
}

function taskTypeLabel(value: string | null | undefined) {
  if (value === "daily_brief" || value === "daily-brief") return "每日簡報";
  if (value === "theme_summary") return "主題摘要";
  if (value === "company_note") return "公司筆記";
  if (value === "signal_cluster") return "訊號彙整";
  return value ?? "--";
}

function draftTitle(draft: ContentDraftEntry) {
  const payload = asRecord(draft.payload);
  return stringField(payload, "date")
    ?? stringField(payload, "title")
    ?? stringField(payload, "heading")
    ?? "每日簡報草稿";
}

function draftStatusLabel(value: string | null | undefined) {
  if (value === "awaiting_review") return "待審";
  if (value === "approved") return "已核准";
  if (value === "rejected") return "已退回";
  return value ?? "--";
}

function draftStatusBadge(value: string | null | undefined) {
  if (value === "approved") return "badge-green";
  if (value === "rejected") return "badge-red";
  return "badge-yellow";
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

async function loadOpenAliceJobs(): Promise<OpenAliceJobsState> {
  const updatedAt = new Date().toISOString();
  try {
    const response = await getOpenAliceJobs();
    const jobs = sortJobs(response.data ?? []).slice(0, 6);
    if (jobs.length === 0) {
      return {
        state: "EMPTY",
        data: [],
        updatedAt,
        source: "OpenAlice job queue",
        reason: "目前沒有可顯示的 OpenAlice 任務紀錄。",
      };
    }
    return {
      state: "LIVE",
      data: jobs,
      updatedAt,
      source: "OpenAlice job queue",
    };
  } catch (error) {
    return {
      state: "BLOCKED",
      data: [],
      updatedAt,
      source: "OpenAlice job queue",
      reason: friendlyDataError(error, "OpenAlice 任務佇列暫時無法讀取。"),
    };
  }
}

async function loadDailyBriefDrafts(): Promise<DailyBriefDraftsState> {
  const updatedAt = new Date().toISOString();
  try {
    const response = await getContentDrafts({ status: "awaiting_review", limit: 100 });
    const drafts = (response.data ?? [])
      .filter((draft) => draft.targetTable === "daily_briefs")
      .sort((a, b) => Date.parse(draftTime(b)) - Date.parse(draftTime(a)))
      .slice(0, 20);
    if (drafts.length === 0) {
      return {
        state: "EMPTY",
        data: [],
        updatedAt,
        source: "content_drafts",
        reason: "目前沒有待審的每日簡報草稿。",
      };
    }
    return {
      state: "LIVE",
      data: drafts,
      updatedAt,
      source: "content_drafts",
    };
  } catch (error) {
    return {
      state: "BLOCKED",
      data: [],
      updatedAt,
      source: "content_drafts",
      reason: friendlyDataError(error, "每日簡報草稿佇列暫時無法讀取。"),
    };
  }
}

async function loadCanOwnerOverride() {
  try {
    const session = await getSession();
    return session.data.user.role === "Owner";
  } catch {
    return false;
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

function pipelineStatusLabel(pipeline: OpenAliceObservability["pipeline"] | undefined) {
  if (!pipeline) return "未回傳";
  if (pipeline.lastFailureReason) return "錯誤";
  if (pipeline.lastPublishedAt) return "已發布";
  if (pipeline.reviewerVerdict === "approve") return "AI 通過";
  if (pipeline.reviewerVerdict === "manual_review") return "待人工";
  if (pipeline.reviewerVerdict === "reject") return "已退回";
  if (pipeline.lastGeneratedAt) return "待 AI 審核";
  return "待產生";
}

function pipelineStatusBadge(pipeline: OpenAliceObservability["pipeline"] | undefined) {
  if (!pipeline) return "badge-yellow";
  if (pipeline.lastFailureReason || pipeline.reviewerVerdict === "reject") return "badge-red";
  if (pipeline.lastPublishedAt || pipeline.reviewerVerdict === "approve") return "badge-green";
  return "badge-yellow";
}

function pipelineTime(value: string | null | undefined) {
  return value ? formatDateTime(value) : "--";
}

function reviewerVerdictLabel(value: NonNullable<OpenAliceObservability["pipeline"]>["reviewerVerdict"] | undefined) {
  if (value === "approve") return "AI 通過";
  if (value === "manual_review") return "待人工";
  if (value === "reject") return "已退回";
  return "--";
}

function statusText(value: string | null | undefined) {
  if (value === "LIVE") return "正常";
  if (value === "EMPTY") return "無資料";
  if (value === "BLOCKED") return "暫停";
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

function OpenAliceJobsPanel({ jobs }: { jobs: OpenAliceJobsState }) {
  return (
    <Panel code="BRF-JOBS" title="OpenAlice 最近任務" sub="只讀佇列 / 協助判斷為何簡報未更新" right={statusText(jobs.state)}>
      <div className="brief-job-panel">
        <div className="source-line">
          <StateBadge state={jobs.state} />
          <span>來源：{jobs.source}</span>
          <span>檢查：{formatDateTime(jobs.updatedAt)}</span>
          <span>{jobs.state === "LIVE" ? `${jobs.data.length} 筆` : jobs.reason}</span>
        </div>
        {jobs.state === "LIVE" && (
          <div className="brief-job-list">
            {jobs.data.map((job) => (
              <div className="brief-job-row" key={job.id}>
                <span className="tg gold">{taskTypeLabel(job.taskType)}</span>
                <span className={`badge ${jobStatusBadge(job.status)}`}>{jobStatusLabel(job.status)}</span>
                <span className="tg soft">建立 {formatDateTime(job.createdAt)}</span>
                <span className="tg soft">更新 {formatDateTime(jobTime(job))}</span>
                <span className="tg soft">嘗試 {job.attemptCount ?? 0}/{job.maxAttempts ?? "--"}</span>
                {job.error && <span className="status-bad">{job.error}</span>}
              </div>
            ))}
          </div>
        )}
        <span className="state-reason">
          這裡只揭露產文管線狀態；若正式簡報仍停在舊日期，必須由 OpenAlice / daily brief pipeline 寫入新的正式 row。
        </span>
      </div>
    </Panel>
  );
}

function StateBadge({ state }: { state: OpenAliceJobsState["state"] }) {
  const klass = state === "LIVE" ? "badge-green" : state === "EMPTY" ? "badge-yellow" : "badge-red";
  return <span className={`badge ${klass}`}>{statusText(state)}</span>;
}

function DailyBriefDraftGate({ drafts }: { drafts: DailyBriefDraftsState }) {
  return (
    <Panel
      code="BRF-DRAFT"
      title="每日簡報草稿閘門"
      sub="OpenAlice 產出後，正式簡報前的審核狀態"
      right={drafts.state === "LIVE" ? `${drafts.data.length} 筆待審` : statusText(drafts.state)}
    >
      <div className="brief-draft-gate">
        <div className="source-line">
          <StateBadge state={drafts.state} />
          <span>來源：{drafts.source}</span>
          <span>檢查：{formatDateTime(drafts.updatedAt)}</span>
          <span>{drafts.state === "LIVE" ? "草稿尚未核准成正式每日簡報。" : drafts.reason}</span>
        </div>
        {drafts.state === "LIVE" && (
          <div className="brief-job-list">
            {drafts.data.map((draft) => (
              <div className="brief-job-row draft" key={draft.id}>
                <span className="tg gold">{draftTitle(draft)}</span>
                <span className={`badge ${draftStatusBadge(draft.status)}`}>{draftStatusLabel(draft.status)}</span>
                <span className="tg soft">建立 {formatDateTime(draft.createdAt)}</span>
                <span className="tg soft">更新 {formatDateTime(draft.updatedAt)}</span>
                <span className="tg soft">來源 job {draft.sourceJobId?.slice(0, 8) ?? "--"}</span>
              </div>
            ))}
          </div>
        )}
        <div className="brief-draft-actions">
          <span className="state-reason">
            這裡只揭露卡點；是否核准草稿仍是人工審核流程，前端不會自動發布每日簡報。
          </span>
          <Link className="mini-button" href="/admin/content-drafts?status=awaiting_review">
            開啟審稿佇列
          </Link>
        </div>
      </div>
    </Panel>
  );
}

function DailyBriefThreeStatePanel({
  surface,
  canOwnerOverride,
}: {
  surface: DailyBriefSurfaceState;
  canOwnerOverride: boolean;
}) {
  const latestDate = surface.latest?.date ?? "--";
  const latestCopy = surface.latest ? `${surface.latest.date} / ${briefAgeCopy(briefAgeDays(surface.latest.date))}` : "尚無正式簡報";
  const reason =
    surface.state === "PUBLISHED"
      ? "今日正式簡報已發布；頁面顯示資料庫 row，不重寫內容。"
      : surface.state === "AWAITING_REVIEW"
        ? "今日簡報已生成，正在 AI reviewer / Owner fallback 審核佇列中；這不是錯誤，也不標示成今日正式資料。"
        : surface.state === "MISSING"
          ? "今天尚未看到正式簡報或待審草稿；顯示缺口，不用舊資料假裝今日內容。"
          : `每日簡報讀取錯誤：${surface.reason}`;

  return (
    <Panel
      code="BRF-STATE"
      title="今日簡報狀態"
      sub="PUBLISHED / AWAITING_REVIEW / MISSING / ERROR"
      right={dailyBriefSurfaceLabel(surface.state)}
    >
      <div className={`brief-three-state ${surface.state.toLowerCase()}`}>
        <span className={`badge ${dailyBriefSurfaceBadge(surface.state)}`}>
          {dailyBriefSurfaceLabel(surface.state)}
        </span>
        <span className="tg soft">目標日期：{surface.today}</span>
        <span className="tg soft">最新正式資料：{latestCopy}</span>
        <span className="state-reason">{reason}</span>
        {surface.state === "AWAITING_REVIEW" && (
          <div className="brief-today-drafts">
            {surface.drafts.map((draft) => (
              <div className="brief-today-draft" key={draft.id}>
                <div>
                  <span className="tg gold">待審草稿</span>
                  <strong>{draftTitle(draft)}</strong>
                  <small>
                    來源 job {draft.sourceJobId?.slice(0, 8) ?? "--"} / 產生者 {draft.producerVersion} / 更新 {formatDateTime(draft.updatedAt)}
                  </small>
                </div>
                <Link className="outline-button" href={`/admin/content-drafts/${draft.id}`}>
                  查看來源
                </Link>
                {canOwnerOverride && <ContentDraftOverrideActions draftId={draft.id} />}
              </div>
            ))}
          </div>
        )}
        {surface.state === "MISSING" && (
          <div className="brief-source-trail">
            <span>OpenAlice 若已產文，應在 content_drafts 出現 today's daily_briefs draft。</span>
            <span>若 AI reviewer 已通過，應在 /api/v1/briefs 出現今日 published row。</span>
            <span>目前最新正式資料日：{latestDate}。</span>
          </div>
        )}
      </div>
    </Panel>
  );
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
  const today = todayTaipeiDate();
  const [openAlice, openAliceJobs, dailyBriefDrafts, canOwnerOverride] = await Promise.all([
    loadOpenAliceStatus(),
    loadOpenAliceJobs(),
    loadDailyBriefDrafts(),
    loadCanOwnerOverride(),
  ]);

  try {
    const response = await getBriefs();
    briefs = sortBriefs(response.data ?? []);
  } catch (err) {
    error = friendlyDataError(err, "每日簡報暫時無法讀取。");
  }

  const latest = briefs[0] ?? null;
  const publishedCount = briefs.filter((brief) => brief.status === "published").length;
  const draftCount = briefs.filter((brief) => brief.status === "draft").length;
  const surface = buildDailyBriefSurface({ today, briefs, drafts: dailyBriefDrafts.data, error });
  const displayBrief = surface.state === "PUBLISHED" ? surface.brief : null;
  const totalSections = displayBrief?.sections.length ?? 0;
  const latestAgeDays = latest ? briefAgeDays(latest.date) : null;
  const historyFreshness: BriefFreshness = error ? "BLOCKED" : latest ? (latestAgeDays === 0 ? "LIVE" : "STALE") : "EMPTY";

  return (
    <PageFrame
      code="BRF"
      title="每日簡報"
      sub="台股盤前 / 盤後摘要"
      note="每日簡報 / 真實資料；先建立資料框架，後續再接 OpenAlice 自動產文，不顯示假新聞或假建議。"
    >
      <MetricStrip
        columns={8}
        cells={[
          { label: "今日狀態", value: dailyBriefSurfaceLabel(surface.state), tone: dailyBriefSurfaceTone(surface.state) },
          { label: "簡報數", value: briefs.length },
          { label: "已發布", value: publishedCount, tone: publishedCount > 0 ? "status-ok" : "muted" },
          { label: "草稿", value: draftCount, tone: draftCount > 0 ? "gold" : "muted" },
          { label: "今日段落", value: displayBrief ? totalSections : "--" },
          { label: "最新正式", value: latest ? `${latest.date} / ${briefAgeCopy(latestAgeDays)}` : "--", tone: historyFreshness === "STALE" ? "gold" : undefined },
          { label: "AI 產文", value: openAliceLabel(openAlice.surface), tone: openAliceTone(openAlice.surface) },
          { label: "任務", value: openAliceJobs.state === "LIVE" ? openAliceJobs.data.length : statusText(openAliceJobs.state), tone: openAliceJobs.state === "LIVE" ? "status-ok" : openAliceJobs.state === "EMPTY" ? "gold" : "status-bad" },
        ]}
      />

      <DailyBriefThreeStatePanel surface={surface} canOwnerOverride={canOwnerOverride} />

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
          <strong className={dailyBriefSurfaceTone(surface.state)}>
            {dailyBriefSurfaceLabel(surface.state)}
          </strong>
          <p>
            {surface.state === "PUBLISHED"
              ? `今日簡報 ${surface.brief.date} 已發布，共 ${surface.brief.sections.length} 段；來源為正式每日簡報資料庫。`
              : surface.state === "AWAITING_REVIEW"
                ? `今日草稿 ${surface.drafts.length} 筆正在審核，不把舊簡報誤標成今日內容。`
                : latest
                  ? `最新正式簡報仍停在 ${latest.date}（${briefAgeCopy(latestAgeDays)}），前端只揭露狀態。`
                  : "尚未取得正式簡報資料，先顯示接線規格。"}
          </p>
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
            <>
              <span className={`badge ${pipelineStatusBadge(openAlice.data.pipeline)}`}>
                管線：{pipelineStatusLabel(openAlice.data.pipeline)}
              </span>
              <div className="brief-openalice-grid">
                <span>worker：<strong>{statusText(openAlice.data.workerStatus)}</strong></span>
                <span>sweep：<strong>{statusText(openAlice.data.sweepStatus)}</strong></span>
                <span>最後心跳：<strong>{ageText(openAlice.data.workerHeartbeatAgeSeconds)}</strong></span>
                <span>最後掃描：<strong>{ageText(openAlice.data.lastSweepAgeSeconds)}</strong></span>
                <span>排隊：<strong>{openAlice.data.metrics.queuedJobs}</strong></span>
                <span>執行中：<strong>{openAlice.data.metrics.runningJobs}</strong></span>
                <span>過期執行：<strong>{openAlice.data.metrics.staleRunningJobs}</strong></span>
                <span>裝置：<strong>{openAlice.data.metrics.activeDevices}</strong></span>
                <span>最近產文：<strong>{pipelineTime(openAlice.data.pipeline?.lastGeneratedAt)}</strong></span>
                <span>最近審核：<strong>{pipelineTime(openAlice.data.pipeline?.lastReviewedAt)}</strong></span>
                <span>最近發布：<strong>{pipelineTime(openAlice.data.pipeline?.lastPublishedAt)}</strong></span>
                <span>下次排程：<strong>{pipelineTime(openAlice.data.pipeline?.nextRunAt)}</strong></span>
                <span>來源包：<strong>{openAlice.data.pipeline?.sourcePackCount ?? "--"}</strong></span>
                <span>AI 判定：<strong>{reviewerVerdictLabel(openAlice.data.pipeline?.reviewerVerdict)}</strong></span>
                <span>最近錯誤：<strong>{openAlice.data.pipeline?.lastFailureReason ?? "--"}</strong></span>
              </div>
            </>
          )}
          <span className="state-reason">
            此面板只揭露 OpenAlice 是否有新產文能力；不把舊簡報改寫成新簡報，也不產生買賣建議。
          </span>
        </div>
      </Panel>

      <OpenAliceJobsPanel jobs={openAliceJobs} />

      <DailyBriefDraftGate drafts={dailyBriefDrafts} />

      {surface.state !== "PUBLISHED" && (
        <div className="brief-empty-grid">
          {surface.state === "ERROR" ? (
            <BriefStatePanel
              state="BLOCKED"
              reason={`簡報資料暫時無法讀取。負責：內容與後端資料管線。${surface.reason}`}
              updatedAt={requestedAt}
            />
          ) : (
            <BriefStatePanel
              state="EMPTY"
              reason={
                surface.state === "AWAITING_REVIEW"
                  ? "今日簡報草稿已生成但尚未審核通過；不把草稿或舊資料顯示成正式簡報。"
                  : "今天尚未生成正式每日簡報；不顯示假簡報。"
              }
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

      {surface.state === "PUBLISHED" && displayBrief && (
        <>
          <section className="daily-brief-sheet">
            <div className="daily-brief-head">
              <div>
                <span className="tg panel-code">每日簡報</span>
                <h2>{displayBrief.date}</h2>
                <p>台股操作摘要 / 正式資料庫</p>
              </div>
              <div className="daily-brief-meta">
                <span className={`badge ${briefFreshnessBadge("LIVE")}`}>{briefFreshnessLabel("LIVE")}</span>
                <span>資料日：{displayBrief.date}（今日）</span>
                <span>盤勢：{marketLabel(displayBrief.marketState)}</span>
                <span>來源：每日簡報資料庫</span>
                <span>更新 {formatDateTime(displayBrief.createdAt)}</span>
              </div>
            </div>

            <div className="daily-brief-body">
              {displayBrief.sections.map((section) => {
                const heading = cleanExternalHeadline(section.heading, "日報段落");
                const body = cleanNarrativeText(section.body, "段落尚未完成中文整理；保留來源紀錄。");
                const safeBody = maskInvestmentAdvice(body);
                const warning = hasInvestmentAdvice(`${heading}\n${body}`);
                return (
                <article className="brief-section" key={`${displayBrief.id}-${section.heading}`}>
                  <h2>{cleanExternalHeadline(section.heading, "日報段落")}</h2>
                  {warning && <span className="badge badge-yellow">已遮蔽疑似投資建議字眼</span>}
                  <p>{safeBody}</p>
                  <div className="brief-source-trail compact">
                    <span>source: daily_briefs</span>
                    <span>row: {displayBrief.id.slice(0, 8)}</span>
                    <span>generatedBy: {producerLabel(displayBrief.generatedBy)}</span>
                  </div>
                </article>
              );})}
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
