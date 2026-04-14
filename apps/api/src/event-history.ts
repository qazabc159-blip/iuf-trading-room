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
import type { BridgeJobRecord } from "@iuf-trading-room/integrations";

import { listAuditLogEntries, type AuditEntry } from "./audit-log-store.js";
import { listOpenAliceJobs } from "./openalice-bridge.js";

export const eventHistorySourceValues = [
  "audit",
  "theme",
  "company",
  "signal",
  "plan",
  "review",
  "brief",
  "openalice"
] as const;

export type EventHistorySource = (typeof eventHistorySourceValues)[number];

export type EventHistoryItem = {
  id: string;
  source: EventHistorySource;
  action: string;
  entityType: string;
  entityId: string;
  title: string;
  subtitle?: string;
  status?: string;
  severity: "info" | "success" | "warning" | "danger";
  createdAt: string;
  href?: string;
  tags: string[];
};

export type EventHistorySummary = {
  windowHours: number;
  total: number;
  latestCreatedAt: string | null;
  sources: Array<{ source: EventHistorySource; count: number }>;
  severities: Array<{ severity: EventHistoryItem["severity"]; count: number }>;
  entities: Array<{ entityType: string; count: number }>;
  recent: EventHistoryItem[];
};

const defaultEventHistorySources: EventHistorySource[] = [
  "audit",
  "theme",
  "signal",
  "plan",
  "review",
  "brief",
  "openalice"
];

function parseIsoTimestamp(value?: string) {
  if (!value) {
    return Number.NaN;
  }

  return Date.parse(value);
}

function withinWindow(value: string | undefined, fromMs: number) {
  const timestamp = parseIsoTimestamp(value);
  return Number.isFinite(timestamp) && timestamp >= fromMs;
}

function clipText(value: string, maxLength = 96) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function humanizeOpenAliceTask(taskType: BridgeJobRecord["taskType"]) {
  return taskType.replaceAll("_", " ");
}

function getAuditSeverity(entry: AuditEntry): EventHistoryItem["severity"] {
  if ((entry.status ?? 200) >= 500) {
    return "danger";
  }
  if ((entry.status ?? 200) >= 400) {
    return "warning";
  }
  if (entry.action === "delete" || entry.action === "revoke") {
    return "warning";
  }
  if (entry.action === "cleanup") {
    return "info";
  }
  return "success";
}

function getOpenAliceSeverity(status: BridgeJobRecord["status"]): EventHistoryItem["severity"] {
  if (status === "failed" || status === "rejected") {
    return "danger";
  }
  if (status === "validation_failed") {
    return "warning";
  }
  if (status === "published" || status === "draft_ready") {
    return "success";
  }
  return "info";
}

function toEventHistoryItem(item: EventHistoryItem) {
  return item;
}

export function parseEventHistorySources(raw?: string) {
  if (!raw?.trim()) {
    return [...defaultEventHistorySources];
  }

  const allowed = new Set<EventHistorySource>(eventHistorySourceValues);
  const parsed = raw
    .split(",")
    .map((value) => value.trim())
    .filter((value): value is EventHistorySource => allowed.has(value as EventHistorySource));

  return parsed.length > 0 ? parsed : [...defaultEventHistorySources];
}

