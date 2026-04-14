import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import {
  authenticateOpenAliceDevice,
  cleanupStaleOpenAliceDevices,
  claimOpenAliceJob,
  enqueueOpenAliceJob,
  getOpenAliceBridgeSnapshot,
  listOpenAliceJobs,
  registerOpenAliceDevice,
  reviewOpenAliceJob,
  submitOpenAliceResult
} from "../apps/api/src/openalice-bridge.ts";
import {
  collectOpenAliceMaintenanceMetrics,
  resolveExpiredJobTransition
} from "../apps/worker/src/openalice-maintenance.ts";
import {
  buildTradingViewEventKey,
  validateTradingViewTimestamp
} from "../apps/api/src/tradingview-webhook-guard.ts";
import {
  parseAuditTarget,
  summarizeAuditEntries
} from "../apps/api/src/audit-log-store.ts";
import { signalCreateInputSchema } from "../packages/contracts/src/signal.ts";
import { MemoryTradingRoomRepository } from "../packages/domain/src/memory-repository.ts";
import { parseGraphData } from "../packages/integrations/src/my-tw-coverage/graph-parser.ts";

test("signal schema applies expected defaults", () => {
  const parsed = signalCreateInputSchema.parse({
    category: "industry",
    direction: "bullish",
    title: "Optics demand inflects",
    confidence: 4
  });

  assert.equal(parsed.summary, "");
  assert.deepEqual(parsed.themeIds, []);
  assert.deepEqual(parsed.companyIds, []);
});

test("graph parser extracts companies and relation types", () => {
  const graph = {
    nodes: [
      { id: "Acme Optics", count: 4, category: "taiwan_company" },
      { id: "NVIDIA", count: 10, category: "international_company" },
      { id: "CPO", count: 7, category: "technology" }
    ],
    links: [
      { source: "Acme Optics", target: "CPO", value: 3 },
      { source: "NVIDIA", target: "Acme Optics", value: 2 }
    ]
  };

  const parsed = parseGraphData(JSON.stringify(graph), "network/graph_data.json");

  assert.equal(parsed.companies.length, 2);
  assert.deepEqual(
    parsed.companies.map((company) => company.displayName).sort(),
    ["Acme Optics", "NVIDIA"]
  );
  assert.equal(parsed.relations.length, 2);
  assert.equal(parsed.relations[0]?.relationType, "technology");
  assert.equal(parsed.relations[1]?.relationType, "co_occurrence");
});

test("tradingview event key stays stable and honors explicit event keys", () => {
  const payload = {
    ticker: "SMK1",
    exchange: "NASDAQ",
    price: "123.45",
    interval: "1D",
    direction: "bullish",
    category: "price",
    confidence: 5,
    summary: "Webhook smoke signal",
    themeIds: ["b", "a"],
    companyIds: ["2", "1"],
    timestamp: "2026-04-14T00:00:00.000Z"
  };

  const keyA = buildTradingViewEventKey(payload);
  const keyB = buildTradingViewEventKey({
    ...payload,
    themeIds: ["a", "b"],
    companyIds: ["1", "2"]
  });

  assert.equal(keyA, keyB);
  assert.equal(
    buildTradingViewEventKey({
      ...payload,
      eventKey: "tv-custom-key"
    }),
    "tv-custom-key"
  );
});

test("tradingview timestamp validation accepts fresh values and rejects stale ones", () => {
  const now = new Date("2026-04-14T12:00:00.000Z");

  assert.deepEqual(
    validateTradingViewTimestamp("2026-04-14T11:58:00.000Z", now, {
      dedupTtlSeconds: 300,
      timestampToleranceSeconds: 300,
      rateLimitPerMinute: 120,
      enforceTimestamp: false
    }),
    {
      ok: true,
      normalizedTimestamp: "2026-04-14T11:58:00.000Z"
    }
  );

  assert.deepEqual(
    validateTradingViewTimestamp("2026-04-14T11:40:00.000Z", now, {
      dedupTtlSeconds: 300,
      timestampToleranceSeconds: 300,
      rateLimitPerMinute: 120,
      enforceTimestamp: false
    }),
    {
      ok: false,
      error: "timestamp_out_of_range"
    }
  );
});

test("audit target parser recognizes special routes and CRUD fallbacks", () => {
  assert.deepEqual(parseAuditTarget("POST", "/api/v1/webhooks/tradingview"), {
    action: "ingest",
    entityType: "tradingview_webhook",
    entityId: "event"
  });

  assert.deepEqual(parseAuditTarget("PATCH", "/api/v1/openalice/jobs/job-123/review"), {
    action: "review",
    entityType: "openalice_job",
    entityId: "job-123"
  });

  assert.deepEqual(parseAuditTarget("POST", "/api/v1/themes"), {
    action: "create",
    entityType: "theme",
    entityId: "pending"
  });
});

