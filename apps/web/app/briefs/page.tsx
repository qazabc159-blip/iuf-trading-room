import Link from "next/link";

import { ContentDraftOverrideActions } from "@/components/ContentDraftOverrideActions";
import { PageFrame, Panel } from "@/components/PageFrame";
import { MetricStrip } from "@/components/RadarWidgets";
import {
  getBriefs,
  getContentDrafts,
  getOpenAliceDispatcherDebug,
  getOpenAliceJobs,
  getOpenAliceObservability,
  getSession,
  type ContentDraftEntry,
  type OpenAliceDispatcherDebug,
  type OpenAliceJobEntry,
  type OpenAliceObservability,
} from "@/lib/api";
import { contentDraftSections, contentDraftTitle } from "@/lib/content-draft-view";
import { friendlyDataError } from "@/lib/friendly-error";
import { briefAgeCopy, briefAgeDays, type BriefFreshness } from "@/lib/freshness";
import { cleanExternalHeadline, cleanNarrativeText } from "@/lib/operator-copy";
import type { DailyBrief } from "@iuf-trading-room/contracts";

export const dynamic = "force-dynamic";

type LoadState<T> =
  | { state: "LIVE"; data: T; updatedAt: string; source: string }
  | { state: "EMPTY"; data: T; updatedAt: string; source: string; reason: string }
  | { state: "BLOCKED"; data: T; updatedAt: string; source: string; reason: string };

type DailyBriefSurface =
  | { state: "PUBLISHED"; today: string; brief: DailyBrief; latest: DailyBrief | null; drafts: ContentDraftEntry[] }
  | { state: "AWAITING_REVIEW"; today: string; latest: DailyBrief | null; drafts: ContentDraftEntry[] }
  | { state: "MISSING"; today: string; latest: DailyBrief | null; drafts: ContentDraftEntry[] }
  | { state: "BLOCKED"; today: string; latest: DailyBrief | null; drafts: ContentDraftEntry[]; reason: string };

type OpenAliceSurface = "LIVE" | "STALE" | "BLOCKED";

function nowIso() {
  return new Date().toISOString();
}