export function buildEventHistoryView(input: {
  themes: Theme[];
  companies: Company[];
  signals: Signal[];
  plans: TradePlan[];
  reviews: ReviewEntry[];
  briefs: DailyBrief[];
  jobs: BridgeJobRecord[];
  audit: AuditEntry[];
  sources?: EventHistorySource[];
  entityType?: string;
  entityId?: string;
  action?: string;
  status?: string;
  severity?: EventHistoryItem["severity"];
  search?: string;
  limit?: number;
}) {
  const sourceSet = new Set(input.sources ?? defaultEventHistorySources);
  const limit = Math.max(1, Math.min(input.limit ?? 50, 200));
  const searchNeedle = input.search?.trim().toLowerCase();

  const items: EventHistoryItem[] = [];

  if (sourceSet.has("audit")) {
    items.push(
      ...input.audit.map((entry) =>
        toEventHistoryItem({
          id: `audit:${entry.id}`,
          source: "audit",
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId,
          title: `${entry.action.toUpperCase()} ${entry.entityType}`,
          subtitle: entry.path
            ? `${entry.method ?? "HTTP"} ${entry.path}`
            : entry.entityId,
          status: entry.status === undefined ? undefined : String(entry.status),
          severity: getAuditSeverity(entry),
          createdAt: entry.createdAt,
          href: "/ops",
          tags: [
            entry.method ?? "",
            entry.role ?? "",
            entry.workspace ?? "",
            entry.path ?? ""
          ].filter(Boolean)
        })
      )
    );
  }

  if (sourceSet.has("theme")) {
    items.push(
      ...input.themes.map((theme) =>
        toEventHistoryItem({
          id: `theme:${theme.id}`,
          source: "theme",
          action: theme.createdAt === theme.updatedAt ? "created" : "updated",
          entityType: "theme",
          entityId: theme.id,
          title: theme.name,
          subtitle: `${theme.lifecycle} / priority ${theme.priority}`,
          status: theme.marketState,
          severity: "info",
          createdAt: theme.updatedAt,
          href: "/themes",
          tags: [theme.marketState, theme.lifecycle]
        })
      )
    );
  }

  if (sourceSet.has("company")) {
    items.push(
      ...input.companies.map((company) =>
        toEventHistoryItem({
          id: `company:${company.id}`,
          source: "company",
          action: "updated",
          entityType: "company",
          entityId: company.id,
          title: `${company.ticker} ${company.name}`,
          subtitle: `${company.market} / ${company.beneficiaryTier}`,
          status: company.beneficiaryTier,
          severity: "info",
          createdAt: company.updatedAt,
          href: "/companies",
          tags: [company.market, company.country, company.chainPosition]
        })
      )
    );
  }

  if (sourceSet.has("signal")) {
    items.push(
      ...input.signals.map((signal) =>
        toEventHistoryItem({
          id: `signal:${signal.id}`,
          source: "signal",
          action: signal.direction,
          entityType: "signal",
          entityId: signal.id,
          title: signal.title,
          subtitle: `${signal.category} / confidence ${signal.confidence}`,
          status: signal.direction,
          severity:
            signal.direction === "bullish"
              ? "success"
              : signal.direction === "bearish"
                ? "warning"
                : "info",
          createdAt: signal.createdAt,
          href: "/signals",
          tags: [signal.category, signal.direction]
        })
      )
    );
  }

  if (sourceSet.has("plan")) {
    items.push(
      ...input.plans.map((plan) =>
        toEventHistoryItem({
          id: `plan:${plan.id}`,
          source: "plan",
          action: plan.status,
          entityType: "plan",
          entityId: plan.id,
          title: `Trade plan ${plan.status}`,
          subtitle: plan.riskReward ? `RR ${plan.riskReward}` : clipText(plan.entryPlan, 64),
          status: plan.status,
          severity:
            plan.status === "active" || plan.status === "ready"
              ? "success"
              : plan.status === "closed" || plan.status === "canceled"
                ? "warning"
                : "info",
          createdAt: plan.updatedAt,
          href: "/plans",
          tags: [plan.status, plan.companyId]
        })
      )
    );
  }

  if (sourceSet.has("review")) {
    items.push(
      ...input.reviews.map((review) =>
        toEventHistoryItem({
          id: `review:${review.id}`,
          source: "review",
          action: "logged",
          entityType: "review",
          entityId: review.id,
          title: clipText(review.outcome || "Review logged"),
          subtitle: `Execution quality ${review.executionQuality}/5`,
          status: `${review.executionQuality}/5`,
          severity:
            review.executionQuality >= 4
              ? "success"
              : review.executionQuality <= 2
                ? "warning"
                : "info",
          createdAt: review.createdAt,
          href: "/reviews",
          tags: review.setupTags
        })
      )
    );
  }

  if (sourceSet.has("brief")) {
    items.push(
      ...input.briefs.map((brief) =>
        toEventHistoryItem({
          id: `brief:${brief.id}`,
          source: "brief",
          action: brief.status,
          entityType: "brief",
          entityId: brief.id,
          title: `Daily brief ${brief.date}`,
          subtitle: `${brief.marketState} / ${brief.generatedBy}`,
          status: brief.status,
          severity: brief.status === "published" ? "success" : "info",
          createdAt: brief.createdAt,
          href: "/briefs",
          tags: [brief.generatedBy, brief.marketState]
        })
      )
    );
  }

  if (sourceSet.has("openalice")) {
    items.push(
      ...input.jobs.map((job) =>
        toEventHistoryItem({
          id: `openalice:${job.id}`,
          source: "openalice",
          action: job.status,
          entityType: "openalice_job",
          entityId: job.id,
          title: `OpenAlice ${humanizeOpenAliceTask(job.taskType)}`,
          subtitle: clipText(job.instructions, 80),
          status: job.status,
          severity: getOpenAliceSeverity(job.status),
          createdAt: job.completedAt ?? job.claimedAt ?? job.createdAt,
          href: "/drafts",
          tags: [job.taskType, job.status, job.deviceId ?? ""].filter(Boolean)
        })
      )
    );
  }

  return items
    .filter((item) => !input.entityType || item.entityType === input.entityType)
    .filter((item) => !input.entityId || item.entityId === input.entityId)
    .filter((item) => !input.action || item.action === input.action)
    .filter((item) => !input.status || item.status === input.status)
    .filter((item) => !input.severity || item.severity === input.severity)
    .filter((item) => {
      if (!searchNeedle) {
        return true;
      }

      return [
        item.source,
        item.action,
        item.entityType,
        item.entityId,
        item.title,
        item.subtitle ?? "",
        item.status ?? "",
        ...item.tags
      ]
        .join(" ")
        .toLowerCase()
        .includes(searchNeedle);
    })
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, limit);
}

