import Link from "next/link";

import { BriefSearchPanel } from "./BriefSearchPanel";
import { ContentDraftOverrideActions } from "@/components/ContentDraftOverrideActions";
import { PageFrame, Panel } from "@/components/PageFrame";

import {
  getBriefs,
  getContentDrafts,
  getOpenAliceDispatcherDebug,
  getOpenAliceJobs,
  getOpenAliceObservability,
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
import { evaluateBriefQuality } from "./briefQuality";

export const dynamic = "force-dynamic";

type LoadState<T> =
  | { state: "LIVE"; data: T; updatedAt: string; source: string }
  | { state: "EMPTY"; data: T; updatedAt: string; source: string; reason: string }
  | { state: "BLOCKED"; data: T; updatedAt: string; source: string; reason: string };

type DailyBriefSurface =
  | { state: "PUBLISHED"; today: string; brief: DailyBrief; latest: DailyBrief | null; drafts: ContentDraftEntry[] }
  | { state: "TEMPLATE_BLOCKED"; today: string; brief: DailyBrief; latest: DailyBrief | null; drafts: ContentDraftEntry[] }
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
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringField(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function draftTargetDate(draft: ContentDraftEntry) {
  const payload = asRecord(draft.payload);
  return stringField(payload, "date") ?? stringField(payload, "targetDate") ?? draft.targetEntityId ?? null;
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

  if (params.error) return { state: "BLOCKED", today: params.today, latest, drafts: todayDrafts, reason: params.error };
  if (todayBrief) {
    const quality = evaluateBriefQuality(todayBrief);
    if (!quality.displayable) return { state: "TEMPLATE_BLOCKED", today: params.today, brief: todayBrief, latest, drafts: todayDrafts };
    return { state: "PUBLISHED", today: params.today, brief: todayBrief, latest, drafts: todayDrafts };
  }
  if (todayDrafts.length > 0) return { state: "AWAITING_REVIEW", today: params.today, latest, drafts: todayDrafts };
  return { state: "MISSING", today: params.today, latest, drafts: todayDrafts };
}

function surfaceLabel(state: DailyBriefSurface["state"]) {
  if (state === "PUBLISHED") return "已發布";
  if (state === "TEMPLATE_BLOCKED") return "模板未通過";
  if (state === "AWAITING_REVIEW") return "待審核";
  if (state === "MISSING") return "未產生";
  return "需處理";
}

function surfaceTone(state: DailyBriefSurface["state"]) {
  if (state === "PUBLISHED") return "status-ok";
  if (state === "TEMPLATE_BLOCKED") return "gold";
  if (state === "BLOCKED") return "status-bad";
  return "gold";
}

function surfaceBadge(state: DailyBriefSurface["state"]) {
  if (state === "PUBLISHED") return "badge-green";
  if (state === "TEMPLATE_BLOCKED") return "badge-yellow";
  if (state === "BLOCKED") return "badge-red";
  return "badge-yellow";
}

function jobStatusLabel(value: string | null | undefined) {
  if (value === "queued") return "排隊中";
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

function openAliceSurface(data: OpenAliceObservability | null): OpenAliceSurface {
  if (!data) return "BLOCKED";
  if (data.workerStatus === "healthy" && data.sweepStatus === "healthy") return "LIVE";
  if (data.workerStatus === "missing" && data.sweepStatus === "missing") return "BLOCKED";
  return "STALE";
}

function surfaceStateLabel(state: OpenAliceSurface) {
  if (state === "LIVE") return "正常";
  if (state === "STALE") return "過期";
  return "需處理";
}

function surfaceStateTone(state: OpenAliceSurface) {
  if (state === "LIVE") return "status-ok";
  if (state === "STALE") return "gold";
  return "status-bad";
}

function pipelineStatusLabel(pipeline: OpenAliceObservability["pipeline"] | undefined) {
  if (!pipeline) return "尚未回報";
  if (pipeline.lastFailureReason) return "最近失敗";
  if (pipeline.lastPublishedAt) return "已發布";
  if (pipeline.reviewerVerdict === "approve") return "審核通過";
  if (pipeline.reviewerVerdict === "manual_review") return "人工待審";
  if (pipeline.reviewerVerdict === "reject") return "已退回";
  if (pipeline.lastGeneratedAt) return "已產生草稿";
  return "等待產生";
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
  if (value === "enqueued") return "已排入流程";
  if (value === "pipeline_triggered") return "已走新版模板";
  if (value === "pipeline_skipped") return "新版流程已略過";
  if (value === "skipped_existing_job") return "已有今日任務";
  if (value === "skipped_existing_brief") return "已有正式簡報";
  if (value === "no_workspace") return "需處理";
  if (value === "no_db") return "需處理";
  if (value === "enqueue_failed") return "排程失敗";
  return "等待檢查";
}

function dispatcherDisplayLabel(
  value: OpenAliceDispatcherDebug["lastTickResult"],
  surfaceState: DailyBriefSurface["state"]
) {
  if (surfaceState === "TEMPLATE_BLOCKED" && value === "skipped_existing_brief") return "需重產";
  return dispatcherResultLabel(value);
}

function dispatcherResultTone(
  value: OpenAliceDispatcherDebug["lastTickResult"],
  surfaceState: DailyBriefSurface["state"] = "MISSING"
) {
  if (surfaceState === "TEMPLATE_BLOCKED" && value === "skipped_existing_brief") return "gold";
  if (value === "enqueued" || value === "pipeline_triggered" || value === "skipped_existing_brief") return "status-ok";
  if (value === "skipped_existing_job" || value === "pipeline_skipped") return "gold";
  if (value === "enqueue_failed" || value === "no_workspace" || value === "no_db") return "status-bad";
  return "muted";
}

function dispatcherNextStep(debug: OpenAliceDispatcherDebug | null, surfaceState: DailyBriefSurface["state"] = "MISSING") {
  if (!debug) return "今日簡報排程尚未回報，等待下一輪檢查。";
  if (debug.lastTickResult === "enqueued") return "今日簡報已排入工作流，等待整理、審核與發布。";
  if (debug.lastTickResult === "pipeline_triggered") return "09:00 排程已改走新版 v2 模板流程，等待整理、審核與發布。";
  if (debug.lastTickResult === "pipeline_skipped") return `新版流程已略過：${debug.lastEnqueueError ?? "請看已發布簡報或資料狀態"}`;
  if (debug.lastTickResult === "skipped_existing_job") return "今日已有簡報工作正在處理，請看草稿或發布狀態。";
  if (debug.lastTickResult === "skipped_existing_brief" && surfaceState === "TEMPLATE_BLOCKED") {
    return "今日 DB 有已發布紀錄，但模板未通過，不能視為正式完成；下一步要用新版 v2 模板重產。";
  }
  if (debug.lastTickResult === "skipped_existing_brief") return "今日正式簡報已發布，請檢查內容與來源紀錄。";
  if (debug.lastTickResult === "no_workspace" || debug.lastTickResult === "no_db") return "今日簡報流程需要處理，請檢查資料通道狀態。";
  if (debug.lastTickResult === "enqueue_failed") return "今日簡報排程未完成，請檢查每日簡報流程。";
  return "尚未看到今日檢查結果，等待下一輪排程。";
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
    /買進/g,
    /賣出/g,
    /目標價/g,
    /必賺/g,
    /保證/g,
    /勝率/g,
  ];
  return patterns.reduce((next, pattern) => next.replace(pattern, "[投資建議字詞已遮蔽]"), text);
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
  const today = todayTaipeiDate();
  try {
    const response = await getContentDrafts({ status: "awaiting_review", limit: 100 });
    const drafts = (response.data ?? [])
      .filter((draft) => isTodayDailyBriefDraft(draft, today))
      .sort((a, b) => Date.parse(draftTime(b)) - Date.parse(draftTime(a)))
      .slice(0, 20);
    if (drafts.length === 0) {
      return { state: "EMPTY", data: [], updatedAt, source: "今日每日簡報草稿", reason: "今天沒有等待審核的每日簡報草稿。舊草稿保留在內容審核後台，不影響今日正式簡報。" };
    }
    return { state: "LIVE", data: drafts, updatedAt, source: "今日每日簡報草稿" };
  } catch (error) {
    return { state: "BLOCKED", data: [], updatedAt, source: "今日每日簡報草稿", reason: friendlyDataError(error, "草稿讀取失敗。") };
  }
}

async function loadJobs(): Promise<LoadState<OpenAliceJobEntry[]>> {
  const updatedAt = nowIso();
  try {
    const response = await getOpenAliceJobs();
    const jobs = sortJobs(response.data ?? []).slice(0, 8);
    if (jobs.length === 0) {
      return { state: "EMPTY", data: [], updatedAt, source: "AI 簡報工作流", reason: "目前沒有每日簡報工作紀錄。" };
    }
    return { state: "LIVE", data: jobs, updatedAt, source: "AI 簡報工作流" };
  } catch (error) {
    return { state: "BLOCKED", data: [], updatedAt, source: "AI 簡報工作流", reason: friendlyDataError(error, "每日簡報工作流讀取失敗。") };
  }
}

async function loadOpenAlice(): Promise<LoadState<OpenAliceObservability | null>> {
  const updatedAt = nowIso();
  try {
    const response = await getOpenAliceObservability();
    return { state: "LIVE", data: response.data, updatedAt, source: "AI 每日簡報流程" };
  } catch (error) {
    return { state: "BLOCKED", data: null, updatedAt, source: "AI 每日簡報流程", reason: friendlyDataError(error, "每日簡報流程讀取失敗。") };
  }
}

async function loadDispatcherDebug(): Promise<LoadState<OpenAliceDispatcherDebug | null>> {
  const updatedAt = nowIso();
  try {
    const response = await getOpenAliceDispatcherDebug();
    return { state: "LIVE", data: response.data, updatedAt, source: "每日簡報排程" };
  } catch (error) {
    return { state: "BLOCKED", data: null, updatedAt, source: "每日簡報排程", reason: friendlyDataError(error, "每日簡報排程讀取失敗。") };
  }
}

function SourceLine<T>({ state, label }: { state: LoadState<T>; label: string }) {
  const badge = state.state === "LIVE" ? "badge-green" : state.state === "EMPTY" ? "badge-yellow" : "badge-red";
  const text = state.state === "LIVE" ? "正常" : state.state === "EMPTY" ? "無資料" : "需處理";

  return (
    <div className="source-line">
      <span className={`badge ${badge}`}>{text}</span>
      <span>來源：{state.source}</span>
      <span>更新：{formatDateTime(state.updatedAt)}</span>
      <span>{label}</span>
    </div>
  );
}

function OpenAlicePanel({ openAlice }: { openAlice: LoadState<OpenAliceObservability | null> }) {
  const surface = openAlice.state === "LIVE" ? openAliceSurface(openAlice.data) : "BLOCKED";
  const data = openAlice.data;
  return (
    <Panel code="BRF-AI" title="AI 每日簡報流程" sub="整理、審核與發布" right={surfaceStateLabel(surface)}>
      <SourceLine state={openAlice} label="確認今日簡報是否正在自動整理與審核" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 1, background: "var(--night-rule-strong)", margin: "12px 0" }}>
        {[
          { l: "整理器", v: data?.workerStatus === "healthy" ? "正常" : data?.workerStatus === "missing" ? "需處理" : "--", c: data?.workerStatus === "healthy" ? "ok" : "bad" },
          { l: "排程", v: data?.sweepStatus === "healthy" ? "正常" : "--", c: data?.sweepStatus === "healthy" ? "ok" : "bad" },
          { l: "待處理", v: formatCount(data?.metrics.queuedJobs), c: data?.metrics.queuedJobs ? "warn" : "dim" },
          { l: "狀態", v: surfaceStateLabel(surface), c: surfaceStateTone(surface) === "status-ok" ? "ok" : surfaceStateTone(surface) === "gold" ? "warn" : "bad" },
        ].map(({ l, v, c }) => (
          <div key={l} style={{ padding: "10px 14px", background: "var(--night-1)" }}>
            <div className="parity-kpi-label">{l}</div>
            <div className={`parity-kpi-value ${c}`} style={{ fontSize: 18 }}>{v}</div>
          </div>
        ))}
      </div>
      {data && (
        <div className="brief-pipeline-grid">
          <span>心跳 <strong>{ageText(data.workerHeartbeatAgeSeconds)}</strong></span>
          <span>掃描 <strong>{ageText(data.lastSweepAgeSeconds)}</strong></span>
          <span>最後產生 <strong>{formatDateTime(data.pipeline?.lastGeneratedAt)}</strong></span>
          <span>最後審核 <strong>{formatDateTime(data.pipeline?.lastReviewedAt)}</strong></span>
          <span>最後發布 <strong>{formatDateTime(data.pipeline?.lastPublishedAt)}</strong></span>
          <span>下次執行 <strong>{formatDateTime(data.pipeline?.nextRunAt)}</strong></span>
          <span>來源包 <strong>{data.pipeline?.sourcePackCount ?? "--"}</strong></span>
          <span>審核結果 <strong>{reviewerVerdictLabel(data.pipeline?.reviewerVerdict)}</strong></span>
        </div>
      )}
      {data?.pipeline?.lastFailureReason && (
        <div className="terminal-note compact">
          <span className="tg status-bad">最近失敗</span>
          每日簡報流程最近有失敗紀錄，請從營運監控檢查處理。
        </div>
      )}
    </Panel>
  );
}

