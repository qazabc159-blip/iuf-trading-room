import type {
  AppSession,
  Company,
  DailyBrief,
  ReviewEntry,
  Signal,
  Theme,
  TradePlan
} from "@iuf-trading-room/contracts";
import type { TradingRoomRepository } from "@iuf-trading-room/domain";

import { getAuditLogSummary } from "./audit-log-store.js";
import { listOpenAliceJobs } from "./openalice-bridge.js";
import { getOpenAliceObservabilitySnapshot } from "./openalice-observability.js";

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
  latest: {
    themes: LatestRecord[];
    companies: LatestRecord[];
    signals: LatestRecord[];
    plans: LatestRecord[];
    reviews: LatestRecord[];
    briefs: LatestRecord[];
  };
};

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
  companies: Company[];
  signals: Signal[];
  plans: TradePlan[];
  reviews: ReviewEntry[];
  briefs: DailyBrief[];
  jobs: Awaited<ReturnType<typeof listOpenAliceJobs>>;
  audit: Awaited<ReturnType<typeof getAuditLogSummary>>;
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
      activePlans: input.plans.filter((plan) => ["ready", "active", "reduced"].includes(plan.status)).length,
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
    latest: {
      themes: takeLatest(
        input.themes,
        recentLimit,
        (theme) => theme.updatedAt,
        (theme) => ({
          id: theme.id,
          label: theme.name,
          subtitle: `${theme.lifecycle} / 優先級 ${theme.priority}`,
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
          label: signal.title,
          subtitle: `${signal.category} / ${signal.direction} / 信心 ${signal.confidence}`,
          timestamp: signal.createdAt
        })
      ),
      plans: takeLatest(
        input.plans,
        recentLimit,
        (plan) => plan.updatedAt,
        (plan) => ({
          id: plan.id,
          label: `計畫 ${plan.riskReward ? `RR ${plan.riskReward}` : plan.status}`,
          subtitle: `狀態 ${plan.status}`,
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
          subtitle: `執行品質 ${review.executionQuality}/5`,
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
}) {
  const { session, repo } = input;
  const workspaceSlug = session.workspace.slug;

  const [themes, companies, signals, plans, reviews, briefs, jobs, openAlice, audit] =
    await Promise.all([
      repo.listThemes({ workspaceSlug }),
      repo.listCompanies(undefined, { workspaceSlug }),
      repo.listSignals({}, { workspaceSlug }),
      repo.listTradePlans({}, { workspaceSlug }),
      repo.listReviews({}, { workspaceSlug }),
      repo.listBriefs({ workspaceSlug }),
      listOpenAliceJobs(workspaceSlug),
      getOpenAliceObservabilitySnapshot(workspaceSlug),
      getAuditLogSummary({
        session,
        hours: input.auditHours
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
    openAlice,
    recentLimit: input.recentLimit
  });
}