function todayTaipeiDate() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatCount(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("zh-TW") : "--";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringField(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
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

function sortBriefs(briefs: DailyBrief[]) {
  return [...briefs].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

function jobTime(job: OpenAliceJobEntry) {
  return job.completedAt ?? job.claimedAt ?? job.createdAt;
}

function sortJobs(jobs: OpenAliceJobEntry[]) {
  return [...jobs].sort((a, b) => Date.parse(jobTime(b)) - Date.parse(jobTime(a)));
}

function draftTime(draft: ContentDraftEntry) {
  return draft.updatedAt ?? draft.createdAt;
}

function buildSurface(params: {
  today: string;
  briefs: DailyBrief[];
  drafts: ContentDraftEntry[];
  error: string | null;
}): DailyBriefSurface {
  const latest = params.briefs[0] ?? null;
  const todayBrief = params.briefs.find((brief) => brief.date.slice(0, 10) === params.today && brief.status === "published") ?? null;
  const todayDrafts = params.drafts.filter((draft) => isTodayDailyBriefDraft(draft, params.today));

  if (params.error) {
    return { state: "BLOCKED", today: params.today, latest, drafts: todayDrafts, reason: params.error };
  }
  if (todayBrief) {
    return { state: "PUBLISHED", today: params.today, brief: todayBrief, latest, drafts: todayDrafts };
  }
  if (todayDrafts.length > 0) {
    return { state: "AWAITING_REVIEW", today: params.today, latest, drafts: todayDrafts };
  }
  return { state: "MISSING", today: params.today, latest, drafts: todayDrafts };
}

function surfaceLabel(state: DailyBriefSurface["state"]) {
  if (state === "PUBLISHED") return "今日已發布";
  if (state === "AWAITING_REVIEW") return "草稿待審";
  if (state === "MISSING") return "今日缺稿";
  return "讀取受阻";
}

function surfaceTone(state: DailyBriefSurface["state"]) {
  if (state === "PUBLISHED") return "status-ok";
  if (state === "BLOCKED") return "status-bad";
  return "gold";
}

function surfaceBadge(state: DailyBriefSurface["state"]) {
  if (state === "PUBLISHED") return "badge-green";
  if (state === "BLOCKED") return "badge-red";
  return "badge-yellow";
}

function jobStatusLabel(value: string | null | undefined) {
  if (value === "queued") return "排隊";
  if (value === "running") return "執行中";
  if (value === "draft_ready") return "草稿完成";
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
  if (value === "company_note") return "公司備註";
  if (value === "signal_cluster") return "訊號整理";
  return value ?? "--";
}

function openAliceSurface(data: OpenAliceObservability | null): OpenAliceSurface {
  if (!data) return "BLOCKED";
  if (data.workerStatus === "healthy" && data.sweepStatus === "healthy") return "LIVE";
  if (data.workerStatus === "missing" && data.sweepStatus === "missing") return "BLOCKED";
  return "STALE";
}

function surfaceStateLabel(state: OpenAliceSurface) {
  if (state === "LIVE") return "正常";
  if (state === "STALE") return "過期";
  return "受阻";
}

function surfaceStateTone(state: OpenAliceSurface) {
  if (state === "LIVE") return "status-ok";
  if (state === "STALE") return "gold";
  return "status-bad";
}

function pipelineStatusLabel(pipeline: OpenAliceObservability["pipeline"] | undefined) {
  if (!pipeline) return "未回傳";
  if (pipeline.lastFailureReason) return "最近失敗";
  if (pipeline.lastPublishedAt) return "已發布";
  if (pipeline.reviewerVerdict === "approve") return "AI 已核准";
  if (pipeline.reviewerVerdict === "manual_review") return "人工待審";
  if (pipeline.reviewerVerdict === "reject") return "AI 退回";
  if (pipeline.lastGeneratedAt) return "已產生草稿";
  return "待產生";
}

function pipelineStatusBadge(pipeline: OpenAliceObservability["pipeline"] | undefined) {
  if (!pipeline) return "badge-yellow";
  if (pipeline.lastFailureReason || pipeline.reviewerVerdict === "reject") return "badge-red";
  if (pipeline.lastPublishedAt || pipeline.reviewerVerdict === "approve") return "badge-green";
  return "badge-yellow";
}

function reviewerVerdictLabel(value: NonNullable<OpenAliceObservability["pipeline"]>["reviewerVerdict"] | undefined) {
  if (value === "approve") return "核准";
  if (value === "manual_review") return "人工待審";
  if (value === "reject") return "退回";
  return "--";
}

function dispatcherResultLabel(value: OpenAliceDispatcherDebug["lastTickResult"]) {
  if (value === "enqueued") return "已派工";
  if (value === "skipped_existing_job") return "已有今日工作";
  if (value === "skipped_existing_brief") return "今日已發布";
  if (value === "no_workspace") return "找不到工作區";
  if (value === "no_db") return "資料庫未連線";
  if (value === "enqueue_failed") return "派工失敗";
  return "尚未掃描";
}

function dispatcherResultTone(value: OpenAliceDispatcherDebug["lastTickResult"]) {
  if (value === "enqueued" || value === "skipped_existing_brief") return "status-ok";
  if (value === "skipped_existing_job") return "gold";
  if (value === "enqueue_failed" || value === "no_workspace" || value === "no_db") return "status-bad";
  return "muted";
}

function dispatcherNextStep(debug: OpenAliceDispatcherDebug | null) {
  if (!debug) return "無法讀取派工狀態，先看 OpenAlice jobs 與待審草稿。";
  if (debug.lastTickResult === "enqueued") return "今日工作已建立；下一站是 runner claim、產生草稿與 reviewer verdict。";
  if (debug.lastTickResult === "skipped_existing_job") return "今日已有 queued job；若長時間沒有草稿，卡點在 runner claim/result 或 reviewer。";
  if (debug.lastTickResult === "skipped_existing_brief") return "今日正式簡報已存在；檢查下方正式內容與 source trail。";
  if (debug.lastTickResult === "no_workspace") return "派工器找不到工作區；需要 Jason 檢查 workspace seed / DB。";
  if (debug.lastTickResult === "no_db") return "派工器沒有 DB 連線；需要 Jason 檢查 production DATABASE_URL / worker DB。";
  if (debug.lastTickResult === "enqueue_failed") return "派工器 enqueue 失敗；錯誤如下，後端需要修 enqueue/schema。";
  return "派工器尚未留下 tick；確認 API deploy 是否啟動 scheduler。";
}

function ageText(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "--";
  if (seconds < 60) return `${Math.round(seconds)} 秒`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} 分鐘`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} 小時`;
  return `${Math.round(seconds / 86400)} 天`;
}

function maskUnsafeAdviceText(text: string) {
  const patterns = [
    new RegExp("\\u8cb7\\u9032", "g"),
    new RegExp("\\u8ce3\\u51fa", "g"),
    new RegExp("\\u76ee\\u6a19\\u50f9", "g"),
    new RegExp("\\u5fc5\\u8cfa", "g"),
    new RegExp("\\u4fdd\\u8b49", "g"),
    new RegExp("\\u52dd\\u7387", "g"),
  ];
  return patterns.reduce((next, pattern) => next.replace(pattern, "已遮蔽的投資建議字詞"), text);
}

function safeBriefText(text: string) {
  return maskUnsafeAdviceText(cleanNarrativeText(text));
}

async function loadBriefsData(): Promise<{ briefs: DailyBrief[]; error: string | null; updatedAt: string }> {
  const updatedAt = nowIso();
  try {
    const response = await getBriefs();
    return { briefs: sortBriefs(response.data ?? []), error: null, updatedAt };
  } catch (error) {
    return { briefs: [], error: friendlyDataError(error, "每日簡報資料讀取失敗。"), updatedAt };
  }
}

async function loadDrafts(): Promise<LoadState<ContentDraftEntry[]>> {
  const updatedAt = nowIso();
  try {
    const response = await getContentDrafts({ status: "awaiting_review", limit: 100 });
    const drafts = (response.data ?? [])
      .filter((draft) => draft.targetTable === "daily_briefs")
      .sort((a, b) => Date.parse(draftTime(b)) - Date.parse(draftTime(a)))
      .slice(0, 20);
    if (drafts.length === 0) {
      return { state: "EMPTY", data: [], updatedAt, source: "content_drafts", reason: "目前沒有待審的每日簡報草稿。" };
    }
    return { state: "LIVE", data: drafts, updatedAt, source: "content_drafts" };
  } catch (error) {
    return { state: "BLOCKED", data: [], updatedAt, source: "content_drafts", reason: friendlyDataError(error, "草稿佇列讀取失敗。") };
  }
}

async function loadJobs(): Promise<LoadState<OpenAliceJobEntry[]>> {
  const updatedAt = nowIso();
  try {
    const response = await getOpenAliceJobs();
    const jobs = sortJobs(response.data ?? []).slice(0, 8);
    if (jobs.length === 0) {
      return { state: "EMPTY", data: [], updatedAt, source: "OpenAlice jobs", reason: "目前沒有 OpenAlice 工作紀錄。" };
    }
    return { state: "LIVE", data: jobs, updatedAt, source: "OpenAlice jobs" };
  } catch (error) {
    return { state: "BLOCKED", data: [], updatedAt, source: "OpenAlice jobs", reason: friendlyDataError(error, "OpenAlice 工作佇列讀取失敗。") };
  }
}

async function loadOpenAlice(): Promise<LoadState<OpenAliceObservability | null>> {
  const updatedAt = nowIso();
  try {
    const response = await getOpenAliceObservability();
    return { state: "LIVE", data: response.data, updatedAt, source: response.data.source === "redis" ? "OpenAlice Redis" : "OpenAlice fallback" };
  } catch (error) {
    return { state: "BLOCKED", data: null, updatedAt, source: "OpenAlice observability", reason: friendlyDataError(error, "OpenAlice 狀態讀取失敗。") };
  }
}

async function loadDispatcherDebug(): Promise<LoadState<OpenAliceDispatcherDebug | null>> {
  const updatedAt = nowIso();
  try {
    const response = await getOpenAliceDispatcherDebug();
    return { state: "LIVE", data: response.data, updatedAt, source: "OpenAlice dispatcher debug" };
  } catch (error) {
    return { state: "BLOCKED", data: null, updatedAt, source: "OpenAlice dispatcher debug", reason: friendlyDataError(error, "每日簡報派工診斷讀取失敗。") };
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

function SourceLine<T>({ state, label }: { state: LoadState<T>; label: string }) {
  const tone = state.state === "LIVE" ? "badge-green" : state.state === "EMPTY" ? "badge-yellow" : "badge-red";
  return (
    <div className="source-line">
      <span className={`badge ${tone}`}>{state.state === "LIVE" ? "正常" : state.state === "EMPTY" ? "無資料" : "受阻"}</span>
      <span>來源：{state.source}</span>
      <span>更新：{formatDateTime(state.updatedAt)}</span>
      <span>{label}</span>
      {"reason" in state && <span className="state-reason">{state.reason}</span>}
    </div>
  );
}

function OpenAlicePanel({ openAlice }: { openAlice: LoadState<OpenAliceObservability | null> }) {
  const surface = openAlice.state === "LIVE" ? openAliceSurface(openAlice.data) : "BLOCKED";
  const data = openAlice.data;
  return (
    <Panel code="BRF-AI" title="OpenAlice 自動化狀態" sub="runner / dispatcher / reviewer / publish" right={surfaceStateLabel(surface)}>
      <SourceLine state={openAlice} label="每日簡報主腦狀態" />
      <MetricStrip
        columns={4}
        cells={[
          { label: "Runner", value: data?.workerStatus ?? "--", tone: data?.workerStatus === "healthy" ? "status-ok" : "status-bad" },
          { label: "Dispatcher", value: data?.sweepStatus ?? "--", tone: data?.sweepStatus === "healthy" ? "status-ok" : "status-bad" },
          { label: "Queue", value: formatCount(data?.metrics.queuedJobs), tone: data?.metrics.queuedJobs ? "gold" : "muted" },
          { label: "狀態", value: surfaceStateLabel(surface), tone: surfaceStateTone(surface) },
        ]}
      />
      {data && (
        <div className="brief-openalice-grid">
          <span>Worker 心跳 <strong>{ageText(data.workerHeartbeatAgeSeconds)}</strong></span>
          <span>Dispatcher 掃描 <strong>{ageText(data.lastSweepAgeSeconds)}</strong></span>
          <span>最後產文 <strong>{formatDateTime(data.pipeline?.lastGeneratedAt)}</strong></span>
          <span>最後審核 <strong>{formatDateTime(data.pipeline?.lastReviewedAt)}</strong></span>
          <span>最後發布 <strong>{formatDateTime(data.pipeline?.lastPublishedAt)}</strong></span>
          <span>下次排程 <strong>{formatDateTime(data.pipeline?.nextRunAt)}</strong></span>
          <span>source pack <strong>{data.pipeline?.sourcePackCount ?? "--"}</strong></span>
          <span>AI verdict <strong>{reviewerVerdictLabel(data.pipeline?.reviewerVerdict)}</strong></span>
          <span className={`badge ${pipelineStatusBadge(data.pipeline)}`}>{pipelineStatusLabel(data.pipeline)}</span>
          {data.pipeline?.lastFailureReason && <span className="status-bad">{data.pipeline.lastFailureReason}</span>}
        </div>
      )}
    </Panel>
  );
}

function DispatcherDebugPanel({ dispatcher }: { dispatcher: LoadState<OpenAliceDispatcherDebug | null> }) {
  const debug = dispatcher.data;
  const tone = dispatcher.state === "LIVE" ? dispatcherResultTone(debug?.lastTickResult ?? null) : "status-bad";
  return (
    <Panel code="BRF-DSP" title="每日簡報派工診斷" sub="排程 / 派工 / 下一個卡點" right={dispatcher.state === "LIVE" ? dispatcherResultLabel(debug?.lastTickResult ?? null) : "受阻"}>
      <SourceLine state={dispatcher} label="只讀診斷，不觸發產文或發布" />
      <MetricStrip
        columns={4}
        cells={[
          { label: "最後掃描", value: formatDateTime(debug?.lastTickAt), tone },
          { label: "派工結果", value: dispatcherResultLabel(debug?.lastTickResult ?? null), tone },
          { label: "派工錯誤", value: debug?.lastEnqueueError ? "有錯誤" : "無錯誤", tone: debug?.lastEnqueueError ? "status-bad" : "status-ok" },
          { label: "下一站", value: debug?.lastTickResult === "skipped_existing_job" ? "runner/reviewer" : debug?.lastTickResult === "enqueued" ? "runner" : "scheduler", tone },
        ]}
      />
      <div className="brief-openalice-grid">
        <span>判讀 <strong>{dispatcherNextStep(debug)}</strong></span>
        {debug?.lastEnqueueError && <span className="status-bad">錯誤 {debug.lastEnqueueError}</span>}
        {debug?.lastEnqueueErrorStack && <span className="tg soft">stack 已截斷顯示；不含 token。</span>}
      </div>
    </Panel>
  );
}

function BriefSurfacePanel({ surface, canOwnerOverride }: { surface: DailyBriefSurface; canOwnerOverride: boolean }) {
  const latestCopy = surface.latest ? `${surface.latest.date} / ${briefAgeCopy(briefAgeDays(surface.latest.date))}` : "尚無正式簡報";
  return (
    <Panel code="BRF-STATE" title="今日簡報狀態" sub="published / awaiting review / missing / blocked" right={surfaceLabel(surface.state)}>
      <div className={`brief-three-state ${surface.state.toLowerCase()}`}>
        <span className={`badge ${surfaceBadge(surface.state)}`}>{surfaceLabel(surface.state)}</span>
        <span className="tg soft">日期：{surface.today}</span>
        <span className="tg soft">最新正式：{latestCopy}</span>
        {surface.state === "PUBLISHED" && (
          <p className="state-reason">今日簡報已寫入正式資料表，共 {surface.brief.sections.length} 段。下方只顯示 source-traced 內容，不顯示投資建議。</p>
        )}
        {surface.state === "AWAITING_REVIEW" && (
          <>
            <p className="state-reason">OpenAlice 已產出今日草稿，但尚未通過 AI reviewer / Owner fallback；首頁不會把草稿當正式簡報。</p>
            <div className="brief-today-drafts">
              {surface.drafts.map((draft) => (
                <div className="brief-today-draft" key={draft.id}>
                  <div>
                    <span className="tg gold">待審草稿</span>
                    <strong>{contentDraftTitle(draft)}</strong>
                    <small>job {draft.sourceJobId?.slice(0, 8) ?? "--"} / producer {draft.producerVersion} / 更新 {formatDateTime(draft.updatedAt)}</small>
                  </div>
                  <Link className="outline-button" href={`/admin/content-drafts/${draft.id}`}>
                    查看 source
                  </Link>
                  {canOwnerOverride && <ContentDraftOverrideActions draftId={draft.id} />}
                </div>
              ))}
            </div>
          </>
        )}
        {surface.state === "MISSING" && (
          <div className="brief-source-trail">
            <span>沒有今日 published row。</span>
            <span>沒有今日待審 daily_briefs draft。</span>
            <span>需要檢查 OpenAlice dispatcher、source pack 與 reviewer verdict。</span>
          </div>
        )}
        {surface.state === "BLOCKED" && <p className="state-reason">{surface.reason}</p>}
      </div>
    </Panel>
  );
}

function JobsPanel({ jobs }: { jobs: LoadState<OpenAliceJobEntry[]> }) {
  return (
    <Panel code="BRF-JOBS" title="OpenAlice 工作佇列" sub="最近工作、狀態、錯誤" right={jobs.state === "LIVE" ? `${jobs.data.length} 筆` : jobs.state === "EMPTY" ? "無資料" : "受阻"}>
      <div className="brief-job-panel">
        <SourceLine state={jobs} label="最近 OpenAlice 工作" />
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
      </div>
    </Panel>
  );
}

function DraftQueuePanel({ drafts }: { drafts: LoadState<ContentDraftEntry[]> }) {
  return (
    <Panel code="BRF-DRAFT" title="待審草稿" sub="OpenAlice 產出後必須保留 source trail" right={drafts.state === "LIVE" ? `${drafts.data.length} 筆待審` : drafts.state === "EMPTY" ? "無資料" : "受阻"}>
      <div className="brief-draft-gate">
        <SourceLine state={drafts} label="content_drafts / daily_briefs" />
        {drafts.state === "LIVE" && (
          <div className="brief-job-list">
            {drafts.data.map((draft) => (
              <div className="brief-job-row draft" key={draft.id}>
                <span className="tg gold">{contentDraftTitle(draft)}</span>
                <span className="badge badge-yellow">待審</span>
                <span className="tg soft">建立 {formatDateTime(draft.createdAt)}</span>
                <span className="tg soft">更新 {formatDateTime(draft.updatedAt)}</span>
                <span className="tg soft">source job {draft.sourceJobId?.slice(0, 8) ?? "--"}</span>
                <Link className="mini-button" href={`/admin/content-drafts/${draft.id}`}>查看</Link>
              </div>
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
}

function PublishedBriefPanel({ brief }: { brief: DailyBrief | null }) {
  if (!brief) {
    return (
      <Panel code="BRF-PUB" title="正式簡報內容" sub="今日尚未發布" right="無資料">
        <div className="state-panel">
          <span className="badge badge-yellow">無資料</span>
          <span className="state-reason">沒有正式簡報時不補假內容；請看上方 OpenAlice 與待審草稿狀態。</span>
        </div>
      </Panel>
    );
  }

  return (
    <Panel code="BRF-PUB" title="正式簡報內容" sub={`${brief.date} / ${brief.generatedBy}`} right="正式資料">
      <div className="brief-section-list">
        <div className="brief-source-card">
          <span>市場狀態</span>
          <strong>{cleanExternalHeadline(brief.marketState)}</strong>
          <p>來源：正式 daily_briefs row / 建立 {formatDateTime(brief.createdAt)}</p>
        </div>
        {brief.sections.map((section, index) => (
          <article className="brief-source-card" key={`${section.heading}-${index}`}>
            <span>段落 {index + 1}</span>
            <strong>{cleanExternalHeadline(section.heading)}</strong>
            <p>{safeBriefText(section.body)}</p>
          </article>
        ))}
      </div>
    </Panel>
  );
}

function DraftSourceTrailPanel({ drafts }: { drafts: ContentDraftEntry[] }) {
  const first = drafts[0] ?? null;
  const sections = first ? contentDraftSections(first).slice(0, 4) : [];
  return (
    <Panel code="SRC" title="草稿 source trail" sub="只顯示待審來源，不當正式簡報" right={first ? "待審" : "無資料"}>
      {first ? (
        <div className="brief-section-list">
          <div className="brief-source-card">
            <span>草稿</span>
            <strong>{contentDraftTitle(first)}</strong>
            <p>source job {first.sourceJobId?.slice(0, 8) ?? "--"} / producer {first.producerVersion} / 更新 {formatDateTime(first.updatedAt)}</p>
          </div>
          {sections.map((section, index) => (
            <article className="brief-source-card" key={`${section.heading}-${index}`}>
              <span>待審段落 {index + 1}</span>
              <strong>{cleanExternalHeadline(section.heading)}</strong>
              <p>{safeBriefText(section.body)}</p>
            </article>
          ))}
        </div>
      ) : (
        <div className="state-panel">
          <span className="badge badge-yellow">無資料</span>
          <span className="state-reason">尚未有可追蹤草稿；這是 pipeline blocker，不用舊簡報填補。</span>
        </div>
      )}
    </Panel>
  );
}

export default async function BriefsPage() {
  const today = todayTaipeiDate();
  const [briefData, drafts, jobs, openAlice, dispatcher, canOwnerOverride] = await Promise.all([
    loadBriefsData(),
    loadDrafts(),
    loadJobs(),
    loadOpenAlice(),
    loadDispatcherDebug(),
    loadCanOwnerOverride(),
  ]);

  const surface = buildSurface({
    today,
    briefs: briefData.briefs,
    drafts: drafts.data,
    error: briefData.error,
  });
  const latest = briefData.briefs[0] ?? null;
  const latestAgeDays = latest ? briefAgeDays(latest.date) : null;
  const freshness: BriefFreshness = briefData.error ? "BLOCKED" : latest ? (latestAgeDays === 0 ? "LIVE" : "STALE") : "EMPTY";
  const displayedBrief = surface.state === "PUBLISHED" ? surface.brief : null;

  return (
    <PageFrame
      code="BRF"
      title="每日簡報"
      sub="OpenAlice 自動產文、AI 審核、source trail、正式發布"
      note="每日簡報只顯示正式資料或待審草稿。沒有今日內容就說明缺口，不用過期內容假裝今日報告。"
    >
      <MetricStrip
        columns={8}
        cells={[
          { label: "今日狀態", value: surfaceLabel(surface.state), tone: surfaceTone(surface.state) },
          { label: "正式簡報", value: formatCount(briefData.briefs.length), tone: briefData.briefs.length ? "status-ok" : "muted" },
          { label: "待審草稿", value: formatCount(drafts.data.length), tone: drafts.data.length ? "gold" : "muted" },
          { label: "OpenAlice", value: openAlice.state === "LIVE" ? surfaceStateLabel(openAliceSurface(openAlice.data)) : "受阻", tone: openAlice.state === "LIVE" ? surfaceStateTone(openAliceSurface(openAlice.data)) : "status-bad" },
          { label: "派工", value: dispatcher.state === "LIVE" ? dispatcherResultLabel(dispatcher.data?.lastTickResult ?? null) : "受阻", tone: dispatcher.state === "LIVE" ? dispatcherResultTone(dispatcher.data?.lastTickResult ?? null) : "status-bad" },
          { label: "工作佇列", value: jobs.state === "LIVE" ? jobs.data.length : jobs.state === "EMPTY" ? 0 : "--", tone: jobs.state === "LIVE" ? "status-ok" : jobs.state === "EMPTY" ? "muted" : "status-bad" },
          { label: "最新正式", value: latest ? `${latest.date} / ${briefAgeCopy(latestAgeDays)}` : "--", tone: freshness === "STALE" ? "gold" : freshness === "BLOCKED" ? "status-bad" : undefined },
          { label: "今日段落", value: displayedBrief ? displayedBrief.sections.length : "--" },
          { label: "來源狀態", value: displayedBrief ? "正式資料" : drafts.data.length ? "待審 source" : "缺口", tone: displayedBrief ? "status-ok" : "gold" },
        ]}
      />

      <BriefSurfacePanel surface={surface} canOwnerOverride={canOwnerOverride} />

      <section className="brief-command-deck">
        <div>
          <span className="tg gold">OpenAlice / 每日台股作業流</span>
          <h2>每天要自動產生、審核、保留來源，再發布到戰情室。</h2>
          <p>
            這頁不是文章列表，而是每日簡報的控制面板：你可以看到產文主腦是否健康、今天是否已發布、
            草稿是否待審、source trail 是否存在，以及是哪一段流程卡住。
          </p>
        </div>
        <div className="brief-source-card">
          <span>下一步</span>
          <strong>{surface.state === "PUBLISHED" ? "檢查正式內容" : surface.state === "AWAITING_REVIEW" ? "審核今日草稿" : "補 OpenAlice pipeline"}</strong>
          <p>正式報告缺失時，請先看 OpenAlice runner / dispatcher / reviewer，而不是用舊資料補畫面。</p>
        </div>
      </section>

      <OpenAlicePanel openAlice={openAlice} />
      <DispatcherDebugPanel dispatcher={dispatcher} />
      <JobsPanel jobs={jobs} />
      <DraftQueuePanel drafts={drafts} />
      <PublishedBriefPanel brief={displayedBrief} />
      {!displayedBrief && <DraftSourceTrailPanel drafts={drafts.data} />}
    </PageFrame>
  );
}