function DispatcherDebugPanel({
  dispatcher,
  surfaceState,
}: {
  dispatcher: LoadState<OpenAliceDispatcherDebug | null>;
  surfaceState: DailyBriefSurface["state"];
}) {
  const debug = dispatcher.data;
  const result = debug?.lastTickResult ?? null;
  const label = dispatcherDisplayLabel(result, surfaceState);
  const tone = dispatcher.state === "LIVE" ? dispatcherResultTone(result, surfaceState) : "status-bad";
  return (
    <Panel code="BRF-DSP" title="今日簡報排程" sub="今天是否已排入工作流" right={dispatcher.state === "LIVE" ? label : "需處理"}>
      <SourceLine state={dispatcher} label="用來確認今日簡報是否已進入整理與審核流程" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 1, background: "var(--night-rule-strong)", margin: "12px 0" }}>
        {[
          { l: "最近檢查", v: formatDateTime(debug?.lastTickAt), c: "dim" },
          { l: "結果", v: label, c: tone === "status-ok" ? "ok" : tone === "gold" ? "warn" : "bad" },
          { l: "需處理", v: debug?.lastEnqueueError ? "是" : "否", c: debug?.lastEnqueueError ? "bad" : "ok" },
        ].map(({ l, v, c }) => (
          <div key={l} style={{ padding: "10px 14px", background: "var(--night-1)" }}>
            <div className="parity-kpi-label">{l}</div>
            <div className={`parity-kpi-value ${c}`} style={{ fontSize: 18 }}>{v}</div>
          </div>
        ))}
      </div>
      <div className="terminal-note compact">
        <span className={`tg ${tone}`}>下一步</span>
        {dispatcherNextStep(debug ?? null, surfaceState)}
      </div>
    </Panel>
  );
}