export function summarizeEventHistoryItems(
  items: EventHistoryItem[],
  windowHours: number
): EventHistorySummary {
  const sourceCounts = new Map<EventHistorySource, number>();
  const severityCounts = new Map<EventHistoryItem["severity"], number>();
  const entityCounts = new Map<string, number>();

  for (const item of items) {
    sourceCounts.set(item.source, (sourceCounts.get(item.source) ?? 0) + 1);
    severityCounts.set(item.severity, (severityCounts.get(item.severity) ?? 0) + 1);
    entityCounts.set(item.entityType, (entityCounts.get(item.entityType) ?? 0) + 1);
  }

  return {
    windowHours,
    total: items.length,
    latestCreatedAt: items[0]?.createdAt ?? null,
    sources: [...sourceCounts.entries()]
      .map(([source, count]) => ({ source, count }))
      .sort((left, right) => right.count - left.count || left.source.localeCompare(right.source)),
    severities: [...severityCounts.entries()]
      .map(([severity, count]) => ({ severity, count }))
      .sort(
        (left, right) => right.count - left.count || left.severity.localeCompare(right.severity)
      ),
    entities: [...entityCounts.entries()]
      .map(([entityType, count]) => ({ entityType, count }))
      .sort((left, right) => right.count - left.count || left.entityType.localeCompare(right.entityType)),
    recent: items.slice(0, 10)
  };
}

