import type {
  AppSession,
  DailyBrief,
  ReviewEntry,
  Signal,
  Theme,
  TradePlan
} from "@iuf-trading-room/contracts";
import type { TradingRoomRepository } from "@iuf-trading-room/domain";

import { listAuditLogEntries, type AuditEntry } from "./audit-log-store.js";
import { listOpenAliceJobs } from "./openalice-bridge.js";

type TrendCounts = {
  themesCreated: number;
  signalsCreated: number;
  bullishSignals: number;
  plansCreated: number;
  reviewsCreated: number;
  briefsCreated: number;
  publishedBriefs: number;
  openAliceJobsCreated: number;
  auditEvents: number;
};

export type OpsTrendPoint = {
  date: string;
  label: string;
  counts: TrendCounts;
  totalActivity: number;
};

export type OpsTrendSummary = {
  days: number;
  timeZone: string;
  range: {
    from: string;
    to: string;
  };
  totals: TrendCounts;
  busiestDay: {
    date: string;
    totalActivity: number;
  } | null;
  latestDay: OpsTrendPoint | null;
};

export type OpsTrendView = {
  summary: OpsTrendSummary;
  series: OpsTrendPoint[];
};

const defaultTrendCounts = (): TrendCounts => ({
  themesCreated: 0,
  signalsCreated: 0,
  bullishSignals: 0,
  plansCreated: 0,
  reviewsCreated: 0,
  briefsCreated: 0,
  publishedBriefs: 0,
  openAliceJobsCreated: 0,
  auditEvents: 0
});

function toDateParts(value: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const parts = formatter.formatToParts(value);
  const year = parts.find((part) => part.type === "year")?.value ?? "0000";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";

  return {
    key: `${year}-${month}-${day}`,
    label: `${month}/${day}`
  };
}

function parseIsoDate(value?: string | null) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function sumTrendCounts(left: TrendCounts, right: TrendCounts): TrendCounts {
  return {
    themesCreated: left.themesCreated + right.themesCreated,
    signalsCreated: left.signalsCreated + right.signalsCreated,
    bullishSignals: left.bullishSignals + right.bullishSignals,
    plansCreated: left.plansCreated + right.plansCreated,
    reviewsCreated: left.reviewsCreated + right.reviewsCreated,
    briefsCreated: left.briefsCreated + right.briefsCreated,
    publishedBriefs: left.publishedBriefs + right.publishedBriefs,
    openAliceJobsCreated: left.openAliceJobsCreated + right.openAliceJobsCreated,
    auditEvents: left.auditEvents + right.auditEvents
  };
}

function countTotalActivity(counts: TrendCounts) {
  return (
    counts.themesCreated +
    counts.signalsCreated +
    counts.bullishSignals +
    counts.plansCreated +
    counts.reviewsCreated +
    counts.briefsCreated +
    counts.publishedBriefs +
    counts.openAliceJobsCreated +
    counts.auditEvents
  );
}

function ensureSeriesBucket(
  series: Map<string, OpsTrendPoint>,
  dateKey: string,
  label: string
) {
  let bucket = series.get(dateKey);
  if (!bucket) {
    bucket = {
      date: dateKey,
      label,
      counts: defaultTrendCounts(),
      totalActivity: 0
    };
    series.set(dateKey, bucket);
  }

  return bucket;
}