function BriefStatePanel({ surface }: { surface: DailyBriefSurface }) {
  const latestCopy = surface.latest ? `${surface.latest.date} / ${briefAgeCopy(briefAgeDays(surface.latest.date))}` : "尚無正式簡報";
  return (
    <Panel code="BRF-STATE" title="每日簡報狀態" sub="今日發布與待審狀態" right={surfaceLabel(surface.state)}>
      <div className={`brief-three-state ${surface.state.toLowerCase()}`}>
        <span className={`badge ${surfaceBadge(surface.state)}`}>{surfaceLabel(surface.state)}</span>
        <span className="tg soft">今日：{surface.today}</span>
        <span className="tg soft">最後正式版：{latestCopy}</span>
        {surface.state === "PUBLISHED" && (
          <p className="state-reason">今日簡報已發布，含 {surface.brief.sections.length} 段內容；頁面只顯示有來源紀錄的內容，並遮蔽投資建議字詞。</p>
        )}
        {surface.state === "TEMPLATE_BLOCKED" && (
          <p className="state-reason">
            今日雖有已發布紀錄，但它不符合 v2 五段模板，已停止當成正式簡報展示。下一輪會用新版後端模板重產。
          </p>
        )}
        {surface.state === "AWAITING_REVIEW" && (
          <>
            <p className="state-reason">今日草稿已產生，等待審核與發布確認。</p>
            <div className="brief-today-drafts">
              {surface.drafts.map((draft) => (
                <Link href={`/admin/content-drafts/${draft.id}`} key={draft.id}>
                  {contentDraftTitle(draft)}
                </Link>
              ))}
            </div>
          </>
        )}
        {surface.state === "MISSING" && (
          <div className="brief-source-trail">
            <span>今日正式版尚未出現</span>
            <span>今日草稿尚未出現</span>
            <span>下一步看排程與來源資料</span>
          </div>
        )}
        {surface.state === "BLOCKED" && <p className="state-reason">{surface.reason}</p>}
      </div>
    </Panel>
  );
}