function escapeCsvValue(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

export function formatEventHistoryItemsAsCsv(items: EventHistoryItem[]) {
  const header = [
    "created_at",
    "source",
    "action",
    "entity_type",
    "entity_id",
    "status",
    "severity",
    "title",
    "subtitle",
    "href",
    "tags"
  ];

  const rows = items.map((item) => [
    item.createdAt,
    item.source,
    item.action,
    item.entityType,
    item.entityId,
    item.status ?? "",
    item.severity,
    item.title,
    item.subtitle ?? "",
    item.href ?? "",
    item.tags.join("|")
  ]);

  return [header, ...rows]
    .map((row) => row.map((value) => escapeCsvValue(String(value))).join(","))
    .join("\n");
}

export async function getEventHistory(input: {
  session: AppSession;
  repo: TradingRoomRepository;
  hours?: number;
  limit?: number;
  sources?: EventHistorySource[];
  entityType?: string;
  entityId?: string;
  action?: string;
  status?: string;
  severity?: EventHistoryItem["severity"];
  search?: string;
}) {
  const workspaceSlug = input.session.workspace.slug;
  const hours = Math.max(1, Math.min(input.hours ?? 24, 24 * 30));
  const limit = Math.max(1, Math.min(input.limit ?? 50, 200));
  const fromMs = Date.now() - hours * 60 * 60 * 1000;
  const from = new Date(fromMs);
  const sources = input.sources ?? [...defaultEventHistorySources];
  const sourceSet = new Set(sources);

  const [
    themes,
    companies,
    signals,
    plans,
    reviews,
    briefs,
    jobs,
    audit
  ] = await Promise.all([
    sourceSet.has("theme") ? input.repo.listThemes({ workspaceSlug }) : Promise.resolve([]),
    sourceSet.has("company")
      ? input.repo.listCompanies(undefined, { workspaceSlug })
      : Promise.resolve([]),
    sourceSet.has("signal") ? input.repo.listSignals({}, { workspaceSlug }) : Promise.resolve([]),
    sourceSet.has("plan") ? input.repo.listTradePlans({}, { workspaceSlug }) : Promise.resolve([]),
    sourceSet.has("review") ? input.repo.listReviews({}, { workspaceSlug }) : Promise.resolve([]),
    sourceSet.has("brief") ? input.repo.listBriefs({ workspaceSlug }) : Promise.resolve([]),
    sourceSet.has("openalice") ? listOpenAliceJobs(workspaceSlug) : Promise.resolve([]),
    sourceSet.has("audit")
      ? listAuditLogEntries({
          session: input.session,
          limit: Math.max(limit * 2, 100),
          scanLimit: Math.max(limit * 8, 400),
          from
        })
      : Promise.resolve([])
  ]);

  return buildEventHistoryView({
    themes: themes.filter((theme) => withinWindow(theme.updatedAt, fromMs)),
    companies: companies.filter((company) => withinWindow(company.updatedAt, fromMs)),
    signals: signals.filter((signal) => withinWindow(signal.createdAt, fromMs)),
    plans: plans.filter((plan) => withinWindow(plan.updatedAt, fromMs)),
    reviews: reviews.filter((review) => withinWindow(review.createdAt, fromMs)),
    briefs: briefs.filter((brief) => withinWindow(brief.createdAt, fromMs)),
    jobs: jobs.filter((job) =>
      withinWindow(job.completedAt ?? job.claimedAt ?? job.createdAt, fromMs)
    ),
    audit,
    sources,
    entityType: input.entityType,
    entityId: input.entityId,
    action: input.action,
    status: input.status,
    severity: input.severity,
    search: input.search,
    limit
  });
}

export async function getEventHistorySummary(input: {
  session: AppSession;
  repo: TradingRoomRepository;
  hours?: number;
  sources?: EventHistorySource[];
  entityType?: string;
  entityId?: string;
  action?: string;
  status?: string;
  severity?: EventHistoryItem["severity"];
  search?: string;
}) {
  const windowHours = Math.max(1, Math.min(input.hours ?? 24, 24 * 30));
  const items = await getEventHistory({
    session: input.session,
    repo: input.repo,
    hours: windowHours,
    limit: 500,
    sources: input.sources,
    entityType: input.entityType,
    entityId: input.entityId,
    action: input.action,
    status: input.status,
    severity: input.severity,
    search: input.search
  });

  return summarizeEventHistoryItems(items, windowHours);
}
