import type {
  AppSession,
  DailyBrief,
  ReviewEntry,
  Signal,
  Theme,
  TradePlan
} from "@iuf-trading-room/contracts";
import type { CompanyLite, TradingRoomRepository } from "@iuf-trading-room/domain";

import { getAuditLogSummary } from "./audit-log-store.js";
import { getEventHistory, getEventHistorySummary } from "./event-history.js";
import { getCompaniesLiteCached } from "./market-data.js";
import { listOpenAliceJobs } from "./openalice-bridge.js";
import { getOpenAliceObservabilitySnapshot } from "./openalice-observability.js";
import { getThemeGraphRankings } from "./theme-graph.js";

type LatestRecord = {
  id: string;
  label: string;
  subtitle?: string;
  timestamp: string;
};

export type OpsSnapshot = {
  generatedAt: string;
  workspace: {
    id: string;
    name: string;
    slug: string;
  };
  stats: {
    themes: number;
    companies: number;
    signals: number;
    plans: number;
    reviews: number;
    briefs: number;
    coreCompanies: number;
    directCompanies: number;
    activePlans: number;
    reviewQueue: number;
    publishedBriefs: number;
    bullishSignals: number;
  };
  openAlice: {
    observability: Awaited<ReturnType<typeof getOpenAliceObservabilitySnapshot>>;
    queue: {
      totalJobs: number;
      queued: number;
      running: number;
      reviewable: number;
      failed: number;
    };
  };
  audit: Awaited<ReturnType<typeof getAuditLogSummary>>;
  rankings: Awaited<ReturnType<typeof getThemeGraphRankings>>;
  eventHistory: {
    summary: Awaited<ReturnType<typeof getEventHistorySummary>>;
    recent: Awaited<ReturnType<typeof getEventHistory>>;
  };
  latest: {
    themes: LatestRecord[];
    companies: LatestRecord[];
    signals: LatestRecord[];
    plans: LatestRecord[];
    reviews: LatestRecord[];
    briefs: LatestRecord[];
  };
};

// BUG-04 fix: sanitize English-heavy signal/plan labels so the frontend
// `cleanExternalHeadline` fallback ("資料列尚未完成中文整理") does not fire.
const _SIGNAL_CATEGORY_ZH: Record<string, string> = {
  price: "技術訊號",
  macro: "總體經濟訊號",
  industry: "產業訊號",
  company: "個股訊號",
  portfolio: "投組訊號"
};
const _SIGNAL_DIRECTION_ZH: Record<string, string> = {
  bullish: "偏多",
  bearish: "偏空",
  neutral: "中性"
};
const _PLAN_STATUS_ZH: Record<string, string> = {
  draft: "草稿",
  ready: "已就緒",
  active: "執行中",
  reduced: "縮倉",
  closed: "已平倉",
  cancelled: "已取消"
};

function _sanitizeSignalLabel(signal: { title: string; category: string; direction: string }): string {
  const title = signal.title?.trim() ?? "";
  const latin = (title.match(/[A-Za-z]/g) ?? []).length;
  const cjk = (title.match(/[一-鿿]/g) ?? []).length;
  const isEnglishHeavy = latin >= 16 && latin > Math.max(8, cjk * 2);
  if (!isEnglishHeavy && cjk > 0) return title; // already has meaningful Chinese
  const cat = _SIGNAL_CATEGORY_ZH[signal.category] ?? "訊號";
  const dir = _SIGNAL_DIRECTION_ZH[signal.direction] ?? signal.direction;
  return `${cat}（${dir}）`;
}

function _sanitizePlanLabel(plan: { status: string; riskReward?: number | string | null }): string {
  const statusZh = _PLAN_STATUS_ZH[plan.status] ?? plan.status;
  return plan.riskReward != null
    ? `交易計畫 風報比 ${plan.riskReward} · ${statusZh}`
    : `交易計畫 · ${statusZh}`;
}

function byIsoDesc<T>(items: T[], getIso: (item: T) => string | undefined) {
  return [...items].sort((left, right) => {
    const leftValue = getIso(left) ?? "";
    const rightValue = getIso(right) ?? "";
    return rightValue.localeCompare(leftValue);
  });
}

function takeLatest<T>(
  items: T[],
  limit: number,
  getIso: (item: T) => string | undefined,
  map: (item: T) => LatestRecord
) {
  return byIsoDesc(items, getIso)
    .slice(0, limit)
    .map(map);
}