export function buildOpsTrendView(input: {
  days: number;
  timeZone: string;
  now?: Date;
  themes: Theme[];
  signals: Signal[];
  plans: TradePlan[];
  reviews: ReviewEntry[];
  briefs: DailyBrief[];
  jobs: Array<{ createdAt: string }>;
  audit: AuditEntry[];
}) {
  const days = Math.max(1, Math.min(input.days, 60));
  const timeZone = input.timeZone;
  const now = input.now ?? new Date();
  const end = new Date(now);
  const start = new Date(now);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  start.setUTCHours(0, 0, 0, 0);

  const series = new Map<string, OpsTrendPoint>();

  for (let index = 0; index < days; index += 1) {
    const day = new Date(start);
    day.setUTCDate(start.getUTCDate() + index);
    const parts = toDateParts(day, timeZone);
    ensureSeriesBucket(series, parts.key, parts.label);
  }

  const maybeAdd = (value: string | undefined | null, apply: (bucket: OpsTrendPoint) => void) => {
    const parsed = parseIsoDate(value);
    if (!parsed || parsed < start || parsed > end) {
      return;
    }

    const parts = toDateParts(parsed, timeZone);
    const bucket = ensureSeriesBucket(series, parts.key, parts.label);
    apply(bucket);
  };

  for (const theme of input.themes) {
    maybeAdd(theme.createdAt, (bucket) => {
      bucket.counts.themesCreated += 1;
    });
  }

  for (const signal of input.signals) {
    maybeAdd(signal.createdAt, (bucket) => {
      bucket.counts.signalsCreated += 1;
      if (signal.direction === "bullish") {
        bucket.counts.bullishSignals += 1;
      }
    });
  }

  for (const plan of input.plans) {
    maybeAdd(plan.createdAt, (bucket) => {
      bucket.counts.plansCreated += 1;
    });
  }

  for (const review of input.reviews) {
    maybeAdd(review.createdAt, (bucket) => {
      bucket.counts.reviewsCreated += 1;
    });
  }

  for (const brief of input.briefs) {
    maybeAdd(brief.createdAt, (bucket) => {
      bucket.counts.briefsCreated += 1;
      if (brief.status === "published") {
        bucket.counts.publishedBriefs += 1;
      }
    });
  }

  for (const job of input.jobs) {
    maybeAdd(job.createdAt, (bucket) => {
      bucket.counts.openAliceJobsCreated += 1;
    });
  }

  for (const auditEntry of input.audit) {
    maybeAdd(auditEntry.createdAt, (bucket) => {
      bucket.counts.auditEvents += 1;
    });
  }

  const ordered = [...series.values()]
    .sort((left, right) => left.date.localeCompare(right.date))
    .map((bucket) => ({
      ...bucket,
      totalActivity: countTotalActivity(bucket.counts)
    }));

  const totals = ordered.reduce(
    (aggregate, item) => sumTrendCounts(aggregate, item.counts),
    defaultTrendCounts()
  );

  const busiestDay = ordered.reduce<OpsTrendPoint | null>((best, item) => {
    if (!best) {
      return item;
    }

    if (item.totalActivity > best.totalActivity) {
      return item;
    }

    return item.totalActivity === best.totalActivity && item.date > best.date ? item : best;
  }, null);

  return {
    summary: {
      days,
      timeZone,
      range: {
        from: ordered[0]?.date ?? toDateParts(start, timeZone).key,
        to: ordered.at(-1)?.date ?? toDateParts(end, timeZone).key
      },
      totals,
      busiestDay: busiestDay
        ? {
            date: busiestDay.date,
            totalActivity: busiestDay.totalActivity
          }
        : null,
      latestDay: ordered.at(-1) ?? null
    },
    series: ordered
  } satisfies OpsTrendView;
}

export async function getOpsTrends(input: {
  session: AppSession;
  repo: TradingRoomRepository;
  days?: number;
  timeZone?: string;
}) {
  const workspaceSlug = input.session.workspace.slug;
  const days = Math.max(1, Math.min(input.days ?? 14, 60));
  const timeZone = input.timeZone?.trim() || "Asia/Taipei";
  const from = new Date();
  from.setUTCDate(from.getUTCDate() - (days - 1));
  from.setUTCHours(0, 0, 0, 0);

  const [themes, signals, plans, reviews, briefs, jobs, audit] = await Promise.all([
    input.repo.listThemes({ workspaceSlug }),
    input.repo.listSignals({}, { workspaceSlug }),
    input.repo.listTradePlans({}, { workspaceSlug }),
    input.repo.listReviews({}, { workspaceSlug }),
    input.repo.listBriefs({ workspaceSlug }),
    listOpenAliceJobs(workspaceSlug),
    listAuditLogEntries({
      session: input.session,
      limit: 5_000,
      scanLimit: 5_000,
      from
    })
  ]);

  return buildOpsTrendView({
    days,
    timeZone,
    themes,
    signals,
    plans,
    reviews,
    briefs,
    jobs,
    audit
  });
}