function JobsPanel({ jobs }: { jobs: LoadState<OpenAliceJobEntry[]> }) {
  return (
    <Panel code="BRF-JOBS" title="AI 簡報工作流" sub="近期整理、審核與發布紀錄" right={jobs.state === "LIVE" ? `${jobs.data.length} 筆` : jobs.state === "EMPTY" ? "無資料" : "需處理"}>
      <div className="brief-job-panel">
        <SourceLine state={jobs} label="最近每日簡報工作紀錄" />
        {jobs.state === "LIVE" && (
          <div className="brief-job-list">
            {jobs.data.map((job) => (
              <div className="brief-job-row" key={job.id}>
                <span className={`badge ${jobStatusBadge(job.status)}`}>{jobStatusLabel(job.status)}</span>
                <strong>{taskTypeLabel(job.taskType)}</strong>
                <span>{formatDateTime(jobTime(job))}</span>
                <span>嘗試 {job.attemptCount ?? 0}/{job.maxAttempts ?? "--"}</span>
                {job.error && <small className="status-bad">需處理</small>}
              </div>
            ))}
          </div>
        )}
        {jobs.state !== "LIVE" && <p className="state-reason">{jobs.reason}</p>}
      </div>
    </Panel>
  );
}

function DraftQueuePanel({ drafts }: { drafts: LoadState<ContentDraftEntry[]> }) {
  return (
    <Panel code="BRF-DRAFT" title="今日待審草稿" sub="今日每日簡報草稿與來源檢查" right={drafts.state === "LIVE" ? `${drafts.data.length} 筆待審` : drafts.state === "EMPTY" ? "無資料" : "需處理"}>
      <div className="brief-draft-gate">
        <SourceLine state={drafts} label="今日每日簡報草稿" />
        {drafts.state === "LIVE" && (
          <div className="brief-job-list">
            {drafts.data.map((draft) => (
              <div className="brief-job-row draft" key={draft.id}>
                <span className="badge badge-yellow">待審</span>
                <strong>{contentDraftTitle(draft)}</strong>
                <span>目標日期：{draftTargetDate(draft) ?? "--"}</span>
                <span>更新：{formatDateTime(draftTime(draft))}</span>
                <Link href={`/admin/content-drafts/${draft.id}`}>打開審核</Link>
                <ContentDraftOverrideActions draftId={draft.id} />
              </div>
            ))}
          </div>
        )}
        {drafts.state !== "LIVE" && <p className="state-reason">{drafts.reason}</p>}
      </div>
    </Panel>
  );
}