test("audit summary aggregates recent actions and entity types", () => {
  const summary = summarizeAuditEntries(
    [
      {
        id: "1",
        action: "create",
        entityType: "theme",
        entityId: "pending",
        payload: {},
        createdAt: "2026-04-14T10:00:00.000Z"
      },
      {
        id: "2",
        action: "create",
        entityType: "signal",
        entityId: "pending",
        payload: {},
        createdAt: "2026-04-14T09:59:00.000Z"
      },
      {
        id: "3",
        action: "ingest",
        entityType: "tradingview_webhook",
        entityId: "event",
        payload: {},
        createdAt: "2026-04-14T09:58:00.000Z"
      }
    ],
    24
  );

  assert.equal(summary.windowHours, 24);
  assert.equal(summary.total, 3);
  assert.equal(summary.latestCreatedAt, "2026-04-14T10:00:00.000Z");
  assert.deepEqual(summary.actions, [
    { action: "create", count: 2 },
    { action: "ingest", count: 1 }
  ]);
  assert.deepEqual(summary.entities, [
    { entityType: "signal", count: 1 },
    { entityType: "theme", count: 1 },
    { entityType: "tradingview_webhook", count: 1 }
  ]);
  assert.equal(summary.recent.length, 3);
});

test("memory repository supports core research-to-review loop", async () => {
  const repo = new MemoryTradingRoomRepository();

  const theme = await repo.createTheme({
    name: "AI Optics Expansion",
    marketState: "Selective Attack",
    lifecycle: "Discovery",
    priority: 4,
    thesis: "Optical interconnect demand is broadening.",
    whyNow: "1.6T discussion is moving from prototypes into budgeting.",
    bottleneck: "Module capacity"
  });

  const company = await repo.createCompany({
    name: "Photon Switch",
    ticker: "PHTN",
    market: "NASDAQ",
    country: "United States",
    themeIds: [theme.id],
    chainPosition: "Optical switching",
    beneficiaryTier: "Direct",
    exposure: {
      volume: 5,
      asp: 4,
      margin: 3,
      capacity: 4,
      narrative: 4
    },
    validation: {
      capitalFlow: "Institutions adding exposure.",
      consensus: "Revisions turning up.",
      relativeStrength: "Outperforming peers."
    },
    notes: "Higher-beta optics candidate."
  });

  const signal = await repo.createSignal({
    category: "industry",
    direction: "bullish",
    title: "Optics lead times extend",
    summary: "Lead indicators suggest more spending urgency.",
    confidence: 4,
    themeIds: [theme.id],
    companyIds: [company.id]
  });

  const plan = await repo.createTradePlan({
    companyId: company.id,
    status: "ready",
    entryPlan: "Buy on pullback into reclaimed breakout.",
    invalidationPlan: "Exit on failed retest.",
    targetPlan: "Scale out into prior high.",
    riskReward: "1:3",
    notes: "Pair with theme validation."
  });

  const review = await repo.createReview({
    tradePlanId: plan.id,
    outcome: "Took partials into strength.",
    attribution: "Thesis and timing aligned.",
    lesson: "Add faster once signal quality confirms.",
    setupTags: ["theme", "breakout"],
    executionQuality: 4
  });

  const brief = await repo.createBrief({
    date: "2026-04-13",
    marketState: "Balanced",
    sections: [
      {
        heading: "Optics",
        body: "Demand remains healthy."
      }
    ],
    generatedBy: "manual",
    status: "draft"
  });

  assert.equal((await repo.listThemes()).some((item) => item.id === theme.id), true);
  assert.equal((await repo.listCompanies(theme.id)).some((item) => item.id === company.id), true);
  assert.equal((await repo.listSignals({ themeId: theme.id })).some((item) => item.id === signal.id), true);
  assert.equal(
    (await repo.listTradePlans({ companyId: company.id })).some((item) => item.id === plan.id),
    true
  );
  assert.equal(
    (await repo.listReviews({ tradePlanId: plan.id })).some((item) => item.id === review.id),
    true
  );
  assert.equal((await repo.listBriefs()).some((item) => item.id === brief.id), true);
});