export function buildOpsSnapshotView(input: {
  session: AppSession;
  themes: Theme[];
  companies: CompanyLite[];
  signals: Signal[];
  plans: TradePlan[];
  reviews: ReviewEntry[];
  briefs: DailyBrief[];
  jobs: Awaited<ReturnType<typeof listOpenAliceJobs>>;
  audit: Awaited<ReturnType<typeof getAuditLogSummary>>;
  rankings: Awaited<ReturnType<typeof getThemeGraphRankings>>;
  eventHistorySummary: Awaited<ReturnType<typeof getEventHistorySummary>>;
  eventHistoryRecent: Awaited<ReturnType<typeof getEventHistory>>;
  openAlice: Awaited<ReturnType<typeof getOpenAliceObservabilitySnapshot>>;
  generatedAt?: string;
  recentLimit?: number;
}): OpsSnapshot {
  const recentLimit = Math.max(1, Math.min(input.recentLimit ?? 6, 20));
  const reviewQueue = input.jobs.filter(
    (job) => job.status === "draft_ready" || job.status === "validation_failed"
  ).length;

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    workspace: {
      id: input.session.workspace.id,
      name: input.session.workspace.name,
      slug: input.session.workspace.slug
    },
    stats: {
      themes: input.themes.length,
      companies: input.companies.length,
      signals: input.signals.length,
      plans: input.plans.length,
      reviews: input.reviews.length,
      briefs: input.briefs.length,
      coreCompanies: input.companies.filter((company) => company.beneficiaryTier === "Core").length,
      directCompanies: input.companies.filter((company) => company.beneficiaryTier === "Direct").length,
      activePlans: input.plans.filter((plan) => ["ready", "active", "reduced"].includes(plan.status))
        .length,
      reviewQueue,
      publishedBriefs: input.briefs.filter((brief) => brief.status === "published").length,
      bullishSignals: input.signals.filter((signal) => signal.direction === "bullish").length
    },
    openAlice: {
      observability: input.openAlice,
      queue: {
        totalJobs: input.jobs.length,
        queued: input.jobs.filter((job) => job.status === "queued").length,
        running: input.jobs.filter((job) => job.status === "running").length,
        reviewable: reviewQueue,
        failed: input.jobs.filter((job) => job.status === "failed").length
      }
    },
    audit: input.audit,
    rankings: input.rankings,
    eventHistory: {
      summary: input.eventHistorySummary,
      recent: input.eventHistoryRecent
    },
    latest: {
      themes: takeLatest(
        input.themes,
        recentLimit,
        (theme) => theme.updatedAt,
        (theme) => ({
          id: theme.id,
          label: theme.name,
          subtitle: `${theme.lifecycle} / priority ${theme.priority}`,
          timestamp: theme.updatedAt
        })
      ),
      companies: takeLatest(
        input.companies,
        recentLimit,
        (company) => company.updatedAt,
        (company) => ({
          id: company.id,
          label: `${company.ticker} ${company.name}`,
          subtitle: `${company.market} / ${company.beneficiaryTier}`,
          timestamp: company.updatedAt
        })
      ),
      signals: takeLatest(
        input.signals,
        recentLimit,
        (signal) => signal.createdAt,
        (signal) => ({
          id: signal.id,
          label: _sanitizeSignalLabel(signal),
          subtitle: `${_SIGNAL_CATEGORY_ZH[signal.category] ?? signal.category} / ${_SIGNAL_DIRECTION_ZH[signal.direction] ?? signal.direction} / 信心度 ${signal.confidence}`,
          timestamp: signal.createdAt
        })
      ),
      plans: takeLatest(
        input.plans,
        recentLimit,
        (plan) => plan.updatedAt,
        (plan) => ({
          id: plan.id,
          label: _sanitizePlanLabel(plan),
          subtitle: `狀態 / ${_PLAN_STATUS_ZH[plan.status] ?? plan.status}`,
          timestamp: plan.updatedAt
        })
      ),
      reviews: takeLatest(
        input.reviews,
        recentLimit,
        (review) => review.createdAt,
        (review) => ({
          id: review.id,
          label: review.outcome.slice(0, 80),
          subtitle: `execution quality ${review.executionQuality}/5`,
          timestamp: review.createdAt
        })
      ),
      briefs: takeLatest(
        input.briefs,
        recentLimit,
        (brief) => brief.createdAt,
        (brief) => ({
          id: brief.id,
          label: `${brief.date} ${brief.marketState}`,
          subtitle: `${brief.generatedBy} / ${brief.status}`,
          timestamp: brief.createdAt
        })
      )
    }
  };
}

export async function getOpsSnapshot(input: {
  session: AppSession;
  repo: TradingRoomRepository;
  auditHours?: number;
  recentLimit?: number;
  rankingLimit?: number;
}) {
  const { session, repo } = input;
  const workspaceSlug = session.workspace.slug;
  const recentLimit = input.recentLimit ?? 6;
  const rankingLimit = input.rankingLimit ?? 6;

  const [
    themes,
    companies,
    signals,
    plans,
    reviews,
    briefs,
    jobs,
    openAlice,
    audit,
    rankings,
    eventHistorySummary,
    eventHistoryRecent
  ] = await Promise.all([
    repo.listThemes({ workspaceSlug }),
    getCompaniesLiteCached(repo, workspaceSlug),
    repo.listSignals({}, { workspaceSlug }),
    repo.listTradePlans({}, { workspaceSlug }),
    repo.listReviews({}, { workspaceSlug }),
    repo.listBriefs({ workspaceSlug }),
    listOpenAliceJobs(workspaceSlug),
    getOpenAliceObservabilitySnapshot(workspaceSlug),
    getAuditLogSummary({
      session,
      hours: input.auditHours
    }),
    getThemeGraphRankings({
      session,
      repo,
      limit: rankingLimit,
      keywordLimit: 3
    }),
    getEventHistorySummary({
      session,
      repo,
      hours: input.auditHours
    }),
    getEventHistory({
      session,
      repo,
      hours: input.auditHours,
      limit: recentLimit
    })
  ]);

  return buildOpsSnapshotView({
    session,
    themes,
    companies,
    signals,
    plans,
    reviews,
    briefs,
    jobs,
    audit,
    rankings,
    eventHistorySummary,
    eventHistoryRecent,
    openAlice,
    recentLimit
  });
}