function PublishedBriefPanel({ brief }: { brief: DailyBrief | null }) {
  if (!brief) {
    return (
      <Panel code="BRF-PUB" title="正式簡報內容" sub="今日尚未發布" right="無資料">
        <p className="state-reason">沒有可展示的正式每日簡報。頁面不會用舊內容或假文案補位。</p>
      </Panel>
    );
  }

  const quality = evaluateBriefQuality(brief);

  if (!quality.displayable) {
    return (
      <Panel code="BRF-PUB" title="正式簡報內容" sub={`${brief.date} / 已暫停展示`} right="模板未通過">
        <div className="brief-published">
          <div className="brief-market-state">
            <span className="tg gold">資料保護</span>
            <strong>這份已發布簡報不符合 AI 每日簡報 v2 模板，已停止在正式內容區展示。</strong>
          </div>
          <p className="state-reason">
            系統偵測到舊版英文標題、原始主題 dump，或缺少固定段落。為避免把未整理內容當成投資依據，
            這裡只保留狀態與來源流程，不顯示舊簡報正文。
          </p>
          <div className="brief-source-trail">
            <span>缺少段落：{quality.missingHeadings.length ? quality.missingHeadings.join("、") : "無"}</span>
            <span>舊版英文標題：{quality.hasLegacyHeading ? "有" : "無"}</span>
            <span>原始 dump：{quality.hasRawDump ? "有" : "無"}</span>
          </div>
          <p className="state-reason">
            下一輪每日簡報會套用 v2 固定模板：市場總覽、AI 精選重點、產業與主題、風險觀察、資料來源狀態。
          </p>
        </div>
      </Panel>
    );
  }

  return (
    <Panel code="BRF-PUB" title="正式簡報內容" sub={`${brief.date} / 正式發布`} right={surfaceLabel("PUBLISHED")}>
      <div className="brief-published">
        <div className="brief-market-state">
          <span className="tg gold">盤勢狀態</span>
          <strong>{cleanExternalHeadline(brief.marketState)}</strong>
        </div>
        {brief.sections.map((section, index) => (
          <article className="brief-section" key={`${section.heading}:${index}`}>
            <span className="tg muted">#{String(index + 1).padStart(2, "0")}</span>
            <h3>{cleanExternalHeadline(section.heading)}</h3>
            <p>{safeBriefText(section.body)}</p>
          </article>
        ))}
      </div>
    </Panel>
  );
}