test("openalice bridge requeues stale jobs and blocks stale submitters", async () => {
  const suffix = randomUUID();
  const workspaceSlug = `bridge-${suffix}`;

  const registrationA = await registerOpenAliceDevice({
    workspaceSlug,
    deviceId: `device-a-${suffix}`,
    deviceName: "Bridge Test A",
    capabilities: ["drafts"]
  });
  const registrationB = await registerOpenAliceDevice({
    workspaceSlug,
    deviceId: `device-b-${suffix}`,
    deviceName: "Bridge Test B",
    capabilities: ["drafts"]
  });

  const deviceA = await authenticateOpenAliceDevice({
    deviceId: registrationA.deviceId,
    token: registrationA.deviceToken
  });
  const deviceB = await authenticateOpenAliceDevice({
    deviceId: registrationB.deviceId,
    token: registrationB.deviceToken
  });

  assert.ok(deviceA);
  assert.ok(deviceB);

  const job = await enqueueOpenAliceJob({
    workspaceSlug,
    taskType: "daily_brief",
    schemaName: "BriefDraft",
    instructions: "Draft a bridge smoke brief.",
    contextRefs: [],
    parameters: { source: "ci" },
    timeoutSeconds: 1
  });

  const firstClaim = await claimOpenAliceJob(deviceA);
  assert.equal(firstClaim?.jobId, job.jobId);
  assert.equal(firstClaim?.attemptCount, 1);

  await delay(1_100);

  const secondClaim = await claimOpenAliceJob(deviceB);
  assert.equal(secondClaim?.jobId, job.jobId);
  assert.equal(secondClaim?.attemptCount, 2);

  const staleSubmit = await submitOpenAliceResult({
    device: deviceA,
    result: {
      jobId: job.jobId,
      status: "draft_ready",
      schemaName: "BriefDraft",
      rawText: "stale"
    }
  });
  assert.equal(staleSubmit, null);

  const freshSubmit = await submitOpenAliceResult({
    device: deviceB,
    result: {
      jobId: job.jobId,
      status: "draft_ready",
      schemaName: "BriefDraft",
      rawText: "fresh"
    }
  });
  assert.equal(freshSubmit?.status, "draft_ready");

  const jobs = await listOpenAliceJobs(workspaceSlug);
  const completed = jobs.find((item) => item.id === job.jobId);
  assert.equal(completed?.status, "draft_ready");
  assert.equal(completed?.attemptCount, 2);
});

test("openalice maintenance resolves expired leases into requeue or failure", () => {
  const now = new Date("2026-04-14T12:00:00.000Z");

  assert.deepEqual(
    resolveExpiredJobTransition(
      {
        status: "running",
        leaseExpiresAt: new Date("2026-04-14T11:59:00.000Z"),
        attemptCount: 1,
        maxAttempts: 3
      },
      now
    ),
    {
      status: "queued",
      error: null
    }
  );

  assert.deepEqual(
    resolveExpiredJobTransition(
      {
        status: "running",
        leaseExpiresAt: new Date("2026-04-14T11:59:00.000Z"),
        attemptCount: 3,
        maxAttempts: 3
      },
      now
    ),
    {
      status: "failed",
      error: "OpenAlice job lease expired after 3 attempts."
    }
  );
});

test("openalice maintenance metrics count stale jobs and stale devices", () => {
  const now = new Date("2026-04-14T12:00:00.000Z");

  const metrics = collectOpenAliceMaintenanceMetrics({
    now,
    mode: "database",
    deviceStaleSeconds: 600,
    expiredJobsRequeued: 2,
    expiredJobsFailed: 1,
    jobs: [
      {
        status: "queued",
        leaseExpiresAt: null,
        attemptCount: 0,
        maxAttempts: 3
      },
      {
        status: "running",
        leaseExpiresAt: new Date("2026-04-14T11:55:00.000Z"),
        attemptCount: 1,
        maxAttempts: 3
      },
      {
        status: "draft_ready",
        leaseExpiresAt: null,
        attemptCount: 2,
        maxAttempts: 3
      }
    ],
    devices: [
      {
        status: "active",
        lastSeenAt: new Date("2026-04-14T11:40:00.000Z")
      },
      {
        status: "active",
        lastSeenAt: new Date("2026-04-14T11:59:30.000Z")
      }
    ]
  });

  assert.equal(metrics.queuedJobs, 1);
  assert.equal(metrics.runningJobs, 1);
  assert.equal(metrics.terminalJobs, 1);
  assert.equal(metrics.staleRunningJobs, 1);
  assert.equal(metrics.activeDevices, 2);
  assert.equal(metrics.staleDevices, 1);
  assert.equal(metrics.expiredJobsRequeued, 2);
  assert.equal(metrics.expiredJobsFailed, 1);
});