function DraftSourceTrailPanel({ drafts }: { drafts: ContentDraftEntry[] }) {
  const draft = drafts[0] ?? null;
  if (!draft) {
    return (
      <Panel code="BRF-SRC" title="來源檢查" sub="尚未產生今日草稿" right="無資料">
        <p className="state-reason">目前沒有可檢查的今日草稿；等待每日簡報流程完成整理與審核。</p>
      </Panel>
    );
  }

  const sections = contentDraftSections(draft);
  return (
    <Panel code="BRF-SRC" title="來源檢查" sub="草稿段落與來源檢查" right={`${sections.length} 段`}>
      <div className="brief-source-trail">
        <span>草稿狀態：待審</span>
        <span>目標日期：{draftTargetDate(draft) ?? "--"}</span>
        <span>更新：{formatDateTime(draftTime(draft))}</span>
        <span>段落：{sections.length}</span>
      </div>
      <div className="brief-source-sections">
        {sections.map((section, index) => (
          <article className="brief-section compact" key={`${section.heading}:${index}`}>
            <h3>{cleanExternalHeadline(section.heading)}</h3>
            <p>{safeBriefText(section.body)}</p>
          </article>
        ))}
      </div>
    </Panel>
  );
}

export default async function BriefsPage() {
  const today = todayTaipeiDate();
  const [briefData, drafts, jobs, openAlice, dispatcher] = await Promise.all([
    loadBriefsData(),
    loadDrafts(),
    loadJobs(),
    loadOpenAlice(),
    loadDispatcherDebug(),
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
  const templateBlockedBrief = surface.state === "TEMPLATE_BLOCKED" ? surface.brief : null;

  return (
    <PageFrame
      code="12"
      title="每日簡報"
      sub="OpenAlice 每日整理、AI 審核與發布"
      note="每日簡報只顯示已發布或待審來源；沒有來源紀錄的內容不當作投資依據，也不提供買賣建議。"
    >
      <div className="parity-kpi-bar">
        <div className="parity-kpi-cell">
          <span className="parity-kpi-label">正式簡報</span>
          <span className={`parity-kpi-value ${briefData.briefs.length ? "ok" : "dim"}`}>{formatCount(briefData.briefs.length)}</span>
          <span className="parity-kpi-sub">已發布</span>
        </div>
        <div className="parity-kpi-cell">
          <span className="parity-kpi-label">今日待審草稿</span>
          <span className={`parity-kpi-value ${drafts.data.length ? "warn" : "dim"}`}>{formatCount(drafts.data.length)}</span>
          <span className="parity-kpi-sub">今天等待審核</span>
        </div>
        <div className="parity-kpi-cell">
          <span className="parity-kpi-label">OpenAlice</span>
          <span className={`parity-kpi-value ${openAlice.state === "LIVE" ? "ok" : "bad"}`}>
            {openAlice.state === "LIVE" ? surfaceStateLabel(openAliceSurface(openAlice.data)) : "需處理"}
          </span>
          <span className="parity-kpi-sub">AI 流程</span>
        </div>
        <div className="parity-kpi-cell">
          <span className="parity-kpi-label">排程</span>
          <span className={`parity-kpi-value ${dispatcher.state === "LIVE" ? "ok" : "bad"}`}>
            {dispatcher.state === "LIVE" ? dispatcherDisplayLabel(dispatcher.data?.lastTickResult ?? null, surface.state) : "需處理"}
          </span>
          <span className="parity-kpi-sub">每日排程</span>
        </div>
        <div className="parity-kpi-cell">
          <span className="parity-kpi-label">任務佇列</span>
          <span className={`parity-kpi-value ${jobs.state === "LIVE" && jobs.data.length > 0 ? "ok" : "dim"}`}>
            {jobs.state === "LIVE" ? jobs.data.length : jobs.state === "EMPTY" ? "0" : "--"}
          </span>
          <span className="parity-kpi-sub">工作紀錄</span>
        </div>
        <div className="parity-kpi-cell">
          <span className="parity-kpi-label">最後正式版</span>
          <span className={`parity-kpi-value ${freshness === "STALE" ? "warn" : freshness === "BLOCKED" ? "bad" : "ok"}`} style={{ fontSize: 13 }}>
            {latest ? latest.date : "--"}
          </span>
          <span className="parity-kpi-sub">{latest ? briefAgeCopy(latestAgeDays) : "尚無正式版"}</span>
        </div>
        <div className="parity-kpi-cell">
          <span className="parity-kpi-label">今日段落</span>
          <span className={`parity-kpi-value ${displayedBrief ? "ok" : "dim"}`}>{displayedBrief ? displayedBrief.sections.length : "--"}</span>
          <span className="parity-kpi-sub">{templateBlockedBrief ? "模板未通過" : "內容段落"}</span>
        </div>
        <div className="parity-kpi-cell">
          <span className="parity-kpi-label">來源狀態</span>
          <span className={`parity-kpi-value ${displayedBrief ? "ok" : "warn"}`}>
            {displayedBrief ? "正式資料" : templateBlockedBrief ? "需重產" : drafts.data.length ? "待審來源" : "未閉環"}
          </span>
          <span className="parity-kpi-sub">閉環確認</span>
        </div>
      </div>
      <div className="brief-command-strip">
        <Link className="terminal-button primary" href="/admin/content-drafts">
          打開草稿審核
        </Link>
        <Link className="terminal-button" href="/ops">
          查看營運監控
        </Link>
        <Link className="terminal-button" href="/market-intel">
          檢查重大訊息
        </Link>
      </div>

      {/* PR #325 brief search — FTS endpoint (ILIKE fallback) */}
      <BriefSearchPanel />

      <section className="brief-overview-grid">
        <BriefStatePanel surface={surface} />
        <OpenAlicePanel openAlice={openAlice} />
        <DispatcherDebugPanel dispatcher={dispatcher} surfaceState={surface.state} />
      </section>

      <section className="brief-workflow-note">
        <div className="brief-source-card">
          <span>下一步</span>
          <strong>{surface.state === "PUBLISHED" ? "檢查正式來源紀錄" : surface.state === "TEMPLATE_BLOCKED" ? "重產新版簡報" : surface.state === "AWAITING_REVIEW" ? "審核今日草稿" : "追每日簡報流程"}</strong>
          <p>目標是每日自動產生、AI 審核、來源紀錄可查、正式發布後進入首頁與簡報頁；未閉環時要說清楚卡在哪一層。</p>
        </div>
      </section>

      <JobsPanel jobs={jobs} />
      <DraftQueuePanel drafts={drafts} />
      <PublishedBriefPanel brief={displayedBrief} />
      {!displayedBrief && <DraftSourceTrailPanel drafts={drafts.data} />}
    </PageFrame>
  );
}