test("openalice bridge snapshot reports memory-mode queue and device counts", async () => {
  const suffix = randomUUID();
  const workspaceSlug = `snapshot-${suffix}`;

  const registration = await registerOpenAliceDevice({
    workspaceSlug,
    deviceId: `device-${suffix}`,
    deviceName: "Snapshot Device",
    capabilities: ["drafts"]
  });
  const device = await authenticateOpenAliceDevice({
    deviceId: registration.deviceId,
    token: registration.deviceToken
  });

  assert.ok(device);

  const job = await enqueueOpenAliceJob({
    workspaceSlug,
    taskType: "daily_brief",
    schemaName: "BriefDraft",
    instructions: "Snapshot job",
    contextRefs: [],
    parameters: {}
  });

  const beforeClaim = await getOpenAliceBridgeSnapshot(workspaceSlug);
  assert.equal(beforeClaim.mode, "memory");
  assert.equal(beforeClaim.queuedJobs, 1);
  assert.equal(beforeClaim.runningJobs, 0);
  assert.equal(beforeClaim.activeDevices, 1);

  const claim = await claimOpenAliceJob(device);
  assert.equal(claim?.jobId, job.jobId);

  const afterClaim = await getOpenAliceBridgeSnapshot(workspaceSlug);
  assert.equal(afterClaim.queuedJobs, 0);
  assert.equal(afterClaim.runningJobs, 1);
  assert.equal(afterClaim.activeDevices, 1);
});

test("openalice stale device cleanup revokes devices and requeues their jobs", async () => {
  const suffix = randomUUID();
  const workspaceSlug = `cleanup-${suffix}`;

  const registrationA = await registerOpenAliceDevice({
    workspaceSlug,
    deviceId: `cleanup-device-a-${suffix}`,
    deviceName: "Cleanup Device A",
    capabilities: ["drafts"]
  });

  const deviceA = await authenticateOpenAliceDevice({
    deviceId: registrationA.deviceId,
    token: registrationA.deviceToken
  });

  assert.ok(deviceA);

  const job = await enqueueOpenAliceJob({
    workspaceSlug,
    taskType: "daily_brief",
    schemaName: "BriefDraft",
    instructions: "Cleanup stale device test.",
    contextRefs: [],
    parameters: { source: "ci" },
    timeoutSeconds: 60
  });

  const firstClaim = await claimOpenAliceJob(deviceA);
  assert.equal(firstClaim?.jobId, job.jobId);
  assert.equal(firstClaim?.attemptCount, 1);

  await delay(1_100);

  const cleanup = await cleanupStaleOpenAliceDevices({
    workspaceSlug,
    staleSeconds: 1
  });
  assert.equal(cleanup.revokedCount, 1);
  assert.equal(cleanup.staleBeforeCleanup, 1);
  assert.equal(cleanup.devices[0]?.deviceId, registrationA.deviceId);
  assert.equal(cleanup.devices[0]?.status, "revoked");

  const registrationB = await registerOpenAliceDevice({
    workspaceSlug,
    deviceId: `cleanup-device-b-${suffix}`,
    deviceName: "Cleanup Device B",
    capabilities: ["drafts"]
  });
  const deviceB = await authenticateOpenAliceDevice({
    deviceId: registrationB.deviceId,
    token: registrationB.deviceToken
  });
  assert.ok(deviceB);

  const secondClaim = await claimOpenAliceJob(deviceB);
  assert.equal(secondClaim?.jobId, job.jobId);
  assert.equal(secondClaim?.attemptCount, 2);
});

test("openalice draft review publishes reviewable jobs and rejects stale state changes", async () => {
  const suffix = randomUUID();
  const workspaceSlug = `review-${suffix}`;

  const job = await enqueueOpenAliceJob({
    workspaceSlug,
    taskType: "daily_brief",
    schemaName: "BriefDraft",
    instructions: "Review API test.",
    contextRefs: [],
    parameters: {}
  });

  const registration = await registerOpenAliceDevice({
    workspaceSlug,
    deviceId: `review-device-${suffix}`,
    deviceName: "Review Device",
    capabilities: ["drafts"]
  });
  const device = await authenticateOpenAliceDevice({
    deviceId: registration.deviceId,
    token: registration.deviceToken
  });

  assert.ok(device);

  const claim = await claimOpenAliceJob(device);
  assert.equal(claim?.jobId, job.jobId);

  const submitted = await submitOpenAliceResult({
    device,
    result: {
      jobId: job.jobId,
      status: "draft_ready",
      schemaName: "BriefDraft",
      rawText: "draft body"
    }
  });
  assert.equal(submitted?.status, "draft_ready");

  const reviewed = await reviewOpenAliceJob({
    workspaceSlug,
    jobId: job.jobId,
    status: "published",
    reviewNote: "looks good"
  });
  assert.equal(reviewed?.status, "published");

  const secondReview = await reviewOpenAliceJob({
    workspaceSlug,
    jobId: job.jobId,
    status: "rejected",
    reviewNote: "too late"
  });
  assert.equal(secondReview, null);

  const jobs = await listOpenAliceJobs(workspaceSlug);
  const finalJob = jobs.find((item) => item.id === job.jobId);
  assert.equal(finalJob?.status, "published");
});
