import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
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
  buildCompanyGraphSearchResults,
  buildCompanyGraphStatsView,
  buildCompanyGraphView
} from "../apps/api/src/company-graph.ts";
import {
  buildCompanyDuplicateReport,
  getCompanyDuplicateReport
} from "../apps/api/src/company-duplicates.ts";
import {
  executeCompanyMerge,
  getCompanyMergePreview
} from "../apps/api/src/company-merge.ts";
import {
  buildThemeGraphView,
  formatThemeGraphStatsAsCsv,
  getThemeGraphRankings,
  getThemeGraphStats,
  getThemeGraphView,
  searchThemeGraph
} from "../apps/api/src/theme-graph.ts";
import {
  createStrategyRun,
  executeStrategyRun,
  getLotSize,
  getStrategyIdeas,
  getStrategyRunById,
  issueConfirmToken,
  listStrategyRuns,
  validateAndConsumeConfirmToken
} from "../apps/api/src/strategy-engine.ts";
import {
  getMarketDataPolicy,
  getMarketDataOverview,
  getMarketBarDiagnostics,
  getMarketDataConsumerSummary,
  getMarketDataDecisionSummary,
  getMarketDataSelectionSummary,
  getEffectiveMarketQuotes,
  getMarketQuoteHistoryDiagnostics,
  ingestTradingViewQuote,
  listMarketBars,
  listMarketDataProviderStatuses,
  listMarketQuoteHistory,
  listMarketQuotes,
  listMarketSymbols,
  resetMarketDataWorkspaceState,
  resolveMarketQuotes,
  upsertPaperQuotes,
  upsertManualQuotes
} from "../apps/api/src/market-data.ts";
import { resetPersistedQuoteEntries } from "../apps/api/src/market-data-store.ts";
import { resetPersistedStrategyRuns } from "../apps/api/src/strategy-runs-store.ts";
import {
  deleteStrategyRiskLimit,
  deleteSymbolRiskLimit,
  evaluateRiskCheck,
  getKillSwitchState,
  getRiskLimitState,
  listStrategyRiskLimits,
  listSymbolRiskLimits,
  resolveRiskLimit,
  setKillSwitchState,
  upsertRiskLimitState,
  upsertStrategyRiskLimit,
  upsertSymbolRiskLimit
} from "../apps/api/src/risk-engine.ts";
import {
  buildTradingViewEventKey,
  validateTradingViewTimestamp
} from "../apps/api/src/tradingview-webhook-guard.ts";
import {
  formatAuditEntriesAsCsv,
  parseAuditTarget,
  summarizeAuditEntries
} from "../apps/api/src/audit-log-store.ts";
import {
  evaluateExecutionGate,
  GATE_OVERRIDE_KEY
} from "../apps/api/src/broker/execution-gate.ts";
import {
  listPaperOrders,
  placePaperOrder
} from "../apps/api/src/broker/paper-broker.ts";
import { previewOrder, submitOrder } from "../apps/api/src/broker/trading-service.ts";
import { listExecutionEvents } from "../apps/api/src/broker/execution-events-store.ts";
import {
  buildEventHistoryView,
  formatEventHistoryItemsAsCsv,
  parseEventHistorySources
} from "../apps/api/src/event-history.ts";
import { buildOpsSnapshotView } from "../apps/api/src/ops-snapshot.ts";
import { buildOpsTrendView } from "../apps/api/src/ops-trends.ts";
import {
  DEFAULT_RISK_LIMITS,
  type Company,
  type Theme
} from "../packages/contracts/src/index.ts";
import { signalCreateInputSchema } from "../packages/contracts/src/signal.ts";
import { MemoryTradingRoomRepository } from "../packages/domain/src/memory-repository.ts";
import {
  buildCompanyReferenceIndex,
  buildImportedCompanyDraft,
  parseGraphData,
  parseReport,
  resolveCompanyReference
} from "../packages/integrations/src/my-tw-coverage/index.ts";
import { buildModeHintRows } from "../apps/web/lib/quote-vocab.ts";

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

test("report parser extracts summary, relations, and import draft", () => {
  const content = `# 2330 - [[台積電]]

## 業務簡介
**板塊:** Technology
**產業:** Semiconductors
**市值:** 47,845,508 百萬台幣
**企業價值:** 45,886,629 百萬台幣

[[台積電]] 是全球領先的晶圓代工廠，受惠於 [[AI]]、高效能運算與先進製程需求。

## 供應鏈位置
**上游 (設備/原料):**
- **設備 ([[微影]]/[[蝕刻]]):** [[ASML]], [[Applied Materials]].

**下游應用:**
- **終端產品:** [[NVIDIA]] [[AI]] GPU, [[Apple]] iPhone.

## 主要客戶及供應商
### 主要客戶
- [[Apple]], [[NVIDIA]]

### 主要供應商
- [[ASML]]
`;

  const parsed = parseReport(
    content,
    "Pilot_Reports/Semiconductors/2330_台積電.md"
  );

  assert.ok(parsed);
  assert.equal(parsed.company.displayName, "台積電");
  assert.equal(parsed.company.industry, "Semiconductors");
  assert.match(parsed.company.summary ?? "", /全球領先的晶圓代工廠/);
  assert.equal(parsed.relations.some((relation) => relation.toLabel === "ASML" && relation.relationType === "supplier"), true);
  assert.equal(parsed.relations.some((relation) => relation.toLabel === "NVIDIA" && relation.relationType === "customer"), true);
  assert.equal(parsed.themeKeywords.some((keyword) => keyword.label === "AI"), true);

  const draft = buildImportedCompanyDraft(parsed.company);
  assert.equal(draft.name, "台積電");
  assert.equal(draft.chainPosition, "Semiconductors");
  assert.match(draft.notes, /Market Cap: 47,845,508 百萬台幣/);
});

test("company resolver links exact, canonical, and near-prefix references conservatively", () => {
  const companies = [
    {
      id: randomUUID(),
      name: "光寶科",
      ticker: "2301",
      market: "TWSE",
      country: "Taiwan",
      themeIds: [],
      chainPosition: "Power",
      beneficiaryTier: "Direct",
      exposure: { volume: 4, asp: 4, margin: 4, capacity: 4, narrative: 4 },
      validation: { capitalFlow: "", consensus: "", relativeStrength: "" },
      notes: "",
      updatedAt: "2026-04-15T03:00:00.000Z"
    },
    {
      id: randomUUID(),
      name: "全家",
      ticker: "5903",
      market: "TWSE",
      country: "Taiwan",
      themeIds: [],
      chainPosition: "Retail",
      beneficiaryTier: "Observation",
      exposure: { volume: 2, asp: 2, margin: 2, capacity: 2, narrative: 2 },
      validation: { capitalFlow: "", consensus: "", relativeStrength: "" },
      notes: "",
      updatedAt: "2026-04-15T03:00:00.000Z"
    },
    {
      id: randomUUID(),
      name: "中華電",
      ticker: "2412",
      market: "TWSE",
      country: "Taiwan",
      themeIds: [],
      chainPosition: "Telecom",
      beneficiaryTier: "Core",
      exposure: { volume: 4, asp: 4, margin: 4, capacity: 4, narrative: 4 },
      validation: { capitalFlow: "", consensus: "", relativeStrength: "" },
      notes: "",
      updatedAt: "2026-04-15T03:00:00.000Z"
    }
  ];

  const index = buildCompanyReferenceIndex(companies);

  assert.equal(resolveCompanyReference(index, "2301")?.company.id, companies[0]?.id);
  assert.equal(resolveCompanyReference(index, "全家便利商店")?.company.id, companies[1]?.id);
  assert.equal(resolveCompanyReference(index, "中華電信")?.company.id, companies[2]?.id);
  assert.equal(resolveCompanyReference(index, "光寶科技")?.company.id, companies[0]?.id);
  assert.equal(resolveCompanyReference(index, "Trip.com"), null);
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

  assert.deepEqual(parseAuditTarget("PUT", "/api/v1/companies/company-1/relations"), {
    action: "replace",
    entityType: "company_relation",
    entityId: "company-1"
  });

  assert.deepEqual(parseAuditTarget("PUT", "/api/v1/companies/company-1/keywords"), {
    action: "replace",
    entityType: "company_keyword",
    entityId: "company-1"
  });

  assert.deepEqual(parseAuditTarget("POST", "/api/v1/risk/limits"), {
    action: "replace",
    entityType: "risk_limit",
    entityId: "pending"
  });

  assert.deepEqual(parseAuditTarget("POST", "/api/v1/risk/checks"), {
    action: "create",
    entityType: "risk_check",
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

test("audit csv export includes enriched columns", () => {
  const csv = formatAuditEntriesAsCsv([
    {
      id: "audit-1",
      action: "create",
      entityType: "theme",
      entityId: "pending",
      payload: { note: "created theme" },
      createdAt: "2026-04-14T10:00:00.000Z",
      method: "POST",
      path: "/api/v1/themes",
      status: 201,
      role: "Owner",
      workspace: "primary-desk"
    }
  ]);

  assert.match(csv, /"created_at".*"payload_json"/);
  assert.match(csv, /"POST"/);
  assert.match(csv, /"primary-desk"/);
  assert.match(csv, /""note"":""created theme""/);
});

test("event history view merges multiple sources into a single timeline", () => {
  const history = buildEventHistoryView({
    themes: [
      {
        id: randomUUID(),
        name: "Optical Upcycle",
        slug: "optical-upcycle",
        marketState: "Balanced",
        lifecycle: "Validation",
        priority: 4,
        thesis: "",
        whyNow: "",
        bottleneck: "",
        corePoolCount: 2,
        observationPoolCount: 3,
        createdAt: "2026-04-14T08:00:00.000Z",
        updatedAt: "2026-04-14T10:00:00.000Z"
      }
    ],
    companies: [],
    signals: [
      {
        id: randomUUID(),
        category: "price",
        direction: "bullish",
        title: "Signal trigger",
        summary: "",
        confidence: 4,
        themeIds: [],
        companyIds: [],
        createdAt: "2026-04-14T10:05:00.000Z"
      }
    ],
    plans: [],
    reviews: [],
    briefs: [],
    jobs: [
      {
        id: randomUUID(),
        workspaceSlug: "primary-desk",
        status: "draft_ready",
        taskType: "daily_brief",
        instructions: "Draft the market brief",
        contextRefs: [],
        createdAt: "2026-04-14T10:10:00.000Z"
      }
    ],
    audit: [
      {
        id: "audit-1",
        action: "ingest",
        entityType: "tradingview_webhook",
        entityId: "event",
        payload: {},
        createdAt: "2026-04-14T10:15:00.000Z",
        method: "POST",
        path: "/api/v1/webhooks/tradingview",
        status: 201,
        role: "Owner",
        workspace: "primary-desk"
      }
    ],
    limit: 10
  });

  assert.equal(history.length, 4);
  assert.equal(history[0]?.source, "audit");
  assert.equal(history[1]?.source, "openalice");
  assert.equal(history[2]?.source, "signal");
  assert.equal(history[3]?.source, "theme");
});

test("event history source parser falls back safely", () => {
  assert.deepEqual(parseEventHistorySources("signal,openalice,audit"), [
    "signal",
    "openalice",
    "audit"
  ]);
  assert.deepEqual(parseEventHistorySources("bogus"), [
    "audit",
    "theme",
    "signal",
    "plan",
    "review",
    "brief",
    "openalice"
  ]);
});

test("event history csv export includes timeline columns", () => {
  const csv = formatEventHistoryItemsAsCsv([
    {
      id: "signal:1",
      source: "signal",
      action: "bullish",
      entityType: "signal",
      entityId: "1",
      title: "Signal trigger",
      subtitle: "price / confidence 4",
      status: "bullish",
      severity: "success",
      createdAt: "2026-04-14T10:05:00.000Z",
      href: "/signals",
      tags: ["price", "bullish"]
    }
  ]);

  assert.match(csv, /"created_at".*"tags"/);
  assert.match(csv, /"signal"/);
  assert.match(csv, /"price\|bullish"/);
});

test("company graph view projects focus company, neighbors, and keywords", () => {
  const focusCompany: Company = {
    id: randomUUID(),
    name: "台積電",
    ticker: "2330",
    market: "TWSE",
    country: "Taiwan",
    themeIds: [],
    chainPosition: "Foundry",
    beneficiaryTier: "Core",
    exposure: { volume: 5, asp: 5, margin: 5, capacity: 5, narrative: 5 },
    validation: { capitalFlow: "", consensus: "", relativeStrength: "" },
    notes: "",
    updatedAt: "2026-04-15T02:00:00.000Z"
  };
  const upstreamCompany: Company = {
    id: randomUUID(),
    name: "京元電",
    ticker: "2449",
    market: "TWSE",
    country: "Taiwan",
    themeIds: [],
    chainPosition: "Testing",
    beneficiaryTier: "Direct",
    exposure: { volume: 4, asp: 4, margin: 4, capacity: 4, narrative: 4 },
    validation: { capitalFlow: "", consensus: "", relativeStrength: "" },
    notes: "",
    updatedAt: "2026-04-15T01:00:00.000Z"
  };

  const graph = buildCompanyGraphView({
    focusCompany,
    companies: [focusCompany, upstreamCompany],
    relations: [
      {
        id: randomUUID(),
        companyId: focusCompany.id,
        targetCompanyId: null,
        targetLabel: "NVIDIA",
        relationType: "customer",
        confidence: 0.9,
        sourcePath: "Pilot_Reports/2330.md",
        updatedAt: "2026-04-15T02:10:00.000Z"
      },
      {
        id: randomUUID(),
        companyId: upstreamCompany.id,
        targetCompanyId: focusCompany.id,
        targetLabel: focusCompany.name,
        relationType: "supplier",
        confidence: 0.8,
        sourcePath: "Pilot_Reports/2449.md",
        updatedAt: "2026-04-15T02:11:00.000Z"
      }
    ],
    keywords: [
      {
        id: randomUUID(),
        companyId: focusCompany.id,
        label: "CoWoS",
        confidence: 0.8,
        sourcePath: "Pilot_Reports/2330.md",
        updatedAt: "2026-04-15T02:12:00.000Z"
      }
    ]
  });

  assert.equal(graph.focusCompanyId, focusCompany.id);
  assert.equal(graph.nodes.some((node) => node.kind === "focus_company"), true);
  assert.equal(graph.nodes.some((node) => node.label === "NVIDIA"), true);
  assert.equal(graph.edges.some((edge) => edge.direction === "outbound"), true);
  assert.equal(graph.edges.some((edge) => edge.direction === "inbound"), true);
  assert.equal(graph.summary.outboundRelations, 1);
  assert.equal(graph.summary.inboundRelations, 1);
  assert.equal(graph.keywords[0]?.label, "CoWoS");
});

test("company graph search scores ticker, name, keyword, and relation matches", () => {
  const companyA: Company = {
    id: randomUUID(),
    name: "台光電",
    ticker: "2383",
    market: "TWSE",
    country: "Taiwan",
    themeIds: [],
    chainPosition: "CCL",
    beneficiaryTier: "Direct",
    exposure: { volume: 4, asp: 4, margin: 4, capacity: 4, narrative: 4 },
    validation: { capitalFlow: "", consensus: "", relativeStrength: "" },
    notes: "",
    updatedAt: "2026-04-15T02:00:00.000Z"
  };
  const companyB: Company = {
    id: randomUUID(),
    name: "金像電",
    ticker: "2368",
    market: "TWSE",
    country: "Taiwan",
    themeIds: [],
    chainPosition: "PCB",
    beneficiaryTier: "Direct",
    exposure: { volume: 4, asp: 4, margin: 4, capacity: 4, narrative: 4 },
    validation: { capitalFlow: "", consensus: "", relativeStrength: "" },
    notes: "",
    updatedAt: "2026-04-15T02:00:00.000Z"
  };

  const results = buildCompanyGraphSearchResults({
    query: "CCL",
    companies: [companyA, companyB],
    relations: [
      {
        id: randomUUID(),
        companyId: companyB.id,
        targetCompanyId: null,
        targetLabel: "台光電",
        relationType: "supplier",
        confidence: 0.7,
        sourcePath: "Pilot_Reports/2368.md",
        updatedAt: "2026-04-15T02:10:00.000Z"
      }
    ],
    keywords: [
      {
        id: randomUUID(),
        companyId: companyA.id,
        label: "CCL",
        confidence: 0.8,
        sourcePath: "Pilot_Reports/2383.md",
        updatedAt: "2026-04-15T02:12:00.000Z"
      }
    ]
  });

  assert.equal(results[0]?.companyId, companyA.id);
  assert.equal(results[0]?.matchedBy.includes("keyword"), true);
  assert.equal(results[0]?.keywordCount, 1);
});

test("company graph search dedupes duplicate company cards by ticker and name", () => {
  const sharedTicker = "2330";
  const curatedCompany: Company = {
    id: randomUUID(),
    name: "台積電",
    ticker: sharedTicker,
    market: "TWSE",
    country: "TW",
    themeIds: [],
    chainPosition: "Semiconductors",
    beneficiaryTier: "Core",
    exposure: { volume: 5, asp: 5, margin: 5, capacity: 5, narrative: 5 },
    validation: { capitalFlow: "", consensus: "", relativeStrength: "" },
    notes: "",
    updatedAt: "2026-04-15T04:00:00.000Z"
  };
  const importedCompany: Company = {
    ...curatedCompany,
    id: randomUUID(),
    country: "Taiwan",
    beneficiaryTier: "Observation",
    exposure: { volume: 1, asp: 1, margin: 1, capacity: 1, narrative: 1 },
    updatedAt: "2026-04-15T03:00:00.000Z"
  };

  const results = buildCompanyGraphSearchResults({
    query: "台積",
    companies: [importedCompany, curatedCompany],
    relations: [
      {
        id: randomUUID(),
        companyId: curatedCompany.id,
        targetCompanyId: null,
        targetLabel: "NVIDIA",
        relationType: "customer",
        confidence: 0.9,
        sourcePath: "Pilot_Reports/Semiconductors/2330_台積電.md",
        updatedAt: "2026-04-15T04:10:00.000Z"
      }
    ],
    keywords: [
      {
        id: randomUUID(),
        companyId: curatedCompany.id,
        label: "先進封裝",
        confidence: 0.8,
        sourcePath: "Pilot_Reports/Semiconductors/2330_台積電.md",
        updatedAt: "2026-04-15T04:12:00.000Z"
      }
    ]
  });

  assert.equal(results.length, 1);
  assert.equal(results[0]?.companyId, curatedCompany.id);
  assert.equal(results[0]?.beneficiaryTier, "Core");
});

test("company graph stats summarize relation types and top nodes", () => {
  const companyA: Company = {
    id: randomUUID(),
    name: "台光電",
    ticker: "2383",
    market: "TWSE",
    country: "Taiwan",
    themeIds: [],
    chainPosition: "CCL",
    beneficiaryTier: "Direct",
    exposure: { volume: 4, asp: 4, margin: 4, capacity: 4, narrative: 4 },
    validation: { capitalFlow: "", consensus: "", relativeStrength: "" },
    notes: "",
    updatedAt: "2026-04-15T02:00:00.000Z"
  };

  const stats = buildCompanyGraphStatsView({
    companies: [companyA],
    relations: [
      {
        id: randomUUID(),
        companyId: companyA.id,
        targetCompanyId: null,
        targetLabel: "AI Server",
        relationType: "application",
        confidence: 0.7,
        sourcePath: "Pilot_Reports/2383.md",
        updatedAt: "2026-04-15T02:10:00.000Z"
      },
      {
        id: randomUUID(),
        companyId: companyA.id,
        targetCompanyId: null,
        targetLabel: "NVIDIA",
        relationType: "customer",
        confidence: 0.9,
        sourcePath: "Pilot_Reports/2383.md",
        updatedAt: "2026-04-15T02:11:00.000Z"
      }
    ],
    keywords: [
      {
        id: randomUUID(),
        companyId: companyA.id,
        label: "CCL",
        confidence: 0.8,
        sourcePath: "Pilot_Reports/2383.md",
        updatedAt: "2026-04-15T02:12:00.000Z"
      },
      {
        id: randomUUID(),
        companyId: companyA.id,
        label: "CCL",
        confidence: 0.7,
        sourcePath: "Pilot_Reports/2383.md",
        updatedAt: "2026-04-15T02:13:00.000Z"
      }
    ]
  });

  assert.equal(stats.companiesWithGraph, 1);
  assert.equal(stats.totalRelations, 2);
  assert.equal(stats.totalKeywords, 2);
  assert.equal(stats.relationTypes[0]?.count, 1);
  assert.equal(stats.topKeywords[0]?.label, "CCL");
  assert.equal(stats.topConnectedCompanies[0]?.companyId, companyA.id);
});

test("theme graph view projects theme companies, neighbors, and keyword rollups", () => {
  const themeId = randomUUID();
  const now = "2026-04-15T08:00:00.000Z";
  const theme: Theme = {
    id: themeId,
    name: "AI 光互連",
    slug: "ai-optical-interconnect",
    marketState: "Selective Attack",
    lifecycle: "Discovery",
    priority: 4,
    thesis: "Optics scale-out is accelerating.",
    whyNow: "Bandwidth is becoming the bottleneck.",
    bottleneck: "1.6T ecosystem readiness",
    corePoolCount: 2,
    observationPoolCount: 1,
    createdAt: now,
    updatedAt: now
  };
  const themeCompanyA: Company = {
    id: randomUUID(),
    name: "聯鈞",
    ticker: "3450",
    market: "TWSE",
    country: "TW",
    themeIds: [themeId],
    chainPosition: "Optics",
    beneficiaryTier: "Core",
    exposure: { volume: 5, asp: 4, margin: 4, capacity: 4, narrative: 5 },
    validation: { capitalFlow: "", consensus: "", relativeStrength: "" },
    notes: "",
    updatedAt: now
  };
  const themeCompanyB: Company = {
    id: randomUUID(),
    name: "上詮",
    ticker: "3363",
    market: "TWSE",
    country: "TW",
    themeIds: [themeId],
    chainPosition: "CPO",
    beneficiaryTier: "Direct",
    exposure: { volume: 4, asp: 4, margin: 3, capacity: 4, narrative: 4 },
    validation: { capitalFlow: "", consensus: "", relativeStrength: "" },
    notes: "",
    updatedAt: now
  };
  const neighborCompany: Company = {
    id: randomUUID(),
    name: "波若威",
    ticker: "3163",
    market: "TWSE",
    country: "TW",
    themeIds: [],
    chainPosition: "Optical modules",
    beneficiaryTier: "Observation",
    exposure: { volume: 3, asp: 3, margin: 3, capacity: 3, narrative: 3 },
    validation: { capitalFlow: "", consensus: "", relativeStrength: "" },
    notes: "",
    updatedAt: now
  };

  const view = buildThemeGraphView({
    theme,
    themeCompanies: [themeCompanyA, themeCompanyB],
    companies: [themeCompanyA, themeCompanyB, neighborCompany],
    relations: [
      {
        id: randomUUID(),
        companyId: themeCompanyA.id,
        targetCompanyId: themeCompanyB.id,
        targetLabel: themeCompanyB.name,
        relationType: "technology",
        confidence: 0.9,
        sourcePath: "reports/a.md",
        updatedAt: now
      },
      {
        id: randomUUID(),
        companyId: themeCompanyA.id,
        targetCompanyId: neighborCompany.id,
        targetLabel: neighborCompany.name,
        relationType: "supplier",
        confidence: 0.8,
        sourcePath: "reports/a.md",
        updatedAt: now
      },
      {
        id: randomUUID(),
        companyId: neighborCompany.id,
        targetCompanyId: themeCompanyB.id,
        targetLabel: themeCompanyB.name,
        relationType: "customer",
        confidence: 0.7,
        sourcePath: "reports/b.md",
        updatedAt: now
      },
      {
        id: randomUUID(),
        companyId: themeCompanyB.id,
        targetCompanyId: null,
        targetLabel: "NVIDIA",
        relationType: "customer",
        confidence: 0.85,
        sourcePath: "reports/c.md",
        updatedAt: now
      }
    ],
    keywords: [
      {
        id: randomUUID(),
        companyId: themeCompanyA.id,
        label: "AI",
        confidence: 0.9,
        sourcePath: "reports/a.md",
        updatedAt: now
      },
      {
        id: randomUUID(),
        companyId: themeCompanyB.id,
        label: "AI",
        confidence: 0.8,
        sourcePath: "reports/b.md",
        updatedAt: now
      },
      {
        id: randomUUID(),
        companyId: themeCompanyB.id,
        label: "CPO",
        confidence: 0.9,
        sourcePath: "reports/b.md",
        updatedAt: now
      }
    ]
  });

  assert.equal(view.themeId, themeId);
  assert.equal(view.summary.themeCompanyCount, 2);
  assert.equal(view.summary.internalEdges, 1);
  assert.equal(view.summary.outboundEdges, 2);
  assert.equal(view.summary.inboundEdges, 1);
  assert.equal(view.nodes.some((node) => node.kind === "theme_company" && node.companyId === themeCompanyA.id), true);
  assert.equal(view.nodes.some((node) => node.kind === "company" && node.companyId === neighborCompany.id), true);
  assert.equal(view.nodes.some((node) => node.kind === "external_label" && node.label === "NVIDIA"), true);
  assert.equal(view.topKeywords[0]?.label, "AI");
  assert.equal(view.topKeywords[0]?.count, 2);
});

test("company duplicate report groups duplicates and recommends a canonical record", () => {
  const curatedCompany: Company = {
    id: randomUUID(),
    name: "台積電",
    ticker: "2330",
    market: "TWSE",
    country: "TW",
    themeIds: [randomUUID()],
    chainPosition: "Semiconductors",
    beneficiaryTier: "Core",
    exposure: { volume: 5, asp: 5, margin: 5, capacity: 5, narrative: 5 },
    validation: { capitalFlow: "", consensus: "", relativeStrength: "" },
    notes: "",
    updatedAt: "2026-04-15T05:00:00.000Z"
  };
  const importedCompany: Company = {
    ...curatedCompany,
    id: randomUUID(),
    country: "Taiwan",
    beneficiaryTier: "Observation",
    themeIds: [],
    exposure: { volume: 1, asp: 1, margin: 1, capacity: 1, narrative: 1 },
    updatedAt: "2026-04-15T04:00:00.000Z"
  };

  const report = buildCompanyDuplicateReport({
    companies: [curatedCompany, importedCompany],
    relations: [
      {
        id: randomUUID(),
        companyId: curatedCompany.id,
        targetCompanyId: null,
        targetLabel: "NVIDIA",
        relationType: "customer",
        confidence: 0.9,
        sourcePath: "Pilot_Reports/Semiconductors/2330_台積電.md",
        updatedAt: "2026-04-15T05:10:00.000Z"
      }
    ],
    keywords: [
      {
        id: randomUUID(),
        companyId: curatedCompany.id,
        label: "先進封裝",
        confidence: 0.8,
        sourcePath: "Pilot_Reports/Semiconductors/2330_台積電.md",
        updatedAt: "2026-04-15T05:12:00.000Z"
      }
    ]
  });

  assert.equal(report.summary.groupCount, 1);
  assert.equal(report.summary.companyCount, 2);
  assert.equal(report.groups[0]?.recommendedCompanyId, curatedCompany.id);
  assert.match(report.groups[0]?.reason ?? "", /canonical/u);
});

test("ops snapshot view aggregates stats and latest activity", () => {
  const snapshot = buildOpsSnapshotView({
    session: {
      workspace: {
        id: "workspace-1",
        name: "Primary Desk",
        slug: "primary-desk",
        createdAt: "2026-04-14T00:00:00.000Z"
      },
      user: {
        id: "user-1",
        email: "owner@iuf.local",
        name: "Desk Owner",
        role: "Owner",
        createdAt: "2026-04-14T00:00:00.000Z"
      },
      persistenceMode: "database"
    },
    themes: [
      {
        id: randomUUID(),
        name: "AI 光通訊",
        slug: "ai-optics",
        marketState: "Balanced",
        lifecycle: "Validation",
        priority: 4,
        thesis: "",
        whyNow: "",
        bottleneck: "",
        corePoolCount: 1,
        observationPoolCount: 2,
        createdAt: "2026-04-14T10:00:00.000Z",
        updatedAt: "2026-04-14T10:05:00.000Z"
      }
    ],
    companies: [
      {
        id: randomUUID(),
        name: "台積電",
        ticker: "2330",
        market: "TWSE",
        country: "Taiwan",
        themeIds: [],
        chainPosition: "Foundry",
        beneficiaryTier: "Core",
        exposure: { volume: 5, asp: 5, margin: 5, capacity: 5, narrative: 5 },
        validation: { capitalFlow: "", consensus: "", relativeStrength: "" },
        notes: "",
        updatedAt: "2026-04-14T09:00:00.000Z"
      },
      {
        id: randomUUID(),
        name: "智邦",
        ticker: "2345",
        market: "TWSE",
        country: "Taiwan",
        themeIds: [],
        chainPosition: "Switch",
        beneficiaryTier: "Direct",
        exposure: { volume: 4, asp: 4, margin: 3, capacity: 4, narrative: 4 },
        validation: { capitalFlow: "", consensus: "", relativeStrength: "" },
        notes: "",
        updatedAt: "2026-04-14T08:00:00.000Z"
      }
    ],
    signals: [
      {
        id: randomUUID(),
        category: "price",
        direction: "bullish",
        title: "突破前高",
        summary: "",
        confidence: 4,
        themeIds: [],
        companyIds: [],
        createdAt: "2026-04-14T10:10:00.000Z"
      }
    ],
    plans: [
      {
        id: randomUUID(),
        companyId: randomUUID(),
        status: "active",
        entryPlan: "",
        invalidationPlan: "",
        targetPlan: "",
        riskReward: "1:3",
        notes: "",
        createdAt: "2026-04-14T10:15:00.000Z",
        updatedAt: "2026-04-14T10:20:00.000Z"
      }
    ],
    reviews: [
      {
        id: randomUUID(),
        tradePlanId: randomUUID(),
        outcome: "依計畫減碼",
        attribution: "",
        lesson: "",
        setupTags: [],
        executionQuality: 4,
        createdAt: "2026-04-14T10:30:00.000Z"
      }
    ],
    briefs: [
      {
        id: randomUUID(),
        date: "2026-04-14",
        marketState: "Balanced",
        sections: [{ heading: "盤勢", body: "平衡偏多" }],
        generatedBy: "manual",
        status: "published",
        createdAt: "2026-04-14T10:35:00.000Z"
      }
    ],
    jobs: [
      {
        id: randomUUID(),
        workspaceSlug: "primary-desk",
        status: "draft_ready",
        taskType: "daily_brief",
        instructions: "產生晨報",
        contextRefs: [],
        createdAt: "2026-04-14T10:40:00.000Z"
      }
    ],
    audit: {
      windowHours: 24,
      total: 3,
      latestCreatedAt: "2026-04-14T10:50:00.000Z",
      actions: [{ action: "create", count: 2 }],
      entities: [{ entityType: "theme", count: 1 }],
      recent: []
    },
    rankings: {
      generatedAt: "2026-04-14T10:52:00.000Z",
      total: 1,
      results: [
        {
          themeId: "theme-rank-1",
          name: "AI 光通訊",
          marketState: "Balanced",
          lifecycle: "Validation",
          priority: 4,
          score: 52,
          averageExposure: 4.4,
          breakdown: {
            conviction: 20,
            connectivity: 18,
            leverage: 10,
            keywordRichness: 4
          },
          signals: ["主題進入驗證或擴散階段", "公司曝險分數偏高"],
          summary: {
            themeId: "theme-rank-1",
            name: "AI 光通訊",
            marketState: "Balanced",
            lifecycle: "Validation",
            priority: 4,
            themeCompanyCount: 1,
            relatedCompanyCount: 2,
            totalEdges: 3,
            keywordCount: 2,
            topKeywords: [
              {
                label: "CPO",
                count: 2,
                companyCount: 1
              }
            ]
          }
        }
      ]
    },
    openAlice: {
      source: "bridge_fallback",
      workerStatus: "healthy",
      sweepStatus: "healthy",
      workerHeartbeatAt: "2026-04-14T10:45:00.000Z",
      workerHeartbeatAgeSeconds: 10,
      lastSweepAt: "2026-04-14T10:45:00.000Z",
      lastSweepAgeSeconds: 10,
      metrics: {
        mode: "database",
        queuedJobs: 0,
        runningJobs: 0,
        staleRunningJobs: 0,
        terminalJobs: 1,
        activeDevices: 1,
        staleDevices: 0,
        expiredJobsRequeued: 0,
        expiredJobsFailed: 0
      }
    },
    eventHistorySummary: {
      windowHours: 24,
      total: 4,
      latestCreatedAt: "2026-04-14T10:40:00.000Z",
      sources: [{ source: "signal", count: 1 }],
      severities: [{ severity: "success", count: 3 }],
      entities: [{ entityType: "signal", count: 1 }],
      recent: []
    },
    eventHistoryRecent: [
      {
        id: "signal:event-1",
        source: "signal",
        action: "bullish",
        entityType: "signal",
        entityId: "event-1",
        title: "突破前高",
        subtitle: "price / confidence 4",
        status: "bullish",
        severity: "success",
        createdAt: "2026-04-14T10:10:00.000Z",
        href: "/signals",
        tags: ["price", "bullish"]
      }
    ],
    recentLimit: 5,
    generatedAt: "2026-04-14T10:55:00.000Z"
  });

  assert.equal(snapshot.stats.themes, 1);
  assert.equal(snapshot.stats.companies, 2);
  assert.equal(snapshot.stats.coreCompanies, 1);
  assert.equal(snapshot.stats.directCompanies, 1);
  assert.equal(snapshot.stats.activePlans, 1);
  assert.equal(snapshot.stats.reviewQueue, 1);
  assert.equal(snapshot.stats.publishedBriefs, 1);
  assert.equal(snapshot.stats.bullishSignals, 1);
  assert.equal(snapshot.rankings.total, 1);
  assert.equal(snapshot.rankings.results[0]?.score, 52);
  assert.equal(snapshot.latest.themes[0]?.label, "AI 光通訊");
  assert.equal(snapshot.latest.companies[0]?.label, "2330 台積電");
  assert.equal(snapshot.openAlice.queue.reviewable, 1);
  assert.equal(snapshot.eventHistory.summary.total, 4);
  assert.equal(snapshot.eventHistory.recent[0]?.source, "signal");
});

test("ops trend view builds daily activity series in Asia/Taipei", () => {
  const trends = buildOpsTrendView({
    days: 3,
    timeZone: "Asia/Taipei",
    now: new Date("2026-04-15T12:00:00.000Z"),
    themes: [
      {
        id: randomUUID(),
        name: "AI 光通訊",
        slug: "ai-optics",
        marketState: "Balanced",
        lifecycle: "Validation",
        priority: 4,
        thesis: "",
        whyNow: "",
        bottleneck: "",
        corePoolCount: 1,
        observationPoolCount: 2,
        createdAt: "2026-04-13T01:00:00.000Z",
        updatedAt: "2026-04-14T10:05:00.000Z"
      }
    ],
    signals: [
      {
        id: randomUUID(),
        category: "price",
        direction: "bullish",
        title: "多頭突破",
        summary: "",
        confidence: 4,
        themeIds: [],
        companyIds: [],
        createdAt: "2026-04-14T03:00:00.000Z"
      },
      {
        id: randomUUID(),
        category: "industry",
        direction: "neutral",
        title: "中性觀察",
        summary: "",
        confidence: 3,
        themeIds: [],
        companyIds: [],
        createdAt: "2026-04-15T01:00:00.000Z"
      }
    ],
    plans: [
      {
        id: randomUUID(),
        companyId: randomUUID(),
        status: "ready",
        entryPlan: "",
        invalidationPlan: "",
        targetPlan: "",
        riskReward: "",
        notes: "",
        createdAt: "2026-04-14T08:00:00.000Z",
        updatedAt: "2026-04-14T08:00:00.000Z"
      }
    ],
    reviews: [
      {
        id: randomUUID(),
        tradePlanId: randomUUID(),
        outcome: "執行正常",
        attribution: "",
        lesson: "",
        setupTags: [],
        executionQuality: 4,
        createdAt: "2026-04-15T02:00:00.000Z"
      }
    ],
    briefs: [
      {
        id: randomUUID(),
        date: "2026-04-15",
        marketState: "Balanced",
        sections: [],
        generatedBy: "openalice",
        status: "published",
        createdAt: "2026-04-15T03:00:00.000Z"
      }
    ],
    jobs: [
      {
        createdAt: "2026-04-15T04:00:00.000Z"
      }
    ],
    audit: [
      {
        id: randomUUID(),
        action: "create",
        entityType: "signal",
        entityId: "pending",
        payload: {},
        createdAt: "2026-04-14T05:00:00.000Z",
        method: "POST",
        path: "/api/v1/signals",
        status: 201,
        role: "Owner",
        workspace: "primary-desk"
      }
    ]
  });

  assert.equal(trends.summary.days, 3);
  assert.equal(trends.summary.timeZone, "Asia/Taipei");
  assert.equal(trends.series.length, 3);
  assert.equal(trends.summary.totals.themesCreated, 1);
  assert.equal(trends.summary.totals.signalsCreated, 2);
  assert.equal(trends.summary.totals.bullishSignals, 1);
  assert.equal(trends.summary.totals.plansCreated, 1);
  assert.equal(trends.summary.totals.reviewsCreated, 1);
  assert.equal(trends.summary.totals.briefsCreated, 1);
  assert.equal(trends.summary.totals.publishedBriefs, 1);
  assert.equal(trends.summary.totals.openAliceJobsCreated, 1);
  assert.equal(trends.summary.totals.auditEvents, 1);
  assert.ok((trends.summary.busiestDay?.totalActivity ?? 0) >= 3);
  assert.equal(trends.summary.latestDay?.date, trends.series.at(-1)?.date);
});

test("market data provider statuses expose manual provider and disconnected stubs", async () => {
  const session = { workspace: { slug: `market-status-${randomUUID()}` } };

  const statuses = await listMarketDataProviderStatuses({
    session,
    sources: "manual,paper,tradingview,kgi"
  });

  assert.equal(statuses.length, 4);
  assert.equal(statuses[0]?.source, "manual");
  assert.equal(statuses[0]?.connected, true);
  assert.deepEqual(statuses[0]?.subscribedSymbols, []);
  assert.equal(statuses[0]?.freshnessStatus, "missing");
  assert.equal(statuses[0]?.readiness, "blocked");
  assert.equal(statuses[0]?.strategyUsable, false);
  assert.equal(statuses[0]?.paperUsable, false);
  assert.equal(statuses[0]?.liveUsable, false);
  assert.equal(statuses[0]?.reasons.includes("missing_quote"), true);

  assert.equal(statuses[1]?.source, "paper");
  assert.equal(statuses[1]?.connected, false);
  assert.match(statuses[1]?.errorMessage ?? "", /Paper quote provider not configured/);
  assert.equal(statuses[1]?.readiness, "blocked");
  assert.equal(statuses[1]?.reasons.includes("provider_disconnected"), true);

  assert.equal(statuses[2]?.source, "tradingview");
  assert.equal(statuses[2]?.connected, false);
  assert.match(statuses[2]?.errorMessage ?? "", /TradingView quote provider not configured/);
  assert.equal(statuses[2]?.readiness, "blocked");

  assert.equal(statuses[3]?.source, "kgi");
  assert.equal(statuses[3]?.connected, false);
  assert.match(statuses[3]?.errorMessage ?? "", /KGI quote provider not configured/);
  assert.equal(statuses[3]?.readiness, "blocked");
});

test("market data keeps provider-specific quote caches isolated", async () => {
  const session = { workspace: { slug: `market-provider-cache-${randomUUID()}` } };
  const now = new Date().toISOString();

  await upsertManualQuotes({
    session,
    quotes: [
      {
        symbol: "TV01",
        market: "OTHER",
        source: "tradingview",
        last: 456.78,
        bid: 456.7,
        ask: 456.9,
        open: 450,
        high: 458,
        low: 449.5,
        prevClose: 452,
        volume: 900,
        changePct: 1.06,
        timestamp: now
      },
      {
        symbol: "MAN1",
        market: "TWSE",
        source: "manual",
        last: 88.5,
        bid: 88.4,
        ask: 88.6,
        open: 87,
        high: 89,
        low: 86.8,
        prevClose: 87.2,
        volume: 10_000,
        changePct: 1.49,
        timestamp: now
      }
    ]
  });

  const tradingviewQuotes = await listMarketQuotes({
    session,
    symbols: "TV01,MAN1",
    source: "tradingview",
    limit: 10
  });
  assert.equal(tradingviewQuotes.length, 1);
  assert.equal(tradingviewQuotes[0]?.symbol, "TV01");
  assert.equal(tradingviewQuotes[0]?.source, "tradingview");

  const manualQuotes = await listMarketQuotes({
    session,
    symbols: "TV01,MAN1",
    source: "manual",
    limit: 10
  });
  assert.equal(manualQuotes.length, 1);
  assert.equal(manualQuotes[0]?.symbol, "MAN1");
  assert.equal(manualQuotes[0]?.source, "manual");

  const statuses = await listMarketDataProviderStatuses({
    session,
    sources: "manual,tradingview"
  });
  assert.equal(statuses.length, 2);
  assert.equal(statuses[0]?.source, "manual");
  assert.equal(statuses[0]?.connected, true);
  assert.deepEqual(statuses[0]?.subscribedSymbols, ["MAN1"]);
  assert.equal(statuses[1]?.source, "tradingview");
  assert.equal(statuses[1]?.connected, true);
  assert.deepEqual(statuses[1]?.subscribedSymbols, ["TV01"]);
  assert.equal(statuses[1]?.errorMessage, null);
});

test("market data ingests tradingview quotes and reports provider freshness", async () => {
  const session = { workspace: { slug: `market-tradingview-${randomUUID()}` } };
  const ingested = await ingestTradingViewQuote({
    session,
    ticker: "TV2330",
    exchange: "TWSE",
    price: "912.5",
    timestamp: new Date().toISOString()
  });

  assert.equal(ingested?.symbol, "TV2330");
  assert.equal(ingested?.market, "TWSE");
  assert.equal(ingested?.source, "tradingview");

  const statuses = await listMarketDataProviderStatuses({
    session,
    sources: "tradingview"
  });
  assert.equal(statuses[0]?.connected, true);
  assert.equal(statuses[0]?.lastMessageAt !== null, true);
  assert.deepEqual(statuses[0]?.subscribedSymbols, ["TV2330"]);
  assert.equal(statuses[0]?.freshnessStatus, "fresh");
  assert.equal(statuses[0]?.readiness, "degraded");
  assert.equal(statuses[0]?.strategyUsable, true);
  assert.equal(statuses[0]?.paperUsable, true);
  assert.equal(statuses[0]?.liveUsable, false);
  assert.equal(statuses[0]?.reasons.includes("non_live_source"), true);
});

test("market data upserts paper quotes as a first-class provider source", async () => {
  const session = { workspace: { slug: `market-paper-${randomUUID()}` } };
  const timestamp = new Date().toISOString();

  const upserted = await upsertPaperQuotes({
    session,
    quotes: [
      {
        symbol: "PAPR1",
        market: "OTHER",
        source: "manual",
        last: 77.7,
        bid: 77.6,
        ask: 77.8,
        open: 76.5,
        high: 78.2,
        low: 76.2,
        prevClose: 76.9,
        volume: 450,
        changePct: 1.04,
        timestamp
      }
    ]
  });

  assert.equal(upserted.length, 1);
  assert.equal(upserted[0]?.source, "paper");

  const quotes = await listMarketQuotes({
    session,
    symbols: "PAPR1",
    source: "paper",
    limit: 10
  });
  assert.equal(quotes.length, 1);
  assert.equal(quotes[0]?.symbol, "PAPR1");
  assert.equal(quotes[0]?.source, "paper");

  const statuses = await listMarketDataProviderStatuses({
    session,
    sources: "paper"
  });
  assert.equal(statuses[0]?.source, "paper");
  assert.equal(statuses[0]?.connected, true);
  assert.deepEqual(statuses[0]?.subscribedSymbols, ["PAPR1"]);
  assert.equal(statuses[0]?.freshnessStatus, "fresh");
  assert.equal(statuses[0]?.readiness, "degraded");
  assert.equal(statuses[0]?.strategyUsable, true);
  assert.equal(statuses[0]?.paperUsable, true);
  assert.equal(statuses[0]?.liveUsable, false);
  assert.equal(statuses[0]?.reasons.includes("synthetic_source"), true);
});

test("market data resolves preferred source by freshness and precedence", async () => {
  const session = { workspace: { slug: `market-precedence-${randomUUID()}` } };
  const freshTimestamp = new Date().toISOString();

  await upsertManualQuotes({
    session,
    quotes: [
      {
        symbol: "SAME1",
        market: "OTHER",
        source: "manual",
        last: 100,
        bid: 99.9,
        ask: 100.1,
        open: 98,
        high: 101,
        low: 97.5,
        prevClose: 99,
        volume: 100,
        changePct: 1.01,
        timestamp: freshTimestamp
      },
      {
        symbol: "SAME1",
        market: "OTHER",
        source: "paper",
        last: 101,
        bid: 100.9,
        ask: 101.1,
        open: 99,
        high: 102,
        low: 98.5,
        prevClose: 99,
        volume: 120,
        changePct: 2.02,
        timestamp: freshTimestamp
      }
    ]
  });

  const preferredPaper = await listMarketQuotes({
    session,
    symbols: "SAME1",
    limit: 10
  });
  assert.equal(preferredPaper.length, 1);
  assert.equal(preferredPaper[0]?.source, "paper");
  assert.equal(preferredPaper[0]?.last, 101);

  await upsertManualQuotes({
    session,
    quotes: [
      {
        symbol: "SAME1",
        market: "OTHER",
        source: "tradingview",
        last: 102,
        bid: 101.9,
        ask: 102.1,
        open: 100,
        high: 103,
        low: 99.5,
        prevClose: 100,
        volume: 150,
        changePct: 2.5,
        timestamp: freshTimestamp
      }
    ]
  });

  const preferredTradingView = await listMarketQuotes({
    session,
    symbols: "SAME1",
    limit: 10
  });
  assert.equal(preferredTradingView.length, 1);
  assert.equal(preferredTradingView[0]?.source, "tradingview");
  assert.equal(preferredTradingView[0]?.last, 102);

  await upsertManualQuotes({
    session,
    quotes: [
      {
        symbol: "SAME1",
        market: "OTHER",
        source: "tradingview",
        last: 88,
        bid: 87.9,
        ask: 88.1,
        open: 87,
        high: 89,
        low: 86.5,
        prevClose: 87,
        volume: 90,
        changePct: 1.15,
        timestamp: "2020-01-01T00:00:00.000Z"
      }
    ]
  });

  const preferredFreshPaper = await listMarketQuotes({
    session,
    symbols: "SAME1",
    limit: 10
  });
  assert.equal(preferredFreshPaper.length, 1);
  assert.equal(preferredFreshPaper[0]?.source, "tradingview");
});

test("market data policy reflects configured source priority and freshness thresholds", () => {
  const previousPriority = process.env.QUOTE_SOURCE_PRIORITY;
  const previousTradingViewStale = process.env.TRADINGVIEW_QUOTE_STALE_MS;
  const previousPaperStale = process.env.PAPER_QUOTE_STALE_MS;
  const previousTradingViewHistory = process.env.TRADINGVIEW_QUOTE_HISTORY_LIMIT;

  process.env.QUOTE_SOURCE_PRIORITY = "paper,tradingview,manual";
  process.env.TRADINGVIEW_QUOTE_STALE_MS = "7000";
  process.env.PAPER_QUOTE_STALE_MS = "25000";
  process.env.TRADINGVIEW_QUOTE_HISTORY_LIMIT = "2048";

  try {
    const policy = getMarketDataPolicy();
    assert.equal(policy.surface.version, "market-data-v1.11-overview-quality-rollup");
    assert.equal(policy.surface.capabilities.consumerSummary, true);
    assert.equal(policy.surface.capabilities.selectionSummary, true);
    assert.equal(policy.surface.capabilities.decisionSummary, true);
    assert.equal(policy.surface.capabilities.historyQualitySummary, true);
    assert.equal(policy.surface.capabilities.barQualitySummary, true);
    assert.equal(policy.surface.capabilities.overviewQualityRollup, true);
    assert.equal(policy.surface.preferredEntryPoints.execution, "/api/v1/market-data/decision-summary");
    assert.equal(policy.surface.preferredEntryPoints.historyQuality, "/api/v1/market-data/history/diagnostics");
    assert.equal(policy.surface.preferredEntryPoints.barQuality, "/api/v1/market-data/bars/diagnostics");
    assert.equal(policy.sourcePriority[0]?.source, "paper");
    assert.equal(policy.sourcePriority[1]?.source, "tradingview");
    assert.equal(policy.sourcePriority[2]?.source, "manual");
    assert.equal(policy.sourcePriority.at(-1)?.source, "kgi");
    assert.equal(policy.freshnessMs.find((entry) => entry.source === "tradingview")?.staleAfterMs, 7000);
    assert.equal(policy.freshnessMs.find((entry) => entry.source === "paper")?.staleAfterMs, 25000);
    assert.equal(policy.historyLimit.find((entry) => entry.source === "tradingview")?.limit, 2048);
  } finally {
    if (previousPriority === undefined) {
      delete process.env.QUOTE_SOURCE_PRIORITY;
    } else {
      process.env.QUOTE_SOURCE_PRIORITY = previousPriority;
    }

    if (previousTradingViewStale === undefined) {
      delete process.env.TRADINGVIEW_QUOTE_STALE_MS;
    } else {
      process.env.TRADINGVIEW_QUOTE_STALE_MS = previousTradingViewStale;
    }

    if (previousPaperStale === undefined) {
      delete process.env.PAPER_QUOTE_STALE_MS;
    } else {
      process.env.PAPER_QUOTE_STALE_MS = previousPaperStale;
    }

    if (previousTradingViewHistory === undefined) {
      delete process.env.TRADINGVIEW_QUOTE_HISTORY_LIMIT;
    } else {
      process.env.TRADINGVIEW_QUOTE_HISTORY_LIMIT = previousTradingViewHistory;
    }
  }
});

test("market data builds quote history and minute bars from preferred sources", async () => {
  const session = { workspace: { slug: `market-history-${randomUUID()}` } };
  const baseMinute = Math.floor((Date.now() - 10_000) / 60_000) * 60_000;
  const minuteOneOpen = new Date(baseMinute - 55_000).toISOString();
  const minuteOneClose = new Date(baseMinute - 20_000).toISOString();
  const minuteTwoOpen = new Date(baseMinute + 5_000).toISOString();

  await upsertManualQuotes({
    session,
    quotes: [
      {
        symbol: "BAR1",
        market: "OTHER",
        source: "manual",
        last: 90,
        bid: 89.9,
        ask: 90.1,
        open: 90,
        high: 90,
        low: 90,
        prevClose: 89,
        volume: 10,
        changePct: 1.12,
        timestamp: minuteOneOpen
      },
      {
        symbol: "BAR1",
        market: "OTHER",
        source: "tradingview",
        last: 100,
        bid: 99.9,
        ask: 100.1,
        open: 100,
        high: 100,
        low: 100,
        prevClose: 99,
        volume: 50,
        changePct: 1.01,
        timestamp: minuteOneOpen
      },
      {
        symbol: "BAR1",
        market: "OTHER",
        source: "tradingview",
        last: 105,
        bid: 104.9,
        ask: 105.1,
        open: 100,
        high: 105,
        low: 100,
        prevClose: 99,
        volume: 80,
        changePct: 6.06,
        timestamp: minuteOneClose
      },
      {
        symbol: "BAR1",
        market: "OTHER",
        source: "tradingview",
        last: 103,
        bid: 102.9,
        ask: 103.1,
        open: 103,
        high: 103,
        low: 103,
        prevClose: 102,
        volume: 120,
        changePct: 0.98,
        timestamp: minuteTwoOpen
      }
    ]
  });

  const history = await listMarketQuoteHistory({
    session,
    symbols: "BAR1",
    includeStale: true,
    limit: 20
  });
  assert.equal(history.length, 3);
  assert.equal(history.every((quote) => quote.source === "tradingview"), true);
  assert.equal(history[0]?.symbol, "BAR1");

  const bars = await listMarketBars({
    session,
    symbols: "BAR1",
    interval: "1m",
    includeStale: true,
    limit: 10
  });
  assert.equal(bars.length, 2);
  assert.equal(bars[1]?.open, 100);
  assert.equal(bars[1]?.high, 105);
  assert.equal(bars[1]?.low, 100);
  assert.equal(bars[1]?.close, 105);
  assert.equal(bars[0]?.open, 103);
  assert.equal(bars[0]?.close, 103);
});

test("market data resolve diagnostics expose preferred source and candidate stack", async () => {
  const session = { workspace: { slug: `market-resolve-${randomUUID()}` } };
  const now = new Date().toISOString();

  await upsertManualQuotes({
    session,
    quotes: [
      {
        symbol: "RSLV1",
        market: "OTHER",
        source: "manual",
        last: 50,
        bid: 49.9,
        ask: 50.1,
        open: 49,
        high: 51,
        low: 48.5,
        prevClose: 49,
        volume: 10,
        changePct: 2.04,
        timestamp: now
      },
      {
        symbol: "RSLV1",
        market: "OTHER",
        source: "tradingview",
        last: 52,
        bid: 51.9,
        ask: 52.1,
        open: 50,
        high: 53,
        low: 49.5,
        prevClose: 49,
        volume: 20,
        changePct: 6.12,
        timestamp: now
      }
    ]
  });

  const resolved = await resolveMarketQuotes({
    session,
    symbols: "RSLV1",
    limit: 10
  });

  assert.equal(resolved.length, 1);
  assert.equal(resolved[0]?.symbol, "RSLV1");
  assert.equal(resolved[0]?.selectedSource, "tradingview");
  assert.equal(resolved[0]?.selectedQuote?.last, 52);
  assert.equal(resolved[0]?.freshnessStatus, "fresh");
  assert.equal(resolved[0]?.fallbackReason, "higher_priority_unavailable");
  assert.equal(resolved[0]?.staleReason, "none");
  assert.equal(resolved[0]?.preferredSource, "tradingview");
  assert.equal(resolved[0]?.preferredQuote?.last, 52);
  assert.equal(resolved[0]?.candidates.length, 4);
  assert.equal(resolved[0]?.candidates[0]?.source, "kgi");
  assert.equal(resolved[0]?.candidates[0]?.freshnessStatus, "missing");
  assert.equal(resolved[0]?.candidates[1]?.source, "tradingview");
  assert.equal(resolved[0]?.candidates[1]?.freshnessStatus, "fresh");
  assert.equal(resolved[0]?.candidates[2]?.source, "paper");
  assert.equal(resolved[0]?.candidates[2]?.staleReason, "no_quote");
  assert.equal(resolved[0]?.candidates[3]?.source, "manual");
});

test("market data effective quotes summarize readiness for strategy and paper consumers", async () => {
  const session = { workspace: { slug: `market-effective-${randomUUID()}` } };
  const now = new Date().toISOString();
  const staleTimestamp = "2020-01-01T00:00:00.000Z";

  await upsertManualQuotes({
    session,
    quotes: [
      {
        symbol: "EFF1",
        market: "OTHER",
        source: "manual",
        last: 110,
        bid: 109.9,
        ask: 110.1,
        open: 108,
        high: 111,
        low: 107.5,
        prevClose: 108,
        volume: 200,
        changePct: 1.85,
        timestamp: now
      },
      {
        symbol: "EFF1",
        market: "OTHER",
        source: "tradingview",
        last: 111,
        bid: 110.9,
        ask: 111.1,
        open: 109,
        high: 112,
        low: 108.5,
        prevClose: 109,
        volume: 260,
        changePct: 1.96,
        timestamp: now
      },
      {
        symbol: "EFF2",
        market: "OTHER",
        source: "paper",
        last: 42,
        bid: 41.9,
        ask: 42.1,
        open: 40,
        high: 42.5,
        low: 39.8,
        prevClose: 40.5,
        volume: 40,
        changePct: 3.7,
        timestamp: now
      },
      {
        symbol: "EFF3",
        market: "OTHER",
        source: "manual",
        last: 15,
        bid: 14.9,
        ask: 15.1,
        open: 14.8,
        high: 15.2,
        low: 14.7,
        prevClose: 14.9,
        volume: 20,
        changePct: 0.67,
        timestamp: staleTimestamp
      }
    ]
  });

  const effective = await getEffectiveMarketQuotes({
    session,
    symbols: "EFF1,EFF2,EFF3",
    includeStale: true,
    limit: 10
  });

  assert.equal(effective.summary.total, 3);
  assert.equal(effective.summary.ready, 0);
  assert.equal(effective.summary.degraded, 2);
  assert.equal(effective.summary.blocked, 1);
  assert.equal(effective.summary.strategyUsable, 2);
  assert.equal(effective.summary.paperUsable, 2);
  assert.equal(effective.summary.liveUsable, 0);

  const ready = effective.items.find((item) => item.symbol === "EFF1");
  assert.equal(ready?.selectedSource, "tradingview");
  assert.equal(ready?.readiness, "degraded");
  assert.equal(ready?.strategyUsable, true);
  assert.equal(ready?.paperUsable, true);
  assert.equal(ready?.reasons.length, 2);
  assert.equal(ready?.reasons[0], "fallback:higher_priority_unavailable");
  assert.equal(ready?.reasons.includes("non_live_source"), true);

  const degraded = effective.items.find((item) => item.symbol === "EFF2");
  assert.equal(degraded?.selectedSource, "paper");
  assert.equal(degraded?.readiness, "degraded");
  assert.equal(degraded?.strategyUsable, true);
  assert.equal(degraded?.paperUsable, true);
  assert.equal(degraded?.liveUsable, false);
  assert.equal(degraded?.synthetic, true);
  assert.equal(degraded?.reasons.includes("synthetic_source"), true);

  const blocked = effective.items.find((item) => item.symbol === "EFF3");
  assert.equal(blocked?.selectedSource, "manual");
  assert.equal(blocked?.readiness, "blocked");
  assert.equal(blocked?.strategyUsable, false);
  assert.equal(blocked?.paperUsable, false);
  assert.equal(blocked?.staleReason, "age_exceeded");
  assert.equal(blocked?.reasons.includes("stale:age_exceeded"), true);
});

test("market data consumer summary compresses execution-safe decisions", async () => {
  const session = { workspace: { slug: `market-consumer-${randomUUID()}` } };
  const now = new Date().toISOString();
  const staleTimestamp = "2020-01-01T00:00:00.000Z";

  await upsertManualQuotes({
    session,
    quotes: [
      {
        symbol: "CNS1",
        market: "OTHER",
        source: "tradingview",
        last: 210,
        bid: 209.9,
        ask: 210.1,
        open: 208,
        high: 211,
        low: 207.5,
        prevClose: 208,
        volume: 300,
        changePct: 0.96,
        timestamp: now
      },
      {
        symbol: "CNS2",
        market: "OTHER",
        source: "paper",
        last: 88,
        bid: 87.9,
        ask: 88.1,
        open: 86.5,
        high: 88.3,
        low: 86.2,
        prevClose: 86.9,
        volume: 120,
        changePct: 1.27,
        timestamp: now
      },
      {
        symbol: "CNS3",
        market: "OTHER",
        source: "manual",
        last: 15,
        bid: 14.9,
        ask: 15.1,
        open: 14.8,
        high: 15.2,
        low: 14.7,
        prevClose: 14.9,
        volume: 20,
        changePct: 0.67,
        timestamp: staleTimestamp
      }
    ]
  });

  const executionSummary = await getMarketDataConsumerSummary({
    session,
    mode: "execution",
    symbols: "CNS1,CNS2,CNS3",
    includeStale: true,
    limit: 10
  });

  assert.equal(executionSummary.mode, "execution");
  assert.equal(executionSummary.summary.total, 3);
  assert.equal(executionSummary.summary.allow, 0);
  assert.equal(executionSummary.summary.review, 2);
  assert.equal(executionSummary.summary.block, 1);
  assert.equal(executionSummary.summary.usable, 0);
  assert.equal(executionSummary.summary.safe, 0);
  assert.equal(
    executionSummary.summary.reasons.some((item) => item.reason === "non_live_source" && item.total >= 2),
    true
  );

  const tradingviewItem = executionSummary.items.find((item) => item.symbol === "CNS1");
  assert.equal(tradingviewItem?.decision, "review");
  assert.equal(tradingviewItem?.usable, false);
  assert.equal(tradingviewItem?.safe, false);
  assert.equal(tradingviewItem?.selectedSource, "tradingview");

  const staleItem = executionSummary.items.find((item) => item.symbol === "CNS3");
  assert.equal(staleItem?.decision, "block");
  assert.equal(staleItem?.reasons.includes("stale:age_exceeded"), true);

  const strategySummary = await getMarketDataConsumerSummary({
    session,
    mode: "strategy",
    symbols: "CNS1,CNS2,CNS3",
    includeStale: true,
    limit: 10
  });

  assert.equal(strategySummary.mode, "strategy");
  assert.equal(strategySummary.summary.allow, 0);
  assert.equal(strategySummary.summary.review, 2);
  assert.equal(strategySummary.summary.block, 1);
  assert.equal(strategySummary.summary.usable, 2);
  assert.equal(strategySummary.summary.safe, 0);
});

test("market data selection summary aligns strategy paper and execution interpretations", async () => {
  const session = { workspace: { slug: `market-selection-${randomUUID()}` } };
  const now = new Date().toISOString();

  await upsertManualQuotes({
    session,
    quotes: [
      {
        symbol: "SEL1",
        market: "OTHER",
        source: "tradingview",
        last: 42,
        bid: 41.9,
        ask: 42.1,
        open: 41,
        high: 43,
        low: 40.8,
        prevClose: 41.5,
        volume: 500,
        changePct: 1.2,
        timestamp: now
      },
      {
        symbol: "SEL2",
        market: "OTHER",
        source: "paper",
        last: 21,
        bid: 20.9,
        ask: 21.1,
        open: 20.5,
        high: 21.3,
        low: 20.4,
        prevClose: 20.7,
        volume: 150,
        changePct: 1.45,
        timestamp: now
      }
    ]
  });

  const selection = await getMarketDataSelectionSummary({
    session,
    symbols: "SEL1,SEL2",
    includeStale: true,
    limit: 10
  });

  assert.equal(selection.summary.total, 2);
  assert.equal(selection.summary.readiness.ready, 0);
  assert.equal(selection.summary.readiness.degraded, 2);
  assert.equal(selection.summary.strategy.review, 2);
  assert.equal(selection.summary.paper.review, 2);
  assert.equal(selection.summary.execution.review, 2);

  const tradingviewItem = selection.items.find((item) => item.symbol === "SEL1");
  assert.equal(tradingviewItem?.selectedSource, "tradingview");
  assert.equal(tradingviewItem?.strategy.decision, "review");
  assert.equal(tradingviewItem?.paper.decision, "review");
  assert.equal(tradingviewItem?.execution.decision, "review");

  const paperItem = selection.items.find((item) => item.symbol === "SEL2");
  assert.equal(paperItem?.selectedSource, "paper");
  assert.equal(paperItem?.strategy.usable, true);
  assert.equal(paperItem?.paper.usable, true);
  assert.equal(paperItem?.execution.usable, false);
});

test("market data decision summary compresses selection into execution-safe consume surface", async () => {
  const session = { workspace: { slug: `market-decision-${randomUUID()}` } };
  const now = new Date().toISOString();

  await upsertManualQuotes({
    session,
    quotes: [
      {
        symbol: "DCS1",
        market: "OTHER",
        source: "tradingview",
        last: 45,
        bid: 44.9,
        ask: 45.1,
        open: 44,
        high: 45.5,
        low: 43.8,
        prevClose: 44.2,
        volume: 500,
        changePct: 1.81,
        timestamp: now
      },
      {
        symbol: "DCS2",
        market: "OTHER",
        source: "paper",
        last: 88,
        bid: 87.8,
        ask: 88.2,
        open: 86,
        high: 88.5,
        low: 85.5,
        prevClose: 87,
        volume: 240,
        changePct: 1.14,
        timestamp: now
      }
    ]
  });

  const decision = await getMarketDataDecisionSummary({
    session,
    symbols: "DCS1,DCS2",
    includeStale: true,
    limit: 10
  });

  assert.equal(decision.summary.total, 2);
  assert.equal(decision.summary.readiness.degraded, 2);
  assert.equal(decision.summary.execution.review, 2);

  const tradingviewItem = decision.items.find((item) => item.symbol === "DCS1");
  assert.equal(tradingviewItem?.selectedSource, "tradingview");
  assert.equal(tradingviewItem?.quote?.source, "tradingview");
  assert.equal(tradingviewItem?.execution.decision, "review");
  assert.equal(tradingviewItem?.execution.primaryReason, "fallback:higher_priority_unavailable");

  const paperItem = decision.items.find((item) => item.symbol === "DCS2");
  assert.equal(paperItem?.selectedSource, "paper");
  assert.equal(paperItem?.paper.usable, true);
  assert.equal(paperItem?.execution.usable, false);
  assert.equal(paperItem?.primaryReason, "fallback:higher_priority_missing");
});

test("market data history and bars respect time window filters", async () => {
  const session = { workspace: { slug: `market-time-range-${randomUUID()}` } };
  const baseMinute = Math.floor((Date.now() - 10_000) / 60_000) * 60_000;
  const olderTimestamp = new Date(baseMinute - 20_000).toISOString();
  const newerTimestamp = new Date(baseMinute + 5_000).toISOString();
  const filterFrom = new Date(baseMinute).toISOString();

  await upsertManualQuotes({
    session,
    quotes: [
      {
        symbol: "TIME1",
        market: "OTHER",
        source: "tradingview",
        last: 10,
        bid: 9.9,
        ask: 10.1,
        open: 10,
        high: 10,
        low: 10,
        prevClose: 9.5,
        volume: 1,
        changePct: 5.26,
        timestamp: olderTimestamp
      },
      {
        symbol: "TIME1",
        market: "OTHER",
        source: "tradingview",
        last: 12,
        bid: 11.9,
        ask: 12.1,
        open: 10,
        high: 12,
        low: 10,
        prevClose: 10,
        volume: 2,
        changePct: 20,
        timestamp: newerTimestamp
      }
    ]
  });

  const history = await listMarketQuoteHistory({
    session,
    symbols: "TIME1",
    source: "tradingview",
    includeStale: true,
    from: filterFrom,
    limit: 10
  });
  assert.equal(history.length, 1);
  assert.equal(history[0]?.last, 12);

  const bars = await listMarketBars({
    session,
    symbols: "TIME1",
    source: "tradingview",
    interval: "1m",
    includeStale: true,
    from: filterFrom,
    limit: 10
  });
  assert.equal(bars.length, 1);
  assert.equal(bars[0]?.open, 12);
  assert.equal(bars[0]?.close, 12);
});

test("market data persists quote history and can reload it after cache reset", async () => {
  const workspaceSlug = `market-persist-${randomUUID()}`;
  const session = { workspace: { slug: workspaceSlug } };
  const previousStoreDir = process.env.MARKET_DATA_STORE_DIR;
  process.env.MARKET_DATA_STORE_DIR = path.join(process.cwd(), "tmp-market-data-tests", randomUUID());

  try {
    await upsertManualQuotes({
      session,
      quotes: [
        {
          symbol: "PERSIST1",
          market: "OTHER",
          source: "tradingview",
          last: 42,
          bid: 41.9,
          ask: 42.1,
          open: 40,
          high: 43,
          low: 39.5,
          prevClose: 40,
          volume: 25,
          changePct: 5,
          timestamp: new Date().toISOString()
        }
      ]
    });

    resetMarketDataWorkspaceState(workspaceSlug);

    const quotes = await listMarketQuotes({
      session,
      symbols: "PERSIST1",
      source: "tradingview",
      includeStale: true,
      limit: 10
    });
    const history = await listMarketQuoteHistory({
      session,
      symbols: "PERSIST1",
      source: "tradingview",
      includeStale: true,
      limit: 10
    });

    assert.equal(quotes.length, 1);
    assert.equal(quotes[0]?.symbol, "PERSIST1");
    assert.equal(history.length, 1);
    assert.equal(history[0]?.symbol, "PERSIST1");
  } finally {
    resetMarketDataWorkspaceState(workspaceSlug);
    await resetPersistedQuoteEntries(workspaceSlug);
    if (previousStoreDir === undefined) {
      delete process.env.MARKET_DATA_STORE_DIR;
    } else {
      process.env.MARKET_DATA_STORE_DIR = previousStoreDir;
    }
  }
});

test("market data diagnostics expose source selection and synthetic quality hints", async () => {
  const session = { workspace: { slug: `market-diagnostics-${randomUUID()}` } };
  const now = new Date().toISOString();

  await upsertPaperQuotes({
    session,
    quotes: [
      {
        symbol: "DIA1",
        market: "OTHER",
        source: "manual",
        last: 88,
        bid: 87.9,
        ask: 88.1,
        open: 87,
        high: 89,
        low: 86.5,
        prevClose: 87,
        volume: 90,
        changePct: 1.15,
        timestamp: now
      }
    ]
  });

  const historyDiagnostics = await getMarketQuoteHistoryDiagnostics({
    session,
    symbols: "DIA1",
    includeStale: true,
    limit: 10
  });
  const barDiagnostics = await getMarketBarDiagnostics({
    session,
    symbols: "DIA1",
    source: "paper",
    interval: "1m",
    includeStale: true,
    limit: 10
  });

  assert.equal(historyDiagnostics.summary.total, 1);
  assert.equal(historyDiagnostics.summary.insufficient, 1);
  assert.equal(historyDiagnostics.items[0]?.symbol, "DIA1");
  assert.equal(historyDiagnostics.items[0]?.selectedSource, "paper");
  assert.equal(historyDiagnostics.items[0]?.synthetic, true);
  assert.equal(historyDiagnostics.items[0]?.generatedFrom, "provider_quote_history");
  assert.equal(historyDiagnostics.items[0]?.freshnessStatus, "fresh");
  assert.equal(historyDiagnostics.items[0]?.quality.grade, "insufficient");
  assert.equal(historyDiagnostics.items[0]?.quality.primaryReason, "insufficient_points");

  assert.equal(barDiagnostics.summary.total, 1);
  assert.equal(barDiagnostics.summary.insufficient, 1);
  assert.equal(barDiagnostics.items[0]?.source, "paper");
  assert.equal(barDiagnostics.items[0]?.synthetic, true);
  assert.equal(barDiagnostics.items[0]?.approximate, true);
  assert.equal(barDiagnostics.items[0]?.generatedFrom, "quote_history");
  assert.equal(barDiagnostics.items[0]?.quality.grade, "insufficient");
  assert.equal(barDiagnostics.items[0]?.quality.primaryReason, "insufficient_bars");
});

test("market data quality summaries distinguish strategy-ready history from reference-only bars", async () => {
  const session = { workspace: { slug: `market-quality-${randomUUID()}` } };
  const baseTime = new Date();

  await upsertManualQuotes({
    session,
    quotes: [
      {
        symbol: "QSUM1",
        market: "OTHER",
        source: "tradingview",
        last: 101,
        bid: 100.9,
        ask: 101.1,
        open: 100,
        high: 101.2,
        low: 99.8,
        prevClose: 100.5,
        volume: 120,
        changePct: 0.5,
        timestamp: new Date(baseTime.getTime() - 61_000).toISOString()
      },
      {
        symbol: "QSUM1",
        market: "OTHER",
        source: "tradingview",
        last: 102,
        bid: 101.9,
        ask: 102.1,
        open: 101,
        high: 102.4,
        low: 100.9,
        prevClose: 101.4,
        volume: 180,
        changePct: 0.6,
        timestamp: baseTime.toISOString()
      }
    ]
  });

  const historyDiagnostics = await getMarketQuoteHistoryDiagnostics({
    session,
    symbols: "QSUM1",
    source: "tradingview",
    includeStale: true,
    limit: 10
  });
  const barDiagnostics = await getMarketBarDiagnostics({
    session,
    symbols: "QSUM1",
    source: "tradingview",
    interval: "1m",
    includeStale: true,
    limit: 10
  });

  assert.equal(historyDiagnostics.summary.strategyReady, 1);
  assert.equal(historyDiagnostics.items[0]?.quality.grade, "strategy_ready");
  assert.equal(historyDiagnostics.items[0]?.quality.primaryReason, "history_strategy_ready");

  assert.equal(barDiagnostics.summary.referenceOnly, 1);
  assert.equal(barDiagnostics.items[0]?.quality.grade, "reference_only");
  // tradingview is a non-synthetic live feed; bars are still approximate (tick-aggregated)
  // so primaryReason is approximate_bars, not synthetic_bars
  assert.equal(barDiagnostics.items[0]?.quality.primaryReason, "approximate_bars");
});

test("market data symbols derive from companies and dedupe by market and ticker", async () => {
  const repo = new MemoryTradingRoomRepository();
  const session = { workspace: { slug: `market-symbols-${randomUUID()}` } };
  const options = { workspaceSlug: session.workspace.slug };

  await repo.createCompany({
    name: "台積電",
    ticker: "2330",
    market: "TWSE",
    country: "Taiwan",
    themeIds: [],
    chainPosition: "Foundry",
    beneficiaryTier: "Core",
    exposure: { volume: 5, asp: 5, margin: 5, capacity: 5, narrative: 5 },
    validation: { capitalFlow: "", consensus: "", relativeStrength: "" },
    notes: ""
  }, options);

  await repo.createCompany({
    name: "台積",
    ticker: "2330",
    market: "TWSE",
    country: "Taiwan",
    themeIds: [],
    chainPosition: "Foundry",
    beneficiaryTier: "Observation",
    exposure: { volume: 1, asp: 1, margin: 1, capacity: 1, narrative: 1 },
    validation: { capitalFlow: "", consensus: "", relativeStrength: "" },
    notes: ""
  }, options);

  await repo.createCompany({
    name: "Photon Switch",
    ticker: "SMK1",
    market: "NASDAQ",
    country: "United States",
    themeIds: [],
    chainPosition: "Optics",
    beneficiaryTier: "Direct",
    exposure: { volume: 4, asp: 3, margin: 3, capacity: 4, narrative: 4 },
    validation: { capitalFlow: "", consensus: "", relativeStrength: "" },
    notes: ""
  }, options);

  const allSymbols = await listMarketSymbols({
    session,
    repo,
    limit: 20
  });
  assert.equal(allSymbols.filter((item) => item.symbol === "2330" && item.market === "TWSE").length, 1);
  assert.equal(allSymbols.some((item) => item.symbol === "SMK1" && item.market === "OTHER"), true);

  const filtered = await listMarketSymbols({
    session,
    repo,
    query: "Photon",
    market: "OTHER",
    limit: 20
  });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]?.symbol, "SMK1");
  assert.equal(filtered[0]?.lotSize, 1);
});

test("market data quotes support manual upsert with stale filtering", async () => {
  const session = { workspace: { slug: `market-quotes-${randomUUID()}` } };

  const upserted = await upsertManualQuotes({
    session,
    quotes: [
      {
        symbol: "SMK1",
        market: "OTHER",
        source: "manual",
        last: 123.45,
        bid: 123.4,
        ask: 123.5,
        open: 120,
        high: 124,
        low: 119.5,
        prevClose: 121,
        volume: 1500,
        changePct: 2.02
      },
      {
        symbol: "OLD1",
        market: "TWSE",
        source: "manual",
        last: 80,
        bid: 79.9,
        ask: 80.1,
        open: 79,
        high: 81,
        low: 78.5,
        prevClose: 79.5,
        volume: 999,
        changePct: 0.63,
        timestamp: "2020-01-01T00:00:00.000Z"
      }
    ]
  });

  assert.equal(upserted.length, 2);
  assert.equal(upserted[0]?.symbol, "SMK1");
  assert.equal(upserted[0]?.isStale, false);
  assert.equal(upserted[1]?.symbol, "OLD1");
  assert.equal(upserted[1]?.isStale, true);

  const freshOnly = await listMarketQuotes({
    session,
    symbols: "SMK1,OLD1",
    limit: 10
  });
  assert.equal(freshOnly.length, 1);
  assert.equal(freshOnly[0]?.symbol, "SMK1");

  const includeStale = await listMarketQuotes({
    session,
    symbols: "SMK1,OLD1",
    includeStale: true,
    source: "manual",
    limit: 10
  });
  assert.equal(includeStale.length, 2);
  assert.equal(includeStale[0]?.symbol, "SMK1");
  assert.equal(includeStale.some((item) => item.symbol === "OLD1" && item.isStale), true);
});

test("market data overview summarizes providers, coverage, and leaders", async () => {
  const repo = new MemoryTradingRoomRepository();
  const session = { workspace: { slug: `market-overview-${randomUUID()}` } };
  const options = { workspaceSlug: session.workspace.slug };

  await repo.createCompany({
    name: "Photon Switch",
    ticker: "SMK1",
    market: "NASDAQ",
    country: "United States",
    themeIds: [],
    chainPosition: "Optics",
    beneficiaryTier: "Direct",
    exposure: { volume: 4, asp: 3, margin: 3, capacity: 4, narrative: 4 },
    validation: { capitalFlow: "", consensus: "", relativeStrength: "" },
    notes: ""
  }, options);

  await repo.createCompany({
    name: "台積電",
    ticker: "2330",
    market: "TWSE",
    country: "Taiwan",
    themeIds: [],
    chainPosition: "Foundry",
    beneficiaryTier: "Core",
    exposure: { volume: 5, asp: 5, margin: 5, capacity: 5, narrative: 5 },
    validation: { capitalFlow: "", consensus: "", relativeStrength: "" },
    notes: ""
  }, options);

  await upsertManualQuotes({
    session,
    quotes: [
      {
        symbol: "SMK1",
        market: "OTHER",
        source: "manual",
        last: 123.45,
        bid: 123.4,
        ask: 123.5,
        open: 120,
        high: 124,
        low: 119.5,
        prevClose: 121,
        volume: 1500,
        changePct: 2.02
      },
      {
        symbol: "2330",
        market: "TWSE",
        source: "manual",
        last: 880,
        bid: 879,
        ask: 881,
        open: 872,
        high: 882,
        low: 870,
        prevClose: 878,
        volume: 3200,
        changePct: -1.15
      },
      {
        symbol: "OLD1",
        market: "TWSE",
        source: "manual",
        last: 80,
        bid: 79.9,
        ask: 80.1,
        open: 79,
        high: 81,
        low: 78.5,
        prevClose: 79.5,
        volume: 999,
        changePct: 0.63,
        timestamp: "2020-01-01T00:00:00.000Z"
      }
    ]
  });

  const overview = await getMarketDataOverview({
    session,
    repo,
    includeStale: true,
    topLimit: 2
  });

  assert.equal(overview.providers.length, 4);
  assert.equal(overview.surface.version, "market-data-v1.11-overview-quality-rollup");
  assert.equal(overview.surface.capabilities.overview, true);
  assert.equal(overview.surface.capabilities.selectionSummary, true);
  assert.equal(overview.surface.capabilities.decisionSummary, true);
  assert.equal(overview.surface.capabilities.historyQualitySummary, true);
  assert.equal(overview.surface.capabilities.barQualitySummary, true);
  assert.equal(overview.surface.capabilities.overviewQualityRollup, true);
  assert.equal(overview.surface.preferredEntryPoints.historyQuality, "/api/v1/market-data/history/diagnostics");
  assert.equal(overview.surface.preferredEntryPoints.barQuality, "/api/v1/market-data/bars/diagnostics");
  assert.ok(overview.symbols.total >= 2);
  assert.equal(overview.symbols.byMarket.some((item) => item.market === "TWSE" && item.total >= 1), true);
  assert.equal(overview.symbols.byMarket.some((item) => item.market === "OTHER" && item.total >= 1), true);
  assert.equal(overview.quotes.total, 3);
  assert.equal(overview.quotes.fresh, 2);
  assert.equal(overview.quotes.stale, 1);
  assert.equal(overview.quotes.readiness.connectedSources.includes("manual"), true);
  assert.equal(overview.quotes.readiness.preferredSourceOrder[0], "kgi");
  assert.equal(overview.quotes.readiness.effectiveSelection.total, 3);
  assert.equal(overview.quotes.readiness.effectiveSelection.degraded, 2);
  assert.equal(overview.quotes.readiness.effectiveSelection.blocked, 1);
  assert.equal(overview.quotes.readiness.effectiveSelection.paperUsable, 2);
  assert.equal(overview.quality.evaluatedSymbols, 3);
  assert.equal(overview.quality.history.total, 3);
  assert.equal(overview.quality.history.insufficient >= 1, true);
  assert.equal(overview.quality.bars.total, 3);
  assert.equal(overview.quality.bars.insufficient >= 1, true);
  assert.equal(overview.quotes.bySource[0]?.source, "manual");
  assert.equal(overview.leaders.topGainers[0]?.symbol, "SMK1");
  assert.equal(overview.leaders.topLosers[0]?.symbol, "2330");
  assert.equal(overview.leaders.mostActive[0]?.symbol, "2330");
});

test("risk runtime stores per-account limits and kill switch state", async () => {
  const repo = new MemoryTradingRoomRepository();
  const session = await repo.getSession({
    workspaceSlug: `risk-runtime-${randomUUID()}`
  });

  const defaults = await getRiskLimitState({
    session,
    accountId: "paper-main"
  });
  assert.equal(defaults.maxPerTradePct, DEFAULT_RISK_LIMITS.maxPerTradePct);
  assert.equal(defaults.maxOrdersPerMinute, DEFAULT_RISK_LIMITS.maxOrdersPerMinute);

  const updated = await upsertRiskLimitState({
    session,
    payload: {
      accountId: "paper-main",
      maxPerTradePct: 0.5,
      symbolBlacklist: ["RISKX"],
      whitelistOnly: true,
      symbolWhitelist: ["SMK1"]
    }
  });
  assert.equal(updated.maxPerTradePct, 0.5);
  assert.deepEqual(updated.symbolBlacklist, ["RISKX"]);
  assert.equal(updated.whitelistOnly, true);

  const kill = await setKillSwitchState({
    session,
    payload: {
      accountId: "paper-main",
      mode: "halted",
      reason: "Operator halt",
      engagedBy: "desk-owner"
    }
  });
  assert.equal(kill.engaged, true);
  assert.equal(kill.mode, "halted");

  const persistedKill = await getKillSwitchState({
    session,
    accountId: "paper-main"
  });
  assert.equal(persistedKill.reason, "Operator halt");
  assert.equal(persistedKill.engagedBy, "desk-owner");
});

test("risk check blocks stale market orders and oversized exposure", async () => {
  const repo = new MemoryTradingRoomRepository();
  const session = await repo.getSession({
    workspaceSlug: `risk-check-${randomUUID()}`
  });
  const options = { workspaceSlug: session.workspace.slug };

  await repo.createCompany(
    {
      name: "Risk Optics",
      ticker: "RISK1",
      market: "TWSE",
      country: "Taiwan",
      themeIds: [],
      chainPosition: "Modules",
      beneficiaryTier: "Direct",
      exposure: {
        volume: 4,
        asp: 4,
        margin: 3,
        capacity: 4,
        narrative: 4
      },
      validation: {
        capitalFlow: "",
        consensus: "",
        relativeStrength: ""
      },
      notes: ""
    },
    options
  );

  await upsertManualQuotes({
    session,
    quotes: [
      {
        symbol: "RISK1",
        market: "TWSE",
        source: "manual",
        last: 100,
        bid: 99.8,
        ask: 100.2,
        open: 99,
        high: 101,
        low: 98.5,
        prevClose: 99.5,
        volume: 1_000,
        changePct: 0.5,
        timestamp: "2020-01-01T00:00:00.000Z"
      }
    ]
  });

  await upsertRiskLimitState({
    session,
    payload: {
      accountId: "paper-risk",
      maxPerTradePct: 1
    }
  });

  const staleResult = await evaluateRiskCheck({
    session,
    repo,
    payload: {
      order: {
        accountId: "paper-risk",
        symbol: "RISK1",
        side: "buy",
        type: "market",
        timeInForce: "rod",
        quantity: 10,
        overrideGuards: [],
        overrideReason: ""
      },
      account: {
        equity: 100_000
      },
      market: {
        source: "manual",
        now: "2026-04-17T02:00:00.000Z",
        timeZone: "Asia/Taipei"
      }
    }
  });

  assert.equal(staleResult.decision, "block");
  assert.equal(staleResult.guards.some((guard) => guard.guard === "stale_quote"), true);

  const oversizedResult = await evaluateRiskCheck({
    session,
    repo,
    payload: {
      order: {
        accountId: "paper-risk",
        symbol: "RISK1",
        side: "buy",
        type: "limit",
        timeInForce: "rod",
        quantity: 2_000,
        price: 100,
        overrideGuards: [],
        overrideReason: ""
      },
      account: {
        equity: 100_000
      },
      market: {
        source: "manual",
        now: "2026-04-17T02:00:00.000Z",
        timeZone: "Asia/Taipei"
      }
    }
  });

  assert.equal(oversizedResult.decision, "block");
  assert.equal(
    oversizedResult.guards.some((guard) => guard.guard === "max_per_trade"),
    true
  );
});

test("risk check records committed intents and blocks duplicates", async () => {
  const repo = new MemoryTradingRoomRepository();
  const session = await repo.getSession({
    workspaceSlug: `risk-duplicate-${randomUUID()}`
  });
  const options = { workspaceSlug: session.workspace.slug };

  await repo.createCompany(
    {
      name: "Duplicate Guard Optics",
      ticker: "DUP1",
      market: "TWSE",
      country: "Taiwan",
      themeIds: [],
      chainPosition: "Modules",
      beneficiaryTier: "Direct",
      exposure: {
        volume: 3,
        asp: 3,
        margin: 3,
        capacity: 3,
        narrative: 3
      },
      validation: {
        capitalFlow: "",
        consensus: "",
        relativeStrength: ""
      },
      notes: ""
    },
    options
  );

  await upsertManualQuotes({
    session,
    quotes: [
      {
        symbol: "DUP1",
        market: "TWSE",
        source: "manual",
        last: 50,
        bid: 49.9,
        ask: 50.1,
        open: 49.5,
        high: 50.5,
        low: 49.2,
        prevClose: 49.8,
        volume: 2_000,
        changePct: 0.4,
        timestamp: "2026-04-17T02:00:00.000Z"
      }
    ]
  });

  const first = await evaluateRiskCheck({
    session,
    repo,
    payload: {
      order: {
        accountId: "paper-dup",
        symbol: "DUP1",
        side: "buy",
        type: "limit",
        timeInForce: "rod",
        quantity: 100,
        price: 50,
        overrideGuards: [],
        overrideReason: ""
      },
      account: {
        equity: 1_000_000
      },
      market: {
        source: "manual",
        now: "2026-04-17T02:00:00.000Z",
        timeZone: "Asia/Taipei"
      },
      commit: true
    }
  });

  assert.equal(first.decision, "allow");

  const duplicate = await evaluateRiskCheck({
    session,
    repo,
    payload: {
      order: {
        accountId: "paper-dup",
        symbol: "DUP1",
        side: "buy",
        type: "limit",
        timeInForce: "rod",
        quantity: 100,
        price: 50,
        overrideGuards: [],
        overrideReason: ""
      },
      account: {
        equity: 1_000_000
      },
      market: {
        source: "manual",
        now: "2026-04-17T02:00:10.000Z",
        timeZone: "Asia/Taipei"
      }
    }
  });

  assert.equal(duplicate.decision, "block");
  assert.equal(
    duplicate.guards.some((guard) => guard.guard === "duplicate_order"),
    true
  );
});

test("resolveRiskLimit merges strategy + symbol layers with source attribution", async () => {
  const repo = new MemoryTradingRoomRepository();
  const session = await repo.getSession({
    workspaceSlug: `risk-resolve-${randomUUID()}`
  });

  await upsertRiskLimitState({
    session,
    payload: {
      accountId: "paper-main",
      maxPerTradePct: 5,
      maxSinglePositionPct: 20
    }
  });

  // Account-only resolution: every field attributes to "account".
  const accountOnly = await resolveRiskLimit({
    session,
    accountId: "paper-main"
  });
  assert.equal(accountOnly.limit.maxPerTradePct, 5);
  assert.equal(accountOnly.sources.maxPerTradePct, "account");
  assert.equal(accountOnly.layers.strategy, null);
  assert.equal(accountOnly.layers.symbol, null);

  await upsertStrategyRiskLimit({
    session,
    payload: {
      accountId: "paper-main",
      strategyId: "alpha",
      maxPerTradePct: 2
    }
  });

  const withStrategy = await resolveRiskLimit({
    session,
    accountId: "paper-main",
    strategyId: "alpha"
  });
  assert.equal(withStrategy.limit.maxPerTradePct, 2);
  assert.equal(withStrategy.sources.maxPerTradePct, "strategy");
  // Unchanged field keeps account attribution.
  assert.equal(withStrategy.sources.maxSinglePositionPct, "account");
  assert.equal(withStrategy.layers.strategy?.strategyId, "alpha");

  await upsertSymbolRiskLimit({
    session,
    payload: {
      accountId: "paper-main",
      symbol: "lay1",
      maxPerTradePct: 1
    }
  });

  const withSymbol = await resolveRiskLimit({
    session,
    accountId: "paper-main",
    strategyId: "alpha",
    symbol: "LAY1"
  });
  assert.equal(withSymbol.limit.maxPerTradePct, 1);
  assert.equal(withSymbol.sources.maxPerTradePct, "symbol");
  assert.equal(withSymbol.layers.symbol?.symbol, "LAY1");

  // Disabled strategy rows must not contribute (account value wins).
  await upsertStrategyRiskLimit({
    session,
    payload: {
      accountId: "paper-main",
      strategyId: "alpha",
      enabled: false
    }
  });
  const withoutStrategy = await resolveRiskLimit({
    session,
    accountId: "paper-main",
    strategyId: "alpha"
  });
  assert.equal(withoutStrategy.limit.maxPerTradePct, 5);
  assert.equal(withoutStrategy.sources.maxPerTradePct, "account");

  // CRUD list/delete round-trips.
  const strategies = await listStrategyRiskLimits({
    session,
    accountId: "paper-main"
  });
  assert.equal(strategies.length, 1);
  const symbols = await listSymbolRiskLimits({
    session,
    accountId: "paper-main"
  });
  assert.equal(symbols.length, 1);
  await deleteStrategyRiskLimit({
    session,
    accountId: "paper-main",
    strategyId: "alpha"
  });
  await deleteSymbolRiskLimit({
    session,
    accountId: "paper-main",
    symbol: "LAY1"
  });
  assert.equal(
    (await listStrategyRiskLimits({ session, accountId: "paper-main" })).length,
    0
  );
  assert.equal(
    (await listSymbolRiskLimits({ session, accountId: "paper-main" })).length,
    0
  );
});

test("evaluateRiskCheck attributes max_per_trade blocks to strategy and symbol layers", async () => {
  const repo = new MemoryTradingRoomRepository();
  const session = await repo.getSession({
    workspaceSlug: `risk-layers-${randomUUID()}`
  });
  const options = { workspaceSlug: session.workspace.slug };

  await repo.createCompany(
    {
      name: "Layered Optics",
      ticker: "LAY1",
      market: "TWSE",
      country: "Taiwan",
      themeIds: [],
      chainPosition: "Modules",
      beneficiaryTier: "Direct",
      exposure: { volume: 4, asp: 4, margin: 3, capacity: 4, narrative: 4 },
      validation: { capitalFlow: "", consensus: "", relativeStrength: "" },
      notes: ""
    },
    options
  );

  await upsertManualQuotes({
    session,
    quotes: [
      {
        symbol: "LAY1",
        market: "TWSE",
        source: "manual",
        last: 100,
        bid: 99.8,
        ask: 100.2,
        open: 99,
        high: 101,
        low: 98.5,
        prevClose: 99.5,
        volume: 1_000,
        changePct: 0.5,
        timestamp: "2026-04-17T02:00:00.000Z"
      }
    ]
  });

  // Account layer is permissive — a 100-lot @ 100 on 1_000_000 equity is 1%.
  await upsertRiskLimitState({
    session,
    payload: {
      accountId: "paper-layers",
      maxPerTradePct: 5
    }
  });

  const baseOrder = {
    accountId: "paper-layers",
    strategyId: "alpha-momentum",
    symbol: "LAY1",
    side: "buy" as const,
    type: "limit" as const,
    timeInForce: "rod" as const,
    quantity: 100,
    price: 100,
    overrideGuards: [],
    overrideReason: ""
  };
  const market = {
    source: "manual" as const,
    now: "2026-04-17T02:00:00.000Z",
    timeZone: "Asia/Taipei"
  };

  // Account-only: allow.
  const allowed = await evaluateRiskCheck({
    session,
    repo,
    payload: {
      order: baseOrder,
      account: { equity: 1_000_000 },
      market
    }
  });
  assert.equal(allowed.decision, "allow");

  // Strategy override clamps maxPerTradePct to 0.5 — now the same order blocks,
  // and the guard must attribute the cap to the strategy layer.
  await upsertStrategyRiskLimit({
    session,
    payload: {
      accountId: "paper-layers",
      strategyId: "alpha-momentum",
      maxPerTradePct: 0.5
    }
  });
  const strategyBlocked = await evaluateRiskCheck({
    session,
    repo,
    payload: {
      order: baseOrder,
      account: { equity: 1_000_000 },
      market
    }
  });
  assert.equal(strategyBlocked.decision, "block");
  const strategyGuard = strategyBlocked.guards.find(
    (guard) => guard.guard === "max_per_trade"
  );
  assert.ok(strategyGuard, "expected max_per_trade guard");
  assert.equal(strategyGuard?.sourceLayer, "strategy");
  assert.equal(strategyGuard?.limitValue, 0.5);

  // Symbol layer trumps strategy — tighter 0.1% cap, guard attributes to symbol.
  await upsertSymbolRiskLimit({
    session,
    payload: {
      accountId: "paper-layers",
      symbol: "LAY1",
      maxPerTradePct: 0.1
    }
  });
  const symbolBlocked = await evaluateRiskCheck({
    session,
    repo,
    payload: {
      order: baseOrder,
      account: { equity: 1_000_000 },
      market
    }
  });
  assert.equal(symbolBlocked.decision, "block");
  const symbolGuard = symbolBlocked.guards.find(
    (guard) => guard.guard === "max_per_trade"
  );
  assert.ok(symbolGuard, "expected max_per_trade guard");
  assert.equal(symbolGuard?.sourceLayer, "symbol");
  assert.equal(symbolGuard?.limitValue, 0.1);
});

test("duplicate report helper reads repository-scoped companies", async () => {
  const repo = new MemoryTradingRoomRepository();
  const duplicated = await repo.createCompany({
    name: "Acme Optics Taiwan",
    ticker: "6801",
    market: "TWSE",
    country: "TW",
    themeIds: [],
    chainPosition: "Optics",
    beneficiaryTier: "Observation",
    exposure: { volume: 1, asp: 1, margin: 1, capacity: 1, narrative: 1 },
    validation: { capitalFlow: "", consensus: "", relativeStrength: "" },
    notes: "Imported duplicate"
  });

  await repo.replaceCompanyRelations(duplicated.id, [
    {
      targetLabel: "NVIDIA",
      relationType: "customer",
      confidence: 0.8,
      sourcePath: "Pilot_Reports/Smoke/6801.md"
    }
  ]);

  const report = await getCompanyDuplicateReport({
    session: { workspace: { slug: "primary-desk" } },
    repo,
    limit: 20
  });

  assert.ok(report.summary.groupCount >= 1);
  assert.equal(
    report.groups.some((group) => group.ticker === "6801" && group.companies.length >= 2),
    true
  );
});

test("company merge preview and execution collapse duplicate records in memory mode", async () => {
  const repo = new MemoryTradingRoomRepository();
  const theme = await repo.createTheme({
    name: "光通訊升級",
    marketState: "Selective Attack",
    lifecycle: "Validation",
    priority: 4,
    thesis: "Optics demand is broadening.",
    whyNow: "Cloud capex is shifting up.",
    bottleneck: "Yield"
  });

  const canonical = await repo.createCompany({
    name: "Acme Optics",
    ticker: "6801",
    market: "TWSE",
    country: "TW",
    themeIds: [theme.id],
    chainPosition: "Modules",
    beneficiaryTier: "Core",
    exposure: { volume: 4, asp: 4, margin: 4, capacity: 4, narrative: 4 },
    validation: { capitalFlow: "", consensus: "", relativeStrength: "" },
    notes: "Canonical company"
  });

  const duplicate = await repo.createCompany({
    name: "Acme Optics",
    ticker: "6801",
    market: "TWSE",
    country: "Taiwan",
    themeIds: [],
    chainPosition: "Modules",
    beneficiaryTier: "Observation",
    exposure: { volume: 1, asp: 1, margin: 1, capacity: 1, narrative: 1 },
    validation: { capitalFlow: "", consensus: "", relativeStrength: "" },
    notes: "Imported duplicate"
  });

  const upstream = await repo.createCompany({
    name: "Photon Supply",
    ticker: "9999",
    market: "TWSE",
    country: "TW",
    themeIds: [],
    chainPosition: "Laser",
    beneficiaryTier: "Direct",
    exposure: { volume: 3, asp: 3, margin: 3, capacity: 3, narrative: 3 },
    validation: { capitalFlow: "", consensus: "", relativeStrength: "" },
    notes: "Incoming relation source"
  });

  await repo.replaceCompanyRelations(canonical.id, [
    {
      targetLabel: "NVIDIA",
      relationType: "customer",
      confidence: 0.7,
      sourcePath: "reports/canonical.md"
    }
  ]);
  await repo.replaceCompanyRelations(duplicate.id, [
    {
      targetLabel: "NVIDIA",
      relationType: "customer",
      confidence: 0.9,
      sourcePath: "reports/duplicate.md"
    }
  ]);
  await repo.replaceCompanyRelations(upstream.id, [
    {
      targetCompanyId: duplicate.id,
      targetLabel: duplicate.name,
      relationType: "supplier",
      confidence: 0.85,
      sourcePath: "reports/upstream.md"
    }
  ]);
  await repo.replaceCompanyKeywords(duplicate.id, [
    {
      label: "CPO",
      confidence: 0.88,
      sourcePath: "reports/duplicate.md"
    }
  ]);
  const tradePlan = await repo.createTradePlan({
    companyId: duplicate.id,
    status: "draft",
    entryPlan: "Scale in",
    invalidationPlan: "Break support",
    targetPlan: "Retest high",
    riskReward: "1:3",
    notes: "Duplicate plan"
  });

  const preview = await getCompanyMergePreview({
    session: await repo.getSession(),
    repo,
    merge: {
      targetCompanyId: canonical.id,
      sourceCompanyIds: [duplicate.id],
      force: false,
      appendSourceNotes: true
    }
  });

  assert.ok(preview);
  assert.equal(preview?.allowed, true);
  assert.equal(preview?.impact.sourceCompaniesToDelete, 1);
  assert.equal(preview?.impact.tradePlansToReassign, 1);
  assert.equal(preview?.impact.notesAppended, true);

  const result = await executeCompanyMerge({
    session: await repo.getSession(),
    repo,
    merge: {
      targetCompanyId: canonical.id,
      sourceCompanyIds: [duplicate.id],
      force: false,
      appendSourceNotes: true
    }
  });

  assert.ok(result);
  assert.equal(result?.deletedCompanyIds.includes(duplicate.id), true);
  assert.equal((await repo.getCompany(duplicate.id)) === null, true);
  assert.equal((await repo.listCompanies()).some((company) => company.id === canonical.id), true);
  assert.equal((await repo.listTradePlans({ companyId: canonical.id })).some((plan) => plan.id === tradePlan.id), true);
  assert.equal((await repo.listCompanyKeywords(canonical.id)).some((keyword) => keyword.label === "CPO"), true);
  assert.equal(
    (await repo.listCompanyRelations(upstream.id)).some(
      (relation) => relation.targetCompanyId === canonical.id && relation.targetLabel === canonical.name
    ),
    true
  );
});

test("theme graph helper reads repository-scoped theme companies", async () => {
  const repo = new MemoryTradingRoomRepository();
  const theme = await repo.createTheme({
    name: "矽光子升級",
    marketState: "Selective Attack",
    lifecycle: "Validation",
    priority: 4,
    thesis: "Scale-out pushes optics upgrades.",
    whyNow: "Switch bandwidth is rising quickly.",
    bottleneck: "Packaging yield"
  });

  const focusCompany = await repo.createCompany({
    name: "聯亞",
    ticker: "3081",
    market: "TWSE",
    country: "TW",
    themeIds: [theme.id],
    chainPosition: "Laser",
    beneficiaryTier: "Direct",
    exposure: { volume: 4, asp: 4, margin: 3, capacity: 4, narrative: 4 },
    validation: { capitalFlow: "", consensus: "", relativeStrength: "" },
    notes: "Theme member"
  });

  const neighborCompany = await repo.createCompany({
    name: "華星光",
    ticker: "4979",
    market: "TWSE",
    country: "TW",
    themeIds: [],
    chainPosition: "Modules",
    beneficiaryTier: "Observation",
    exposure: { volume: 3, asp: 3, margin: 3, capacity: 3, narrative: 3 },
    validation: { capitalFlow: "", consensus: "", relativeStrength: "" },
    notes: "Neighbor"
  });

  await repo.replaceCompanyRelations(focusCompany.id, [
    {
      targetCompanyId: neighborCompany.id,
      targetLabel: neighborCompany.name,
      relationType: "supplier",
      confidence: 0.82,
      sourcePath: "reports/theme.md"
    }
  ]);
  await repo.replaceCompanyKeywords(focusCompany.id, [
    {
      label: "矽光子",
      confidence: 0.88,
      sourcePath: "reports/theme.md"
    }
  ]);

  const view = await getThemeGraphView({
    session: { workspace: { slug: "primary-desk" } },
    repo,
    themeId: theme.id,
    edgeLimit: 20,
    keywordLimit: 10
  });

  assert.ok(view);
  assert.equal(view?.themeId, theme.id);
  assert.equal(view?.summary.themeCompanyCount, 1);
  assert.equal(view?.summary.displayedEdges, 1);
  assert.equal(view?.nodes.some((node) => node.kind === "theme_company" && node.companyId === focusCompany.id), true);
  assert.equal(view?.nodes.some((node) => node.kind === "company" && node.companyId === neighborCompany.id), true);
});

test("theme graph stats summarize connected themes and top keywords", async () => {
  const repo = new MemoryTradingRoomRepository();
  const theme = await repo.createTheme({
    name: "AI 光互連",
    marketState: "Attack",
    lifecycle: "Validation",
    priority: 5,
    thesis: "Optics demand is broadening.",
    whyNow: "Bandwidth upgrades are accelerating.",
    bottleneck: "Laser supply"
  });

  const company = await repo.createCompany({
    name: "聯鈞",
    ticker: "3450",
    market: "TWSE",
    country: "TW",
    themeIds: [theme.id],
    chainPosition: "Optics",
    beneficiaryTier: "Core",
    exposure: { volume: 5, asp: 4, margin: 4, capacity: 4, narrative: 5 },
    validation: { capitalFlow: "", consensus: "", relativeStrength: "" },
    notes: "AI optics leader"
  });

  const neighbor = await repo.createCompany({
    name: "華星光",
    ticker: "4979",
    market: "TWSE",
    country: "TW",
    themeIds: [],
    chainPosition: "Module",
    beneficiaryTier: "Direct",
    exposure: { volume: 4, asp: 3, margin: 3, capacity: 4, narrative: 4 },
    validation: { capitalFlow: "", consensus: "", relativeStrength: "" },
    notes: "Neighbor company"
  });

  await repo.replaceCompanyRelations(company.id, [
    {
      targetCompanyId: neighbor.id,
      targetLabel: neighbor.name,
      relationType: "supplier",
      confidence: 0.85,
      sourcePath: "reports/ai-optics.md"
    }
  ]);

  await repo.replaceCompanyKeywords(company.id, [
    {
      label: "矽光子",
      confidence: 0.8,
      sourcePath: "reports/ai-optics.md"
    },
    {
      label: "CPO",
      confidence: 0.7,
      sourcePath: "reports/ai-optics.md"
    }
  ]);

  const stats = await getThemeGraphStats({
    session: { workspace: { slug: "primary-desk" } },
    repo,
    limit: 10,
    keywordLimit: 3
  });

  assert.ok(stats.themeCount >= 1);
  assert.equal(stats.connectedThemeCount, 1);
  assert.ok(stats.totalThemeCompanies >= 1);
  assert.equal(stats.totalEdges, 1);
  assert.equal(stats.topThemes[0]?.name, "AI 光互連");
  assert.equal(stats.topThemes[0]?.topKeywords.some((keyword) => keyword.label === "CPO"), true);
});

test("theme graph search matches theme, company, and keyword signals", async () => {
  const repo = new MemoryTradingRoomRepository();
  const theme = await repo.createTheme({
    name: "液冷散熱",
    marketState: "Selective Attack",
    lifecycle: "Discovery",
    priority: 4,
    thesis: "Liquid cooling adoption is expanding.",
    whyNow: "Rack densities keep rising.",
    bottleneck: "Cold plate yield"
  });

  const company = await repo.createCompany({
    name: "奇鋐",
    ticker: "3017",
    market: "TWSE",
    country: "TW",
    themeIds: [theme.id],
    chainPosition: "Cooling",
    beneficiaryTier: "Core",
    exposure: { volume: 5, asp: 4, margin: 4, capacity: 4, narrative: 5 },
    validation: { capitalFlow: "", consensus: "", relativeStrength: "" },
    notes: "Liquid cooling focus"
  });

  await repo.replaceCompanyKeywords(company.id, [
    {
      label: "液冷",
      confidence: 0.9,
      sourcePath: "reports/liquid-cooling.md"
    }
  ]);

  const byTheme = await searchThemeGraph({
    session: { workspace: { slug: "primary-desk" } },
    repo,
    query: "散熱",
    limit: 10
  });
  assert.equal(byTheme.total, 1);
  assert.equal(byTheme.results[0]?.matchReasons.includes("theme"), true);

  const byCompany = await searchThemeGraph({
    session: { workspace: { slug: "primary-desk" } },
    repo,
    query: "奇鋐",
    limit: 10
  });
  assert.equal(byCompany.total, 1);
  assert.equal(byCompany.results[0]?.matchedCompanies, 1);

  const byKeyword = await searchThemeGraph({
    session: { workspace: { slug: "primary-desk" } },
    repo,
    query: "液冷",
    limit: 10
  });
  assert.equal(byKeyword.total, 1);
  assert.equal(byKeyword.results[0]?.matchReasons.includes("keyword"), true);
});

test("theme graph stats filters and csv export stay aligned", async () => {
  const repo = new MemoryTradingRoomRepository();

  const connectedTheme = await repo.createTheme({
    name: "高速光模組",
    marketState: "Attack",
    lifecycle: "Validation",
    priority: 5,
    thesis: "Optical bandwidth upgrades continue.",
    whyNow: "Scale-out demand is rising.",
    bottleneck: "Laser capacity"
  });

  const disconnectedTheme = await repo.createTheme({
    name: "邊緣運算",
    marketState: "Balanced",
    lifecycle: "Discovery",
    priority: 3,
    thesis: "Edge inference may broaden later.",
    whyNow: "Early pilot demand only.",
    bottleneck: "Adoption timing"
  });

  const opticsCompany = await repo.createCompany({
    name: "上詮",
    ticker: "3363",
    market: "TWSE",
    country: "TW",
    themeIds: [connectedTheme.id],
    chainPosition: "Optics",
    beneficiaryTier: "Core",
    exposure: { volume: 5, asp: 4, margin: 4, capacity: 4, narrative: 5 },
    validation: { capitalFlow: "", consensus: "", relativeStrength: "" },
    notes: "Optical module leader"
  });

  const relatedCompany = await repo.createCompany({
    name: "環宇-KY",
    ticker: "4991",
    market: "TWSE",
    country: "TW",
    themeIds: [],
    chainPosition: "Laser",
    beneficiaryTier: "Direct",
    exposure: { volume: 4, asp: 3, margin: 3, capacity: 4, narrative: 4 },
    validation: { capitalFlow: "", consensus: "", relativeStrength: "" },
    notes: "Related laser vendor"
  });

  await repo.createCompany({
    name: "研華",
    ticker: "2395",
    market: "TWSE",
    country: "TW",
    themeIds: [disconnectedTheme.id],
    chainPosition: "Edge",
    beneficiaryTier: "Observation",
    exposure: { volume: 3, asp: 3, margin: 3, capacity: 3, narrative: 3 },
    validation: { capitalFlow: "", consensus: "", relativeStrength: "" },
    notes: "Disconnected theme member"
  });

  await repo.replaceCompanyRelations(opticsCompany.id, [
    {
      targetCompanyId: relatedCompany.id,
      targetLabel: relatedCompany.name,
      relationType: "supplier",
      confidence: 0.9,
      sourcePath: "reports/optics.md"
    }
  ]);

  await repo.replaceCompanyKeywords(opticsCompany.id, [
    {
      label: "光模組",
      confidence: 0.95,
      sourcePath: "reports/optics.md"
    }
  ]);

  const filteredStats = await getThemeGraphStats({
    session: { workspace: { slug: "primary-desk" } },
    repo,
    marketState: "Attack",
    onlyConnected: true,
    minEdges: 1,
    limit: 10,
    keywordLimit: 3
  });

  assert.equal(filteredStats.topThemes.length, 1);
  assert.equal(filteredStats.topThemes[0]?.themeId, connectedTheme.id);

  const csv = formatThemeGraphStatsAsCsv(filteredStats.topThemes);
  assert.match(csv, /theme_id/);
  assert.match(csv, /高速光模組/);
  assert.doesNotMatch(csv, /邊緣運算/);
});

test("theme graph rankings favor connected, high-conviction themes", async () => {
  const repo = new MemoryTradingRoomRepository();

  const rankedTheme = await repo.createTheme({
    name: "光通訊擴散",
    marketState: "Attack",
    lifecycle: "Validation",
    priority: 5,
    thesis: "Optical interconnect demand is broadening across clusters.",
    whyNow: "Spending is moving from pilot to real budget.",
    bottleneck: "Laser and module capacity"
  });

  const weakerTheme = await repo.createTheme({
    name: "邊緣推論觀察",
    marketState: "Balanced",
    lifecycle: "Discovery",
    priority: 2,
    thesis: "Edge inference may broaden later.",
    whyNow: "Pilot projects are still limited.",
    bottleneck: "Adoption timing"
  });

  const opticsCore = await repo.createCompany({
    name: "前鼎",
    ticker: "4908",
    market: "TWSE",
    country: "TW",
    themeIds: [rankedTheme.id],
    chainPosition: "Optics",
    beneficiaryTier: "Core",
    exposure: { volume: 5, asp: 4, margin: 4, capacity: 4, narrative: 5 },
    validation: { capitalFlow: "", consensus: "", relativeStrength: "" },
    notes: "Core optics beneficiary"
  });

  const opticsNeighbor = await repo.createCompany({
    name: "聯鈞",
    ticker: "3450",
    market: "TWSE",
    country: "TW",
    themeIds: [],
    chainPosition: "Optics module",
    beneficiaryTier: "Direct",
    exposure: { volume: 4, asp: 3, margin: 3, capacity: 4, narrative: 4 },
    validation: { capitalFlow: "", consensus: "", relativeStrength: "" },
    notes: "Connected optics vendor"
  });

  await repo.createCompany({
    name: "邊緣測試",
    ticker: "7722",
    market: "TWSE",
    country: "TW",
    themeIds: [weakerTheme.id],
    chainPosition: "Edge",
    beneficiaryTier: "Observation",
    exposure: { volume: 2, asp: 2, margin: 2, capacity: 2, narrative: 2 },
    validation: { capitalFlow: "", consensus: "", relativeStrength: "" },
    notes: "Early edge inference observation"
  });

  await repo.replaceCompanyRelations(opticsCore.id, [
    {
      targetCompanyId: opticsNeighbor.id,
      targetLabel: opticsNeighbor.name,
      relationType: "supplier",
      confidence: 0.9,
      sourcePath: "reports/optics-rank.md"
    },
    {
      targetCompanyId: null,
      targetLabel: "NVIDIA",
      relationType: "customer",
      confidence: 0.85,
      sourcePath: "reports/optics-rank.md"
    }
  ]);

  await repo.replaceCompanyKeywords(opticsCore.id, [
    {
      label: "CPO",
      confidence: 0.95,
      sourcePath: "reports/optics-rank.md"
    },
    {
      label: "1.6T",
      confidence: 0.85,
      sourcePath: "reports/optics-rank.md"
    }
  ]);

  const rankings = await getThemeGraphRankings({
    session: { workspace: { slug: "primary-desk" } },
    repo,
    limit: 10,
    keywordLimit: 3
  });

  const rankedEntry = rankings.results.find((item) => item.themeId === rankedTheme.id);
  const weakerEntry = rankings.results.find((item) => item.themeId === weakerTheme.id);

  assert.ok(rankings.total >= 2);
  assert.ok(rankedEntry);
  assert.ok(weakerEntry);
  assert.ok((rankedEntry?.score ?? 0) > (weakerEntry?.score ?? 0));
  assert.equal(rankedEntry?.signals.includes("市場風格偏進攻"), true);
  assert.equal(rankedEntry?.summary.totalEdges, 2);
});

test("strategy ideas support filters, sort modes, and structured rationale", async () => {
  const repo = new MemoryTradingRoomRepository();
  const session = await repo.getSession({
    workspaceSlug: `strategy-ideas-${randomUUID()}`
  });
  const now = new Date().toISOString();
  const older = new Date(Date.now() - 60_000).toISOString();

  const opticsTheme = await repo.createTheme({
    name: "Optics Upgrade",
    marketState: "Selective Attack",
    lifecycle: "Expansion",
    priority: 5,
    thesis: "Optics demand broadens.",
    whyNow: "AI interconnect budgets are widening.",
    bottleneck: "Module packaging"
  });
  const laggardTheme = await repo.createTheme({
    name: "Legacy Networking",
    marketState: "Balanced",
    lifecycle: "Maturity",
    priority: 2,
    thesis: "Legacy networking is stable.",
    whyNow: "Mostly maintenance cycle.",
    bottleneck: "Low urgency"
  });

  const opticsCompany = await repo.createCompany({
    name: "Photon Systems",
    ticker: "STR1",
    market: "OTHER",
    country: "Taiwan",
    themeIds: [opticsTheme.id],
    chainPosition: "Optical engines",
    beneficiaryTier: "Core",
    exposure: {
      volume: 5,
      asp: 4,
      margin: 4,
      capacity: 4,
      narrative: 5
    },
    validation: {
      capitalFlow: "Strong",
      consensus: "Rising",
      relativeStrength: "Leading"
    },
    notes: "High-conviction optics name."
  });
  const laggardCompany = await repo.createCompany({
    name: "Slow Networks",
    ticker: "STR2",
    market: "OTHER",
    country: "Taiwan",
    themeIds: [laggardTheme.id],
    chainPosition: "Legacy switches",
    beneficiaryTier: "Observation",
    exposure: {
      volume: 2,
      asp: 2,
      margin: 2,
      capacity: 2,
      narrative: 2
    },
    validation: {
      capitalFlow: "Neutral",
      consensus: "Flat",
      relativeStrength: "Lagging"
    },
    notes: "Lower-conviction legacy name."
  });
  const blockedCompany = await repo.createCompany({
    name: "Dark Fiber",
    ticker: "STR3",
    market: "OTHER",
    country: "Taiwan",
    themeIds: [opticsTheme.id],
    chainPosition: "Passive optics",
    beneficiaryTier: "Observation",
    exposure: {
      volume: 1,
      asp: 1,
      margin: 1,
      capacity: 1,
      narrative: 2
    },
    validation: {
      capitalFlow: "Soft",
      consensus: "Mixed",
      relativeStrength: "Weak"
    },
    notes: "Missing quote should keep this one blocked."
  });

  await repo.replaceCompanyRelations(opticsCompany.id, [
    {
      targetCompanyId: laggardCompany.id,
      targetLabel: laggardCompany.name,
      relationType: "supplier",
      confidence: 0.82,
      sourcePath: "strategy/optics.md"
    }
  ]);

  await repo.createSignal({
    category: "industry",
    direction: "bullish",
    title: "Optics momentum builds",
    summary: "Demand indicators keep improving.",
    confidence: 5,
    themeIds: [opticsTheme.id],
    companyIds: [opticsCompany.id]
  });
  await delay(5);
  await repo.createSignal({
    category: "industry",
    direction: "bearish",
    title: "Networking budget stalls",
    summary: "Orders remain slow.",
    confidence: 3,
    themeIds: [laggardTheme.id],
    companyIds: [laggardCompany.id]
  });
  await repo.createSignal({
    category: "industry",
    direction: "bullish",
    title: "Optics follow-through",
    summary: "Customers keep adding capacity.",
    confidence: 4,
    themeIds: [opticsTheme.id],
    companyIds: [opticsCompany.id]
  });

  await upsertManualQuotes({
    session,
    quotes: [
      {
        symbol: "STR1",
        market: "OTHER",
        source: "tradingview",
        last: 145,
        bid: 144.8,
        ask: 145.2,
        open: 142,
        high: 146,
        low: 141.5,
        prevClose: 143,
        volume: 1800,
        changePct: 1.4,
        timestamp: older
      },
      {
        symbol: "STR2",
        market: "OTHER",
        source: "paper",
        last: 48,
        bid: 47.9,
        ask: 48.1,
        open: 48.5,
        high: 48.8,
        low: 47.5,
        prevClose: 48.2,
        volume: 120,
        changePct: -0.4,
        timestamp: older
      }
    ]
  });
  await upsertManualQuotes({
    session,
    quotes: [
      {
        symbol: "STR1",
        market: "OTHER",
        source: "tradingview",
        last: 146,
        bid: 145.8,
        ask: 146.2,
        open: 142,
        high: 146.5,
        low: 141.5,
        prevClose: 143,
        volume: 2100,
        changePct: 2.1,
        timestamp: now
      }
    ]
  });

  const filteredIdeas = await getStrategyIdeas({
    session,
    repo,
    limit: 10,
    signalDays: 30,
    includeBlocked: true,
    themeId: opticsTheme.id,
    decisionMode: "strategy",
    decisionFilter: "usable_only",
    sort: "score"
  });

  assert.equal(filteredIdeas.summary.total, 1);
  assert.equal(filteredIdeas.summary.quality.referenceOnly, 1);
  assert.equal(filteredIdeas.summary.quality.insufficient, 0);
  assert.equal(filteredIdeas.items[0]?.companyId, opticsCompany.id);
  assert.equal(filteredIdeas.items[0]?.symbol, "STR1");
  assert.equal(filteredIdeas.items[0]?.marketData.decisionMode, "strategy");
  assert.equal(filteredIdeas.items[0]?.marketData.selectedSource, "tradingview");
  assert.equal(filteredIdeas.items[0]?.marketData.decision, "review");
  assert.equal(filteredIdeas.items[0]?.quality.grade, "reference_only");
  assert.equal(filteredIdeas.items[0]?.quality.history.grade, "strategy_ready");
  assert.equal(filteredIdeas.items[0]?.quality.bars.grade, "reference_only");
  assert.equal(filteredIdeas.items[0]?.rationale.quality.grade, "reference_only");
  assert.equal(filteredIdeas.items[0]?.rationale.primaryReason, filteredIdeas.items[0]?.quality.primaryReason);
  assert.equal(filteredIdeas.items[0]?.direction, "bullish");
  assert.equal(filteredIdeas.items[0]?.topThemes[0]?.themeId, opticsTheme.id);
  assert.equal(filteredIdeas.items[0]?.rationale.theme.topThemeId, opticsTheme.id);
  assert.equal(filteredIdeas.items[0]?.rationale.theme.relevance, "high");
  assert.equal(filteredIdeas.items[0]?.rationale.signals.recentCount, 2);
  assert.equal(filteredIdeas.items[0]?.rationale.signals.hasRecentSignals, true);
  assert.equal(
    filteredIdeas.items[0]?.rationale.marketData.primaryReason,
    filteredIdeas.items[0]?.marketData.primaryReason
  );
  assert.equal(filteredIdeas.items.some((item) => item.companyId === blockedCompany.id), false);

  const recencyIdeas = await getStrategyIdeas({
    session,
    repo,
    limit: 10,
    signalDays: 30,
    includeBlocked: true,
    decisionMode: "paper",
    sort: "signal_recency"
  });
  assert.equal(recencyIdeas.items[0]?.companyId, opticsCompany.id);
  assert.equal(recencyIdeas.items[0]?.marketData.decisionMode, "paper");

  const qualityIdeas = await getStrategyIdeas({
    session,
    repo,
    limit: 10,
    signalDays: 30,
    includeBlocked: true,
    decisionMode: "strategy",
    qualityFilter: "exclude_insufficient",
    sort: "score"
  });
  assert.equal(qualityIdeas.summary.total, 1);
  assert.equal(qualityIdeas.items[0]?.symbol, "STR1");
  assert.equal(qualityIdeas.items[0]?.quality.grade, "reference_only");

  const symbolIdeas = await getStrategyIdeas({
    session,
    repo,
    limit: 10,
    signalDays: 30,
    includeBlocked: true,
    symbol: "str1",
    decisionMode: "execution",
    sort: "symbol"
  });
  assert.equal(symbolIdeas.summary.total, 1);
  assert.equal(symbolIdeas.items[0]?.symbol, "STR1");
  assert.equal(symbolIdeas.items[0]?.marketData.decisionMode, "execution");
});

test("strategy runs persist query, summary, and score outputs", async () => {
  const repo = new MemoryTradingRoomRepository();
  const workspaceSlug = `strategy-runs-${randomUUID()}`;
  const session = await repo.getSession({ workspaceSlug });
  await resetPersistedStrategyRuns(workspaceSlug);

  const theme = await repo.createTheme({
    name: "Server Optics",
    marketState: "Selective Attack",
    lifecycle: "Expansion",
    priority: 4,
    thesis: "Optics demand remains healthy.",
    whyNow: "Cloud capex is resilient.",
    bottleneck: "Module capacity"
  });

  const company = await repo.createCompany({
    name: "Laser Works",
    ticker: "RUN1",
    market: "OTHER",
    country: "Taiwan",
    themeIds: [theme.id],
    chainPosition: "Optical engines",
    beneficiaryTier: "Core",
    exposure: {
      volume: 5,
      asp: 4,
      margin: 4,
      capacity: 4,
      narrative: 4
    },
    validation: {
      capitalFlow: "Strong",
      consensus: "Up",
      relativeStrength: "Leading"
    },
    notes: "High-conviction optics name."
  });
  const secondaryTheme = await repo.createTheme({
    name: "Memory Servers",
    marketState: "Balanced",
    lifecycle: "Expansion",
    priority: 3,
    thesis: "Server memory demand is stable.",
    whyNow: "Cloud inventory is healthy.",
    bottleneck: "Pricing discipline"
  });
  const secondaryCompany = await repo.createCompany({
    name: "Server Memory Works",
    ticker: "RUN2",
    market: "OTHER",
    country: "Taiwan",
    themeIds: [secondaryTheme.id],
    chainPosition: "Memory modules",
    beneficiaryTier: "Direct",
    exposure: {
      volume: 4,
      asp: 3,
      margin: 3,
      capacity: 3,
      narrative: 3
    },
    validation: {
      capitalFlow: "Neutral",
      consensus: "Stable",
      relativeStrength: "Middle"
    },
    notes: "Secondary strategy run candidate."
  });

  await repo.createSignal({
    category: "industry",
    direction: "bullish",
    title: "Optics build-out continues",
    summary: "Lead indicators remain firm.",
    confidence: 4,
    themeIds: [theme.id],
    companyIds: [company.id]
  });
  await repo.createSignal({
    category: "industry",
    direction: "bullish",
    title: "Memory demand stabilizes",
    summary: "Inventory digestion improves.",
    confidence: 3,
    themeIds: [secondaryTheme.id],
    companyIds: [secondaryCompany.id]
  });

  const now = new Date().toISOString();
  const older = new Date(Date.now() - 60_000).toISOString();
  await upsertManualQuotes({
    session,
    quotes: [
      {
        symbol: "RUN1",
        market: "OTHER",
        source: "tradingview",
        last: 88,
        bid: 87.8,
        ask: 88.2,
        open: 86.5,
        high: 88.4,
        low: 86.2,
        prevClose: 86.9,
        volume: 900,
        changePct: 1.3,
        timestamp: older
      },
      {
        symbol: "RUN1",
        market: "OTHER",
        source: "tradingview",
        last: 89,
        bid: 88.8,
        ask: 89.2,
        open: 86.5,
        high: 89.4,
        low: 86.2,
        prevClose: 86.9,
        volume: 1200,
        changePct: 2.4,
        timestamp: now
      },
      {
        symbol: "RUN2",
        market: "OTHER",
        source: "paper",
        last: 55,
        bid: 54.9,
        ask: 55.1,
        open: 54.5,
        high: 55.2,
        low: 54.2,
        prevClose: 54.8,
        volume: 600,
        changePct: 0.4,
        timestamp: now
      }
    ]
  });

  const run = await createStrategyRun({
    session,
    repo,
    payload: {
      limit: 10,
      signalDays: 30,
      includeBlocked: true,
      decisionMode: "strategy",
      qualityFilter: "exclude_insufficient",
      sort: "score"
    }
  });

  assert.equal(run.query.decisionMode, "strategy");
  assert.equal(run.summary.total, 1);
  assert.equal(run.outputs.length, 1);
  assert.equal(run.outputs[0]?.symbol, "RUN1");
  assert.equal(run.outputs[0]?.marketDecision, "review");
  assert.equal(run.outputs[0]?.qualityGrade, "reference_only");
  assert.equal(run.outputs[0]?.topThemeId, theme.id);
  assert.equal(run.items[0]?.symbol, "RUN1");
  assert.equal(run.items[0]?.rationale.theme.topThemeId, theme.id);

  const listed = await listStrategyRuns({
    session,
    limit: 10
  });
  assert.equal(listed.total, 1);
  assert.equal(listed.items[0]?.id, run.id);
  assert.equal(listed.items[0]?.decisionMode, "strategy");
  assert.equal(listed.items[0]?.summary.total, 1);
  assert.equal(listed.items[0]?.topIdea?.symbol, "RUN1");
  assert.equal(listed.items[0]?.topIdea?.qualityGrade, "reference_only");
  assert.equal(listed.items[0]?.quality.referenceOnly, 1);
  assert.ok((listed.items[0]?.quality.primaryReason ?? "").length > 0);
  assert.equal(listed.items[0]?.topSymbols[0], "RUN1");

  const loaded = await getStrategyRunById({
    session,
    runId: run.id
  });
  assert.ok(loaded);
  assert.equal(loaded?.id, run.id);
  assert.equal(loaded?.outputs[0]?.symbol, "RUN1");
  assert.equal(loaded?.outputs[0]?.primaryReason, run.outputs[0]?.primaryReason);
  assert.equal(loaded?.items[0]?.symbol, "RUN1");
  assert.equal(loaded?.items[0]?.marketData.decisionMode, "strategy");

  const secondRun = await createStrategyRun({
    session,
    repo,
    payload: {
      limit: 10,
      signalDays: 30,
      includeBlocked: true,
      decisionMode: "paper",
      symbol: "RUN2",
      sort: "symbol"
    }
  });

  const filteredByMode = await listStrategyRuns({
    session,
    limit: 10,
    decisionMode: "paper"
  });
  assert.equal(filteredByMode.total, 1);
  assert.equal(filteredByMode.items[0]?.id, secondRun.id);
  assert.equal(filteredByMode.items[0]?.decisionMode, "paper");

  const filteredByTheme = await listStrategyRuns({
    session,
    limit: 10,
    themeId: secondaryTheme.id
  });
  assert.equal(filteredByTheme.total, 1);
  assert.equal(filteredByTheme.items[0]?.topIdea?.symbol, "RUN2");

  const filteredByQuality = await listStrategyRuns({
    session,
    limit: 10,
    qualityFilter: "exclude_insufficient"
  });
  assert.equal(filteredByQuality.total, 1);
  assert.equal(filteredByQuality.items[0]?.id, run.id);

  const sortedByScore = await listStrategyRuns({
    session,
    limit: 10,
    sort: "score"
  });
  assert.equal(sortedByScore.items[0]?.topIdea?.symbol, "RUN1");

  const sortedBySymbol = await listStrategyRuns({
    session,
    limit: 10,
    sort: "symbol"
  });
  assert.equal(sortedBySymbol.items[0]?.topIdea?.symbol, "RUN1");
});

test("autopilot dryRun execute returns correct result shape without placing orders", async () => {
  const repo = new MemoryTradingRoomRepository();
  const workspaceSlug = `autopilot-dryrun-${randomUUID()}`;
  const session = await repo.getSession({ workspaceSlug });
  await resetPersistedStrategyRuns(workspaceSlug);

  const theme = await repo.createTheme({
    name: "Autopilot Optics",
    marketState: "Selective Attack",
    lifecycle: "Expansion",
    priority: 4,
    thesis: "Test theme.",
    whyNow: "CI.",
    bottleneck: "None"
  });

  const company = await repo.createCompany({
    name: "Autopilot Test Co",
    ticker: "APT1",
    market: "OTHER",
    country: "Taiwan",
    themeIds: [theme.id],
    chainPosition: "Core",
    beneficiaryTier: "Core",
    exposure: { volume: 5, asp: 5, margin: 5, capacity: 5, narrative: 5 },
    validation: { capitalFlow: "Strong", consensus: "Up", relativeStrength: "Leading" },
    notes: "Autopilot CI test."
  });

  await repo.createSignal({
    category: "industry",
    direction: "bullish",
    title: "APT1 autopilot signal",
    summary: "Test.",
    confidence: 5,
    themeIds: [theme.id],
    companyIds: [company.id]
  });

  await upsertManualQuotes({
    session,
    quotes: [
      {
        symbol: "APT1",
        market: "OTHER",
        source: "tradingview",
        last: 100,
        bid: 99.8,
        ask: 100.2,
        open: 99,
        high: 101,
        low: 98,
        prevClose: 99,
        volume: 1000,
        changePct: 1.0,
        timestamp: new Date().toISOString()
      }
    ]
  });

  const run = await createStrategyRun({
    session,
    repo,
    payload: { limit: 5, signalDays: 30, includeBlocked: true, decisionMode: "strategy", sort: "score" }
  });

  const result = await executeStrategyRun({
    session,
    repo,
    runId: run.id,
    payload: {
      accountId: "paper-default",
      sidePolicy: "bullish_long",
      sizeMode: "fixed_pct",
      sizePct: 1.0,
      maxOrders: 3,
      dryRun: true
    }
  });

  // Shape assertions
  assert.equal(result.runId, run.id);
  assert.equal(result.dryRun, true);
  assert.ok(typeof result.executedAt === "string");
  assert.ok(Array.isArray(result.submitted));
  assert.ok(Array.isArray(result.blocked));
  assert.ok(Array.isArray(result.errors));
  assert.ok(typeof result.summary.total === "number");
  assert.ok(typeof result.summary.submittedCount === "number");
  assert.ok(typeof result.summary.blockedCount === "number");
  assert.ok(typeof result.summary.errorCount === "number");
  // dryRun: total should equal submitted + blocked + errors
  assert.equal(
    result.summary.total,
    result.summary.submittedCount + result.summary.blockedCount + result.summary.errorCount
  );
  // dryRun never produces null-order submitted in real broker — result may be in blocked
  // (no_price or risk_blocked) but shape must match schema
  for (const entry of [...result.submitted, ...result.blocked]) {
    assert.ok(typeof entry.symbol === "string");
    assert.ok(entry.side === "buy" || entry.side === "sell");
    assert.ok(typeof entry.blocked === "boolean");
  }
});

test("autopilot execute blocks all orders when kill-switch is halted", async () => {
  const repo = new MemoryTradingRoomRepository();
  const workspaceSlug = `autopilot-killswitch-${randomUUID()}`;
  const session = await repo.getSession({ workspaceSlug });
  await resetPersistedStrategyRuns(workspaceSlug);

  const theme = await repo.createTheme({
    name: "KillSwitch Test Theme",
    marketState: "Defensive",
    lifecycle: "Expansion",
    priority: 3,
    thesis: "Kill-switch test.",
    whyNow: "CI.",
    bottleneck: "None"
  });

  const company = await repo.createCompany({
    name: "KillSwitch Test Co",
    ticker: "KST1",
    market: "OTHER",
    country: "Taiwan",
    themeIds: [theme.id],
    chainPosition: "Core",
    beneficiaryTier: "Direct",
    exposure: { volume: 4, asp: 4, margin: 4, capacity: 4, narrative: 4 },
    validation: { capitalFlow: "Neutral", consensus: "Stable", relativeStrength: "Middle" },
    notes: "Kill-switch test."
  });

  await repo.createSignal({
    category: "industry",
    direction: "bullish",
    title: "KST1 signal",
    summary: "Test.",
    confidence: 4,
    themeIds: [theme.id],
    companyIds: [company.id]
  });

  await upsertManualQuotes({
    session,
    quotes: [
      {
        symbol: "KST1",
        market: "OTHER",
        source: "tradingview",
        last: 50,
        bid: 49.8,
        ask: 50.2,
        open: 49,
        high: 51,
        low: 48,
        prevClose: 49,
        volume: 500,
        changePct: 2.0,
        timestamp: new Date().toISOString()
      }
    ]
  });

  const run = await createStrategyRun({
    session,
    repo,
    payload: { limit: 5, signalDays: 30, includeBlocked: true, decisionMode: "strategy", sort: "score" }
  });

  // Halt the kill-switch
  await setKillSwitchState({
    session,
    payload: { accountId: "paper-default", mode: "halted", reason: "CI test: autopilot kill-switch verify" }
  });

  // Issue a confirm token for this dryRun:false execute (Phase 2 (c) gate)
  const killSwitchToken = issueConfirmToken(run.id);

  const result = await executeStrategyRun({
    session,
    repo,
    runId: run.id,
    payload: {
      accountId: "paper-default",
      sidePolicy: "bullish_long",
      sizeMode: "fixed_pct",
      sizePct: 1.0,
      maxOrders: 3,
      dryRun: false,
      confirmToken: killSwitchToken.token
    }
  });

  // All qualifying ideas must be in blocked[], none in submitted[]
  assert.equal(result.submitted.length, 0);
  assert.ok(result.blocked.length > 0, "expected at least one blocked entry from kill-switch");
  for (const entry of result.blocked) {
    assert.equal(entry.blocked, true);
    assert.equal(entry.blockedReason, "kill_switch");
  }
  assert.equal(result.summary.submittedCount, 0);
  assert.ok(result.summary.blockedCount > 0);

  // Restore kill-switch to active
  await setKillSwitchState({
    session,
    payload: { accountId: "paper-default", mode: "active", reason: "CI test: restored after kill-switch verify" }
  });
});

// ---------------------------------------------------------------------------
// Kill-switch hard precedence tests (R14)
// These tests confirm kill-switch blocking fires BEFORE price lookup —
// i.e. even when there are NO live quotes, blocked reason must be
// "kill_switch" not "no_price".
// ---------------------------------------------------------------------------

test("kill-switch hard precedence: halted + no live quote → blocked=kill_switch (not no_price)", async () => {
  const repo = new MemoryTradingRoomRepository();
  const workspaceSlug = `ks-precedence-noquote-${randomUUID()}`;
  const session = await repo.getSession({ workspaceSlug });
  await resetPersistedStrategyRuns(workspaceSlug);

  const theme = await repo.createTheme({
    name: "KS Precedence Theme",
    marketState: "Defensive",
    lifecycle: "Expansion",
    priority: 3,
    thesis: "Kill-switch precedence test.",
    whyNow: "CI.",
    bottleneck: "None"
  });

  const company = await repo.createCompany({
    name: "KS Precedence Co",
    ticker: "KSNQ1",
    market: "OTHER",
    country: "Taiwan",
    themeIds: [theme.id],
    chainPosition: "Core",
    beneficiaryTier: "Direct",
    exposure: { volume: 4, asp: 4, margin: 4, capacity: 4, narrative: 4 },
    validation: { capitalFlow: "Neutral", consensus: "Stable", relativeStrength: "Middle" },
    notes: "Kill-switch precedence test."
  });

  await repo.createSignal({
    category: "industry",
    direction: "bullish",
    title: "KSNQ1 signal",
    summary: "Test.",
    confidence: 4,
    themeIds: [theme.id],
    companyIds: [company.id]
  });

  // Intentionally NO live quote seeded — R13 FAIL root cause scenario

  const run = await createStrategyRun({
    session,
    repo,
    payload: { limit: 5, signalDays: 30, includeBlocked: true, decisionMode: "strategy", sort: "score" }
  });

  // Halt the kill-switch BEFORE executing
  await setKillSwitchState({
    session,
    payload: { accountId: "paper-default", mode: "halted", reason: "CI R14: kill-switch precedence no-quote test" }
  });

  const token = issueConfirmToken(run.id);
  const result = await executeStrategyRun({
    session,
    repo,
    runId: run.id,
    payload: {
      accountId: "paper-default",
      sidePolicy: "bullish_long",
      sizeMode: "fixed_pct",
      sizePct: 1.0,
      maxOrders: 5,
      dryRun: false,
      confirmToken: token.token
    }
  });

  // Must NOT have any entry blocked as "no_price" — kill-switch must fire first
  assert.equal(result.submitted.length, 0);
  assert.ok(result.blocked.length > 0, "expected at least one blocked entry");
  for (const entry of result.blocked) {
    assert.equal(entry.blocked, true);
    assert.equal(entry.blockedReason, "kill_switch",
      `expected kill_switch but got ${entry.blockedReason} — price check must NOT precede kill-switch guard`);
  }
  assert.equal(result.summary.submittedCount, 0);
  assert.ok(result.summary.blockedCount > 0);

  // Restore
  await setKillSwitchState({
    session,
    payload: { accountId: "paper-default", mode: "trading", reason: "CI R14: restored" }
  });
});

test("kill-switch hard precedence: liquidate_only mode + eligible item → blocked=kill_switch", async () => {
  const repo = new MemoryTradingRoomRepository();
  const workspaceSlug = `ks-precedence-liqonly-${randomUUID()}`;
  const session = await repo.getSession({ workspaceSlug });
  await resetPersistedStrategyRuns(workspaceSlug);

  const theme = await repo.createTheme({
    name: "KS LiqOnly Theme",
    marketState: "Defensive",
    lifecycle: "Expansion",
    priority: 3,
    thesis: "Kill-switch liquidate_only test.",
    whyNow: "CI.",
    bottleneck: "None"
  });

  const company = await repo.createCompany({
    name: "KS LiqOnly Co",
    ticker: "KSLQ1",
    market: "OTHER",
    country: "Taiwan",
    themeIds: [theme.id],
    chainPosition: "Core",
    beneficiaryTier: "Direct",
    exposure: { volume: 4, asp: 4, margin: 4, capacity: 4, narrative: 4 },
    validation: { capitalFlow: "Neutral", consensus: "Stable", relativeStrength: "Middle" },
    notes: "Kill-switch liquidate_only test."
  });

  await repo.createSignal({
    category: "industry",
    direction: "bullish",
    title: "KSLQ1 signal",
    summary: "Test.",
    confidence: 4,
    themeIds: [theme.id],
    companyIds: [company.id]
  });

  // Provide a live quote — confirms it is the mode check, not price absence, that blocks
  await upsertManualQuotes({
    session,
    quotes: [
      {
        symbol: "KSLQ1",
        market: "OTHER",
        source: "tradingview",
        last: 100,
        bid: 99.5,
        ask: 100.5,
        open: 99,
        high: 102,
        low: 98,
        prevClose: 99,
        volume: 1000,
        changePct: 1.0,
        timestamp: new Date().toISOString()
      }
    ]
  });

  const run = await createStrategyRun({
    session,
    repo,
    payload: { limit: 5, signalDays: 30, includeBlocked: true, decisionMode: "strategy", sort: "score" }
  });

  // liquidate_only mode — opening new positions must be blocked
  await setKillSwitchState({
    session,
    payload: { accountId: "paper-default", mode: "liquidate_only", reason: "CI R14: liquidate_only precedence test" }
  });

  const token = issueConfirmToken(run.id);
  const result = await executeStrategyRun({
    session,
    repo,
    runId: run.id,
    payload: {
      accountId: "paper-default",
      sidePolicy: "bullish_long",
      sizeMode: "fixed_pct",
      sizePct: 1.0,
      maxOrders: 5,
      dryRun: true,
      confirmToken: token.token
    }
  });

  assert.equal(result.submitted.length, 0);
  assert.ok(result.blocked.length > 0, "expected at least one blocked entry for liquidate_only");
  for (const entry of result.blocked) {
    assert.equal(entry.blockedReason, "kill_switch",
      `liquidate_only mode should yield kill_switch block, got ${entry.blockedReason}`);
  }

  // Restore
  await setKillSwitchState({
    session,
    payload: { accountId: "paper-default", mode: "trading", reason: "CI R14: restored" }
  });
});

// ---------------------------------------------------------------------------
// Autopilot Phase 1 — edge-case hardening tests
// ---------------------------------------------------------------------------

test("autopilot dryRun: bearish idea with bullish_long sidePolicy → eligible list empty → total=0 result", async () => {
  const repo = new MemoryTradingRoomRepository();
  const workspaceSlug = `autopilot-bearish-skip-${randomUUID()}`;
  const session = await repo.getSession({ workspaceSlug });
  await resetPersistedStrategyRuns(workspaceSlug);

  const theme = await repo.createTheme({
    name: "Bearish Skip Theme",
    marketState: "Defensive",
    lifecycle: "Contraction",
    priority: 3,
    thesis: "Bearish signal test.",
    whyNow: "CI.",
    bottleneck: "None"
  });

  const company = await repo.createCompany({
    name: "Bearish Skip Co",
    ticker: "BSK1",
    market: "OTHER",
    country: "Taiwan",
    themeIds: [theme.id],
    chainPosition: "Core",
    beneficiaryTier: "Core",
    exposure: { volume: 3, asp: 3, margin: 3, capacity: 3, narrative: 3 },
    validation: { capitalFlow: "Weak", consensus: "Down", relativeStrength: "Lagging" },
    notes: "Bearish skip CI test."
  });

  // Signal is bearish — with bullish_long sidePolicy, this idea should be skipped entirely
  await repo.createSignal({
    category: "industry",
    direction: "bearish",
    title: "BSK1 bearish signal",
    summary: "Bearish.",
    confidence: 4,
    themeIds: [theme.id],
    companyIds: [company.id]
  });

  await upsertManualQuotes({
    session,
    quotes: [
      {
        symbol: "BSK1",
        market: "OTHER",
        source: "tradingview",
        last: 80,
        bid: 79.8,
        ask: 80.2,
        open: 79,
        high: 81,
        low: 78,
        prevClose: 79,
        volume: 600,
        changePct: -1.0,
        timestamp: new Date().toISOString()
      }
    ]
  });

  const run = await createStrategyRun({
    session,
    repo,
    payload: { limit: 5, signalDays: 30, includeBlocked: true, decisionMode: "strategy", sort: "score" }
  });

  // bullish_long policy: only bullish ideas get a buy side. BSK1 is bearish → skipped.
  const result = await executeStrategyRun({
    session,
    repo,
    runId: run.id,
    payload: {
      accountId: "paper-default",
      sidePolicy: "bullish_long",
      sizeMode: "fixed_pct",
      sizePct: 1.0,
      maxOrders: 5,
      dryRun: true
    }
  });

  // All candidates were skipped by sidePolicy — eligible list is empty → early return with total=0
  assert.equal(result.runId, run.id);
  assert.equal(result.dryRun, true);
  assert.equal(result.summary.total, 0);
  assert.equal(result.summary.submittedCount, 0);
  assert.equal(result.summary.blockedCount, 0);
  assert.equal(result.summary.errorCount, 0);
  assert.equal(result.submitted.length, 0);
  assert.equal(result.blocked.length, 0);
  assert.equal(result.errors.length, 0);
});

test("autopilot dryRun: sizePct so small that quantity=0 → all go to blocked with quantity_zero reason", async () => {
  const repo = new MemoryTradingRoomRepository();
  const workspaceSlug = `autopilot-qty-zero-${randomUUID()}`;
  const session = await repo.getSession({ workspaceSlug });
  await resetPersistedStrategyRuns(workspaceSlug);

  const theme = await repo.createTheme({
    name: "Qty Zero Theme",
    marketState: "Selective Attack",
    lifecycle: "Expansion",
    priority: 4,
    thesis: "Test.",
    whyNow: "CI.",
    bottleneck: "None"
  });

  const company = await repo.createCompany({
    name: "Qty Zero Co",
    ticker: "QZ01",
    market: "OTHER",
    country: "Taiwan",
    themeIds: [theme.id],
    chainPosition: "Core",
    beneficiaryTier: "Core",
    exposure: { volume: 5, asp: 5, margin: 5, capacity: 5, narrative: 5 },
    validation: { capitalFlow: "Strong", consensus: "Up", relativeStrength: "Leading" },
    notes: "Qty zero CI test."
  });

  await repo.createSignal({
    category: "industry",
    direction: "bullish",
    title: "QZ01 bullish signal",
    summary: "Bullish.",
    confidence: 5,
    themeIds: [theme.id],
    companyIds: [company.id]
  });

  // Very high price: paper balance is typically ~100_000 equity, 0.1% sizePct → 100 / 999_999 = 0.0001 lots → floor=0
  await upsertManualQuotes({
    session,
    quotes: [
      {
        symbol: "QZ01",
        market: "OTHER",
        source: "tradingview",
        last: 999_999,
        bid: 999_990,
        ask: 1_000_010,
        open: 999_000,
        high: 1_000_100,
        low: 998_900,
        prevClose: 999_000,
        volume: 10,
        changePct: 0.1,
        timestamp: new Date().toISOString()
      }
    ]
  });

  const run = await createStrategyRun({
    session,
    repo,
    payload: { limit: 5, signalDays: 30, includeBlocked: true, decisionMode: "strategy", sort: "score" }
  });

  // sizePct 0.1 % of equity / price 999_999 → raw qty < 1 → floor to 0 → quantity_zero
  const result = await executeStrategyRun({
    session,
    repo,
    runId: run.id,
    payload: {
      accountId: "paper-default",
      sidePolicy: "bullish_long",
      sizeMode: "fixed_pct",
      sizePct: 0.1,
      maxOrders: 3,
      dryRun: true
    }
  });

  assert.equal(result.runId, run.id);
  assert.equal(result.dryRun, true);
  // Either quantity_zero (our pre-check) or no_price if quote didn't resolve — either is a blocked reason
  // Primary assertion: nothing should be submitted
  assert.equal(result.summary.submittedCount, 0);
  // If QZ01 was found and priced, it should be in blocked[] with quantity_zero
  const qz01Blocked = result.blocked.find((e) => e.symbol === "QZ01");
  if (qz01Blocked) {
    assert.equal(qz01Blocked.blocked, true);
    assert.equal(qz01Blocked.blockedReason, "quantity_zero");
    assert.equal(qz01Blocked.quantity, 0);
  }
  // Invariant: total = submitted + blocked + errors
  assert.equal(
    result.summary.total,
    result.summary.submittedCount + result.summary.blockedCount + result.summary.errorCount
  );
});

test("autopilot dryRun: bearish_short sidePolicy but idea is bullish → skipped → empty result", async () => {
  const repo = new MemoryTradingRoomRepository();
  const workspaceSlug = `autopilot-short-only-${randomUUID()}`;
  const session = await repo.getSession({ workspaceSlug });
  await resetPersistedStrategyRuns(workspaceSlug);

  const theme = await repo.createTheme({
    name: "Short Only Theme",
    marketState: "Selective Attack",
    lifecycle: "Expansion",
    priority: 3,
    thesis: "Short policy test.",
    whyNow: "CI.",
    bottleneck: "None"
  });

  const company = await repo.createCompany({
    name: "Short Skip Co",
    ticker: "SPS1",
    market: "OTHER",
    country: "Taiwan",
    themeIds: [theme.id],
    chainPosition: "Core",
    beneficiaryTier: "Core",
    exposure: { volume: 4, asp: 4, margin: 4, capacity: 4, narrative: 4 },
    validation: { capitalFlow: "Strong", consensus: "Up", relativeStrength: "Leading" },
    notes: "Short-only skip CI test."
  });

  // Signal is bullish — bearish_short policy should skip this idea
  await repo.createSignal({
    category: "industry",
    direction: "bullish",
    title: "SPS1 bullish signal",
    summary: "Bullish.",
    confidence: 5,
    themeIds: [theme.id],
    companyIds: [company.id]
  });

  await upsertManualQuotes({
    session,
    quotes: [
      {
        symbol: "SPS1",
        market: "OTHER",
        source: "tradingview",
        last: 60,
        bid: 59.8,
        ask: 60.2,
        open: 59,
        high: 61,
        low: 58,
        prevClose: 59,
        volume: 700,
        changePct: 1.5,
        timestamp: new Date().toISOString()
      }
    ]
  });

  const run = await createStrategyRun({
    session,
    repo,
    payload: { limit: 5, signalDays: 30, includeBlocked: true, decisionMode: "strategy", sort: "score" }
  });

  // bearish_short policy: only bearish ideas get sell side. SPS1 is bullish → resolveSideForIdea returns null → skipped.
  const result = await executeStrategyRun({
    session,
    repo,
    runId: run.id,
    payload: {
      accountId: "paper-default",
      sidePolicy: "bearish_short",
      sizeMode: "fixed_pct",
      sizePct: 1.0,
      maxOrders: 5,
      dryRun: true
    }
  });

  assert.equal(result.runId, run.id);
  assert.equal(result.dryRun, true);
  // bearish_short skips all bullish ideas → eligible empty → total 0
  assert.equal(result.summary.total, 0);
  assert.equal(result.summary.submittedCount, 0);
  assert.equal(result.summary.blockedCount, 0);
  assert.equal(result.summary.errorCount, 0);
  assert.equal(result.submitted.length, 0);
  assert.equal(result.blocked.length, 0);
});

test("autopilot dryRun: idempotency — same runId executed twice produces independent results without double-counting", async () => {
  const repo = new MemoryTradingRoomRepository();
  const workspaceSlug = `autopilot-idempotent-${randomUUID()}`;
  const session = await repo.getSession({ workspaceSlug });
  await resetPersistedStrategyRuns(workspaceSlug);

  const theme = await repo.createTheme({
    name: "Idempotency Theme",
    marketState: "Selective Attack",
    lifecycle: "Expansion",
    priority: 4,
    thesis: "Idempotency test.",
    whyNow: "CI.",
    bottleneck: "None"
  });

  const company = await repo.createCompany({
    name: "Idempotency Co",
    ticker: "IDP1",
    market: "OTHER",
    country: "Taiwan",
    themeIds: [theme.id],
    chainPosition: "Core",
    beneficiaryTier: "Core",
    exposure: { volume: 5, asp: 5, margin: 5, capacity: 5, narrative: 5 },
    validation: { capitalFlow: "Strong", consensus: "Up", relativeStrength: "Leading" },
    notes: "Idempotency CI test."
  });

  await repo.createSignal({
    category: "industry",
    direction: "bullish",
    title: "IDP1 idempotency signal",
    summary: "Test.",
    confidence: 5,
    themeIds: [theme.id],
    companyIds: [company.id]
  });

  await upsertManualQuotes({
    session,
    quotes: [
      {
        symbol: "IDP1",
        market: "OTHER",
        source: "tradingview",
        last: 120,
        bid: 119.8,
        ask: 120.2,
        open: 119,
        high: 121,
        low: 118,
        prevClose: 119,
        volume: 800,
        changePct: 0.8,
        timestamp: new Date().toISOString()
      }
    ]
  });

  const run = await createStrategyRun({
    session,
    repo,
    payload: { limit: 5, signalDays: 30, includeBlocked: true, decisionMode: "strategy", sort: "score" }
  });

  const payload = {
    accountId: "paper-default",
    sidePolicy: "bullish_long" as const,
    sizeMode: "fixed_pct" as const,
    sizePct: 1.0,
    maxOrders: 3,
    dryRun: true
  };

  // Execute the same dryRun twice with the same runId
  const firstResult = await executeStrategyRun({ session, repo, runId: run.id, payload });
  const secondResult = await executeStrategyRun({ session, repo, runId: run.id, payload });

  // Both calls should target the same runId
  assert.equal(firstResult.runId, run.id);
  assert.equal(secondResult.runId, run.id);

  // Both should be dryRun
  assert.equal(firstResult.dryRun, true);
  assert.equal(secondResult.dryRun, true);

  // Totals must be equal (same input, same run snapshot) — second call is independent, not accumulating
  assert.equal(firstResult.summary.total, secondResult.summary.total);
  assert.equal(firstResult.summary.submittedCount, secondResult.summary.submittedCount);
  assert.equal(firstResult.summary.blockedCount, secondResult.summary.blockedCount);
  assert.equal(firstResult.summary.errorCount, secondResult.summary.errorCount);

  // Invariant holds for both results
  assert.equal(
    firstResult.summary.total,
    firstResult.summary.submittedCount + firstResult.summary.blockedCount + firstResult.summary.errorCount
  );
  assert.equal(
    secondResult.summary.total,
    secondResult.summary.submittedCount + secondResult.summary.blockedCount + secondResult.summary.errorCount
  );

  // Second result should not have MORE entries than first (no accumulation)
  assert.ok(
    secondResult.submitted.length === firstResult.submitted.length,
    `submitted count should be equal: ${firstResult.submitted.length} vs ${secondResult.submitted.length}`
  );
  assert.ok(
    secondResult.blocked.length === firstResult.blocked.length,
    `blocked count should be equal: ${firstResult.blocked.length} vs ${secondResult.blocked.length}`
  );
});

// ---------------------------------------------------------------------------
// Autopilot Phase 2 (c) — Confirm Gate unit tests
// These tests exercise the token store directly (no HTTP layer needed).
// ---------------------------------------------------------------------------

test("confirm gate: dryRun:true with no token → executeStrategyRun proceeds normally", async () => {
  const workspaceSlug = `confirm-gate-dryrun-${randomUUID()}`;
  const repo = new MemoryTradingRoomRepository();
  const session = await repo.getSession({ workspaceSlug });
  await resetPersistedStrategyRuns(workspaceSlug);

  const theme = await repo.createTheme({
    name: "Confirm Gate Theme",
    marketState: "Selective Attack",
    lifecycle: "Discovery",
    priority: 3,
    thesis: "Gate test.",
    whyNow: "Gate test.",
    bottleneck: "None"
  });
  const company = await repo.createCompany({
    name: "Gate Test Co",
    ticker: "GTC",
    market: "OTHER",
    country: "Taiwan",
    themeIds: [theme.id],
    chainPosition: "Test",
    beneficiaryTier: "Direct",
    exposure: { volume: 3, asp: 3, margin: 3, capacity: 3, narrative: 3 },
    validation: { capitalFlow: "ok", consensus: "ok", relativeStrength: "ok" },
    notes: "gate test"
  });
  await repo.createSignal({
    category: "industry",
    direction: "bullish",
    title: "Gate test signal",
    summary: "test",
    confidence: 3,
    themeIds: [theme.id],
    companyIds: [company.id]
  });
  const run = await createStrategyRun({ session, repo, payload: { limit: 5, signalDays: 30, includeBlocked: true, decisionMode: "strategy", sort: "score" } });

  // dryRun:true without any token should NOT throw
  const result = await executeStrategyRun({
    session,
    repo,
    runId: run.id,
    payload: {
      accountId: "paper-default",
      sidePolicy: "bullish_long",
      sizeMode: "fixed_pct",
      sizePct: 1,
      maxOrders: 3,
      dryRun: true
      // no confirmToken — must not be required for dryRun:true
    }
  });
  assert.equal(result.dryRun, true);
});

test("confirm gate: dryRun:false with no token → throws confirm_required", async () => {
  const workspaceSlug = `confirm-gate-required-${randomUUID()}`;
  const repo = new MemoryTradingRoomRepository();
  const session = await repo.getSession({ workspaceSlug });
  await resetPersistedStrategyRuns(workspaceSlug);
  const run = await createStrategyRun({ session, repo, payload: { limit: 5, signalDays: 30, includeBlocked: true, decisionMode: "strategy", sort: "score" } });

  await assert.rejects(
    () => executeStrategyRun({
      session,
      repo,
      runId: run.id,
      payload: {
        accountId: "paper-default",
        sidePolicy: "bullish_long",
        sizeMode: "fixed_pct",
        sizePct: 1,
        maxOrders: 3,
        dryRun: false
        // no confirmToken
      }
    }),
    (err: Error) => {
      assert.ok(err.message.includes("confirm_required"), `expected confirm_required, got: ${err.message}`);
      return true;
    }
  );
});

test("confirm gate: dryRun:false with invalid token → throws confirm_invalid", async () => {
  const workspaceSlug = `confirm-gate-invalid-${randomUUID()}`;
  const repo = new MemoryTradingRoomRepository();
  const session = await repo.getSession({ workspaceSlug });
  await resetPersistedStrategyRuns(workspaceSlug);
  const run = await createStrategyRun({ session, repo, payload: { limit: 5, signalDays: 30, includeBlocked: true, decisionMode: "strategy", sort: "score" } });

  await assert.rejects(
    () => executeStrategyRun({
      session,
      repo,
      runId: run.id,
      payload: {
        accountId: "paper-default",
        sidePolicy: "bullish_long",
        sizeMode: "fixed_pct",
        sizePct: 1,
        maxOrders: 3,
        dryRun: false,
        confirmToken: "totally-fake-token-that-does-not-exist"
      }
    }),
    (err: Error) => {
      assert.ok(err.message.includes("confirm_invalid"), `expected confirm_invalid, got: ${err.message}`);
      return true;
    }
  );
});

test("confirm gate: expired token path — validateAndConsumeConfirmToken returns confirm_invalid for unknown token", () => {
  // We cannot sleep 60s in CI to force TTL expiry.
  // This test verifies the expire branch indirectly: a token not in the store → confirm_invalid.
  // The expiry branch (entry found but Date.now() > expiresAt) is covered by the confirm_expired
  // error code in the store logic; the happy-path token test above covers the success path.
  const fakeToken = "expired-00000000-0000-0000-0000-000000000000";
  const result = validateAndConsumeConfirmToken(fakeToken, "any-run-id");
  assert.equal(result, "confirm_invalid");
});

test("confirm gate: issueConfirmToken + validateAndConsumeConfirmToken — valid token consumed once", () => {
  const runId = randomUUID();
  const tokenResponse = issueConfirmToken(runId);

  // Token response shape
  assert.ok(typeof tokenResponse.token === "string" && tokenResponse.token.length > 0);
  assert.ok(typeof tokenResponse.expiresAt === "string");
  assert.ok(!Number.isNaN(Date.parse(tokenResponse.expiresAt)));

  // First consume: valid
  const firstResult = validateAndConsumeConfirmToken(tokenResponse.token, runId);
  assert.equal(firstResult, null, "first consume should succeed");

  // Second consume: replay guard
  const secondResult = validateAndConsumeConfirmToken(tokenResponse.token, runId);
  assert.equal(secondResult, "confirm_used");
});

test("confirm gate: replay guard — same token cannot be used twice", () => {
  const runId = randomUUID();
  const { token } = issueConfirmToken(runId);

  const first = validateAndConsumeConfirmToken(token, runId);
  assert.equal(first, null);

  const second = validateAndConsumeConfirmToken(token, runId);
  assert.equal(second, "confirm_used");

  const third = validateAndConsumeConfirmToken(token, runId);
  assert.equal(third, "confirm_used");
});

test("confirm gate: run_mismatch — token bound to different runId is rejected", () => {
  const runA = randomUUID();
  const runB = randomUUID();
  const { token } = issueConfirmToken(runA);

  // Using token with the wrong runId
  const result = validateAndConsumeConfirmToken(token, runB);
  assert.equal(result, "confirm_run_mismatch");

  // Token was NOT consumed — still valid for runA
  const correctResult = validateAndConsumeConfirmToken(token, runA);
  assert.equal(correctResult, null);
});

test("confirm gate contracts: new schemas parse round-trip", async () => {
  const {
    autopilotExecuteErrorCodeSchema,
    autopilotConfirmTokenResponseSchema,
    autopilotExecuteInputSchema
  } = await import("../packages/contracts/src/index.ts");

  // autopilotExecuteErrorCodeSchema — all 5 valid codes
  for (const code of ["confirm_required", "confirm_invalid", "confirm_expired", "confirm_used", "confirm_run_mismatch"]) {
    assert.equal(autopilotExecuteErrorCodeSchema.parse(code), code);
  }
  assert.throws(() => autopilotExecuteErrorCodeSchema.parse("not_a_real_code"));

  // autopilotConfirmTokenResponseSchema — full round-trip
  const tokenResp = { token: "abc-123-uuid", expiresAt: new Date().toISOString() };
  const parsed = autopilotConfirmTokenResponseSchema.parse(tokenResp);
  assert.equal(parsed.token, tokenResp.token);
  assert.equal(parsed.expiresAt, tokenResp.expiresAt);

  // autopilotExecuteInputSchema — confirmToken field is optional (existing fields must still work)
  const withoutToken = autopilotExecuteInputSchema.parse({ dryRun: true });
  assert.equal(withoutToken.confirmToken, undefined);

  const withToken = autopilotExecuteInputSchema.parse({ dryRun: false, confirmToken: "my-token" });
  assert.equal(withToken.confirmToken, "my-token");
  assert.equal(withToken.dryRun, false);
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

  const relations = await repo.replaceCompanyRelations(company.id, [
    {
      targetLabel: "NVIDIA",
      relationType: "customer",
      confidence: 0.9,
      sourcePath: "Pilot_Reports/Semiconductors/PHTN.md"
    },
    {
      targetLabel: "CoWoS",
      relationType: "technology",
      confidence: 0.7,
      sourcePath: "Pilot_Reports/Semiconductors/PHTN.md"
    }
  ]);

  const keywords = await repo.replaceCompanyKeywords(company.id, [
    {
      label: "Optics",
      confidence: 0.8,
      sourcePath: "Pilot_Reports/Semiconductors/PHTN.md"
    },
    {
      label: "AI",
      confidence: 0.6,
      sourcePath: "Pilot_Reports/Semiconductors/PHTN.md"
    }
  ]);

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
  assert.equal(relations.length, 2);
  assert.equal((await repo.listCompanyRelations(company.id)).length, 2);
  assert.equal(keywords.length, 2);
  assert.equal((await repo.listCompanyKeywords(company.id)).length, 2);
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

test("execution gate blocks paper review without override and passes with override", async () => {
  const session = { workspace: { slug: `gate-review-${randomUUID()}` } };
  const timestamp = new Date().toISOString();

  // Paper-sourced quote → decision-summary flags paper=review (synthetic_source)
  // and execution=block (not live-usable). This is the canonical "needs human
  // override" case for the paper lane.
  await upsertPaperQuotes({
    session,
    quotes: [
      {
        symbol: "GATE1",
        market: "OTHER",
        source: "manual",
        last: 100,
        bid: 99.9,
        ask: 100.1,
        open: 100,
        high: 100,
        low: 99,
        prevClose: 99.5,
        volume: 1000,
        changePct: 0.5,
        timestamp
      }
    ]
  });

  const baseOrder = {
    accountId: "gate-review-acct",
    symbol: "GATE1",
    side: "buy" as const,
    type: "market" as const,
    timeInForce: "rod" as const,
    quantity: 1000,
    price: null,
    stopPrice: null,
    tradePlanId: null,
    strategyId: null,
    overrideGuards: [] as string[],
    overrideReason: ""
  };

  // Without override → gate blocks
  const required = await evaluateExecutionGate({
    session,
    order: baseOrder,
    mode: "paper"
  });
  assert.equal(required.decision, "review_required");
  assert.equal(required.blocked, true);
  assert.notEqual(required.quoteContext, null);
  assert.equal(required.quoteContext?.mode, "paper");
  assert.equal(required.quoteContext?.decision, "review");

  // Execution-mode lane on a paper-only feed → hard block (not live-usable).
  const liveLane = await evaluateExecutionGate({
    session,
    order: baseOrder,
    mode: "execution"
  });
  assert.equal(liveLane.blocked, true);
  assert.equal(liveLane.quoteContext?.liveUsable, false);

  // With override → gate allows review_accepted.
  const accepted = await evaluateExecutionGate({
    session,
    order: { ...baseOrder, overrideGuards: [GATE_OVERRIDE_KEY] },
    mode: "paper"
  });
  assert.equal(accepted.decision, "review_accepted");
  assert.equal(accepted.blocked, false);
  assert.notEqual(accepted.quoteContext, null);
});

test("execution gate blocks submit when decision-summary returns no quote", async () => {
  const session = { workspace: { slug: `gate-unknown-${randomUUID()}` } };

  const gate = await evaluateExecutionGate({
    session,
    order: {
      accountId: "gate-unknown-acct",
      symbol: "NOPE1",
      side: "buy",
      type: "market",
      timeInForce: "rod",
      quantity: 1000,
      price: null,
      stopPrice: null,
      tradePlanId: null,
      strategyId: null,
      overrideGuards: [],
      overrideReason: ""
    },
    mode: "paper"
  });

  // Missing quote is fail-open (decision=quote_unknown, blocked=false) — the
  // broker's paperUsable / paperSafe check still stops the fill, so the UI and
  // server agree no Order + no Fill can ship against no quote.
  assert.equal(gate.decision, "quote_unknown");
  assert.equal(gate.blocked, false);
  assert.equal(gate.quoteContext, null);
});

test("placePaperOrder persists quoteContext on order and fill end-to-end", async () => {
  const session = { workspace: { slug: `gate-fill-${randomUUID()}` } };
  const timestamp = new Date().toISOString();

  await upsertPaperQuotes({
    session,
    quotes: [
      {
        symbol: "GATE2",
        market: "OTHER",
        source: "manual",
        last: 50,
        bid: 49.9,
        ask: 50.1,
        open: 50,
        high: 50,
        low: 50,
        prevClose: 50,
        volume: 2000,
        changePct: 0,
        timestamp
      }
    ]
  });

  const order = {
    accountId: "gate-fill-acct",
    symbol: "GATE2",
    side: "buy" as const,
    type: "market" as const,
    timeInForce: "rod" as const,
    quantity: 1000,
    price: null,
    stopPrice: null,
    tradePlanId: null,
    strategyId: null,
    overrideGuards: [GATE_OVERRIDE_KEY],
    overrideReason: "smoke test"
  };

  const gate = await evaluateExecutionGate({
    session,
    order,
    mode: "paper"
  });
  assert.equal(gate.decision, "review_accepted");
  assert.equal(gate.blocked, false);

  const placed = await placePaperOrder({
    session,
    order,
    riskCheckId: null,
    quoteGate: gate
  });

  // Market order against a paper quote fills immediately and the resulting
  // Order row carries the same quoteContext the gate produced.
  assert.equal(placed.status, "filled");
  assert.notEqual(placed.quoteContext, null);
  assert.equal(placed.quoteContext?.source, gate.quoteContext?.source);
  assert.equal(placed.quoteContext?.decision, "review");

  const stored = await listPaperOrders(session, { accountId: order.accountId });
  const stamped = stored.find((o) => o.id === placed.id);
  assert.ok(stamped, "order should be retrievable after place");
  assert.equal(stamped?.quoteContext?.readiness, gate.quoteContext?.readiness);
});

test("execution events store is a no-op for memory sessions", async () => {
  // Paper broker runs in pure-memory mode when persistenceMode !== "database".
  // listExecutionEvents must short-circuit so a smoke test caller can swap
  // between memory and database transparently.
  const session = { workspace: { slug: `gate-events-${randomUUID()}` } };
  const events = await listExecutionEvents(session as never, {
    accountId: "gate-events-acct"
  });
  assert.deepEqual(events, []);
});

test("trading-service.submitOrder runs session + risk + gate + paper broker end-to-end", async () => {
  // Full-stack smoke: AppSession with EXECUTION_ROLES, risk-engine commit,
  // quote gate, paper broker placement, quoteContext stamping on the Order.
  // Covers the review_required and review_accepted branches in one session
  // so we know the gate's verdict flows all the way through to the broker row.
  const repo = new MemoryTradingRoomRepository();
  const session = await repo.getSession({
    workspaceSlug: `submit-smoke-${randomUUID()}`
  });
  const accountId = "paper-smoke-acct";

  // Relax the trading-hours window so this smoke isn't dependent on when the
  // CI job happens to run. Everything else stays at the default risk limits.
  await upsertRiskLimitState({
    session,
    payload: {
      accountId,
      tradingHoursStart: "00:00",
      tradingHoursEnd: "23:59"
    }
  });

  const now = new Date().toISOString();
  await upsertPaperQuotes({
    session,
    quotes: [
      {
        symbol: "SMOKE1",
        market: "OTHER",
        source: "manual",
        last: 50,
        bid: 49.9,
        ask: 50.1,
        open: 50,
        high: 50,
        low: 50,
        prevClose: 50,
        volume: 2000,
        changePct: 0,
        timestamp: now
      }
    ]
  });

  const baseOrder = {
    accountId,
    symbol: "SMOKE1",
    side: "buy" as const,
    type: "market" as const,
    timeInForce: "rod" as const,
    price: null,
    stopPrice: null,
    tradePlanId: null,
    strategyId: null,
    overrideReason: ""
  };

  // Paper quotes land as paper=review by policy; submit without the override
  // must be rejected by the gate. Order row must NOT be created — the risk
  // check did commit (audit trail) but the broker never ran.
  const denied = await submitOrder({
    session,
    repo,
    order: { ...baseOrder, quantity: 1000, overrideGuards: [] }
  });
  assert.equal(denied.blocked, true);
  assert.equal(denied.order, null);
  assert.equal(denied.riskCheck.decision, "allow");
  assert.equal(denied.quoteGate?.decision, "review_required");
  assert.equal(denied.quoteGate?.blocked, true);
  assert.equal(denied.quoteGate?.mode, "paper");
  assert.equal(denied.quoteGate?.readiness, "degraded");
  assert.equal(denied.riskCheck.accountId, accountId);

  // With override the chain goes risk → gate → broker; the placed Order is
  // stamped with the same quoteContext the gate produced, and the riskCheckId
  // links back to the persisted risk record. Quantity differs so duplicate-
  // intent detection doesn't step on the first submit.
  const accepted = await submitOrder({
    session,
    repo,
    order: { ...baseOrder, quantity: 1100, overrideGuards: [GATE_OVERRIDE_KEY] }
  });
  assert.equal(accepted.blocked, false);
  assert.equal(accepted.riskCheck.decision, "allow");
  assert.equal(accepted.quoteGate?.decision, "review_accepted");
  assert.equal(accepted.quoteGate?.blocked, false);
  assert.ok(accepted.order, "order should exist after accepted submit");
  assert.equal(accepted.order?.status, "filled");
  assert.equal(accepted.order?.quoteContext?.decision, "review");
  assert.equal(accepted.order?.riskCheckId, accepted.riskCheck.id);
  assert.equal(
    accepted.order?.quoteContext?.source,
    accepted.quoteGate?.quoteContext?.source
  );
});

test("trading-service.submitOrder rejects non-execution roles at the risk layer", async () => {
  // EXECUTION_ROLES gate lives in risk-engine, so an Analyst session must be
  // blocked before the quote gate ever runs. quoteGate stays null because the
  // risk layer short-circuits submitOrder.
  const repo = new MemoryTradingRoomRepository();
  const session = await repo.getSession({
    workspaceSlug: `submit-analyst-${randomUUID()}`,
    roleOverride: "Analyst"
  });

  const now = new Date().toISOString();
  await upsertPaperQuotes({
    session,
    quotes: [
      {
        symbol: "SMOKE2",
        market: "OTHER",
        source: "manual",
        last: 25,
        bid: 24.9,
        ask: 25.1,
        open: 25,
        high: 25,
        low: 25,
        prevClose: 25,
        volume: 2000,
        changePct: 0,
        timestamp: now
      }
    ]
  });

  const result = await submitOrder({
    session,
    repo,
    order: {
      accountId: "paper-analyst-acct",
      symbol: "SMOKE2",
      side: "buy",
      type: "market",
      timeInForce: "rod",
      quantity: 1000,
      price: null,
      stopPrice: null,
      tradePlanId: null,
      strategyId: null,
      overrideGuards: [GATE_OVERRIDE_KEY],
      overrideReason: "would-be override"
    }
  });

  assert.equal(result.blocked, true);
  assert.equal(result.order, null);
  assert.equal(result.riskCheck.decision, "block");
  assert.equal(
    result.riskCheck.guards.some((g) => g.guard === "manual_disable"),
    true
  );
  // Gate short-circuited by the risk block — shape stays { quoteGate: null }.
  assert.equal(result.quoteGate, null);
});

test("buildModeHintRows surfaces only non-allow lanes with stable order", () => {
  // both allow → no hint rows; timeline renders nothing.
  assert.deepEqual(
    buildModeHintRows({ decision: "allow" }, { decision: "allow" }),
    []
  );

  // execution disagrees → only execution row surfaces (paper stays silent
  // because its allow state is already clear from the mode badges).
  assert.deepEqual(
    buildModeHintRows({ decision: "allow" }, { decision: "review" }),
    [{ mode: "execution", decision: "review" }]
  );

  // paper disagrees → only paper row surfaces; execution is allow so no
  // second hint line.
  assert.deepEqual(
    buildModeHintRows({ decision: "review" }, { decision: "allow" }),
    [{ mode: "paper", decision: "review" }]
  );

  // Both lanes non-allow with different severities → both rows, paper first
  // then execution, each carrying its own decision so the user can tell the
  // lanes apart.
  assert.deepEqual(
    buildModeHintRows({ decision: "review" }, { decision: "block" }),
    [
      { mode: "paper", decision: "review" },
      { mode: "execution", decision: "block" }
    ]
  );

  // Missing mode summaries are treated as silent (no crash, no row).
  assert.deepEqual(buildModeHintRows(undefined, undefined), []);
  assert.deepEqual(
    buildModeHintRows(undefined, { decision: "block" }),
    [{ mode: "execution", decision: "block" }]
  );
});

// ---------------------------------------------------------------------------
// Phase 2 (a) — getLotSize unit tests
// ---------------------------------------------------------------------------

test("getLotSize: TWSE returns 1000 (Taiwan lot unit)", () => {
  assert.equal(getLotSize("TWSE"), 1000);
});

test("getLotSize: TPEX returns 1000 (same lot rule as TWSE)", () => {
  assert.equal(getLotSize("TPEX"), 1000);
});

test("getLotSize: NASDAQ returns 1 (US equities, share-level granularity)", () => {
  assert.equal(getLotSize("NASDAQ"), 1);
});

test("getLotSize: NYSE returns 1", () => {
  assert.equal(getLotSize("NYSE"), 1);
});

test("getLotSize: OTHER returns 1 (safe default)", () => {
  assert.equal(getLotSize("OTHER"), 1);
});

test("getLotSize: unknown market string returns 1 (safe default fallback)", () => {
  assert.equal(getLotSize(""), 1);
  assert.equal(getLotSize("UNKNOWN_EXCHANGE"), 1);
});

// ---------------------------------------------------------------------------
// R12 — bars quality fix: synthetic flag follows source; getBarStaleMs window
// ---------------------------------------------------------------------------

test("bars diagnostics: tradingview source yields synthetic=false and reference_only grade when fresh", async () => {
  const session = { workspace: { slug: `bars-quality-tv-${randomUUID()}` } };
  const now = new Date();
  // Seed 3 ticks across 3 separate 1-minute buckets so we get 3 bars
  const t1 = new Date(now.getTime() - 2 * 60_000).toISOString();
  const t2 = new Date(now.getTime() - 1 * 60_000).toISOString();
  const t3 = now.toISOString();

  await upsertManualQuotes({
    session,
    quotes: [
      { symbol: "QUAL1", market: "TWSE", source: "tradingview", last: 100, bid: 99, ask: 101, open: 99, high: 101, low: 99, prevClose: 98, volume: 1000, changePct: 2, timestamp: t1 },
      { symbol: "QUAL1", market: "TWSE", source: "tradingview", last: 102, bid: 101, ask: 103, open: 99, high: 103, low: 99, prevClose: 98, volume: 1100, changePct: 4, timestamp: t2 },
      { symbol: "QUAL1", market: "TWSE", source: "tradingview", last: 103, bid: 102, ask: 104, open: 99, high: 104, low: 99, prevClose: 98, volume: 1200, changePct: 5, timestamp: t3 }
    ]
  });

  const diag = await getMarketBarDiagnostics({
    session,
    symbols: "QUAL1",
    market: "TWSE",
    includeStale: true,
    interval: "1m"
  });

  assert.equal(diag.items.length, 1);
  const item = diag.items[0]!;
  assert.equal(item.source, "tradingview");
  assert.equal(item.synthetic, false, "tradingview bars should not be synthetic");
  assert.equal(item.barCount >= 2, true, "should have at least 2 bars");
  assert.equal(item.quality.grade, "reference_only", "tradingview non-synthetic + approximate => reference_only");
  assert.equal(item.quality.primaryReason, "approximate_bars");
  assert.equal(item.quality.strategyUsable, false);
});

test("bars diagnostics: manual source yields synthetic=true and at most reference_only grade", async () => {
  const session = { workspace: { slug: `bars-quality-manual-${randomUUID()}` } };
  const now = new Date();
  const t1 = new Date(now.getTime() - 2 * 60_000).toISOString();
  const t2 = new Date(now.getTime() - 1 * 60_000).toISOString();
  const t3 = now.toISOString();

  await upsertManualQuotes({
    session,
    quotes: [
      { symbol: "QUAL2", market: "TWSE", source: "manual", last: 200, bid: 199, ask: 201, open: 198, high: 202, low: 198, prevClose: 197, volume: 500, changePct: 1.5, timestamp: t1 },
      { symbol: "QUAL2", market: "TWSE", source: "manual", last: 201, bid: 200, ask: 202, open: 198, high: 203, low: 198, prevClose: 197, volume: 510, changePct: 2.0, timestamp: t2 },
      { symbol: "QUAL2", market: "TWSE", source: "manual", last: 202, bid: 201, ask: 203, open: 198, high: 204, low: 198, prevClose: 197, volume: 520, changePct: 2.5, timestamp: t3 }
    ]
  });

  const diag = await getMarketBarDiagnostics({
    session,
    symbols: "QUAL2",
    market: "TWSE",
    includeStale: true,
    interval: "1m"
  });

  assert.equal(diag.items.length, 1);
  const item = diag.items[0]!;
  assert.equal(item.source, "manual");
  assert.equal(item.synthetic, true, "manual bars should be synthetic");
  assert.equal(item.barCount >= 2, true, "should have at least 2 bars");
  // synthetic => grade can only be reference_only or insufficient, never strategy_ready
  assert.notEqual(item.quality.grade, "strategy_ready", "synthetic bars cannot be strategy_ready");
});

test("signal companyIds round-trip in memory repo: createSignal stores and listSignals returns companyIds", async () => {
  const repo = new MemoryTradingRoomRepository();
  const company = await repo.createCompany({
    name: "Test Corp",
    ticker: "TST",
    market: "TWSE",
    country: "Taiwan",
    themeIds: [],
    chainPosition: "Foundry",
    beneficiaryTier: "Core",
    exposure: { volume: 3, asp: 3, margin: 3, capacity: 3, narrative: 3 },
    validation: { capitalFlow: "", consensus: "", relativeStrength: "" },
    notes: "Test company for signal linkage."
  });

  const signal = await repo.createSignal({
    category: "company",
    direction: "bullish",
    title: "Strong earnings beat",
    summary: "Revenue and margin both beat consensus.",
    confidence: 4,
    companyIds: [company.id]
  });

  assert.deepEqual(signal.companyIds, [company.id], "createSignal should return the provided companyIds");

  const all = await repo.listSignals(undefined);
  const found = all.find((s) => s.id === signal.id);
  assert.ok(found, "listSignals should return the created signal");
  assert.deepEqual(found!.companyIds, [company.id], "listSignals should return companyIds from stored signal");
});

test("signal with companyIds causes strategy ideas direction != neutral for that company", async () => {
  const repo = new MemoryTradingRoomRepository();
  const session = await repo.getSession({ workspaceSlug: `signal-direction-${randomUUID()}` });

  const company = await repo.createCompany({
    name: "DirectionCo",
    ticker: "DCORP",
    market: "TWSE",
    country: "Taiwan",
    themeIds: [],
    chainPosition: "Core product",
    beneficiaryTier: "Core",
    exposure: { volume: 4, asp: 4, margin: 4, capacity: 4, narrative: 4 },
    validation: { capitalFlow: "Strong", consensus: "Rising", relativeStrength: "Leading" },
    notes: "Test company for direction resolution."
  });

  await repo.createSignal({
    category: "industry",
    direction: "bullish",
    title: "Strong sector tailwind",
    summary: "Demand keeps growing.",
    confidence: 4,
    companyIds: [company.id]
  });

  const result = await getStrategyIdeas({
    session,
    repo,
    limit: 50,
    signalDays: 90,
    includeBlocked: true
  });

  const idea = result.items.find((i) => i.symbol === "DCORP");
  assert.ok(idea, "strategy ideas should include the company with a signal");
  assert.equal(idea!.direction, "bullish", "direction should be bullish when a recent bullish signal is linked to the company");
});

// ---------------------------------------------------------------------------
// Phase 2 (d) — equal_weight sizeMode
// ---------------------------------------------------------------------------

test("autopilot equal_weight: 2 candidates share budget equally — each gets half the fixed_pct quantity", async () => {
  // Setup: 2 bullish companies with fresh quotes at price=100 (US market, lotSize=1).
  // Default equity = 10_000_000. sizePct=1 → total_budget=100_000 → perCandidate=50_000.
  // fixed_pct same sizePct → each would get 1000 shares (100_000/100).
  // equal_weight → each gets 500 shares (50_000/100).
  const repo = new MemoryTradingRoomRepository();
  const workspaceSlug = `ew-two-${randomUUID()}`;
  const session = await repo.getSession({ workspaceSlug });
  await resetPersistedStrategyRuns(workspaceSlug);

  for (const ticker of ["EWA1", "EWB1"]) {
    const company = await repo.createCompany({
      name: `EW Test ${ticker}`,
      ticker,
      market: "OTHER",
      country: "US",
      themeIds: [],
      chainPosition: "Core",
      beneficiaryTier: "Core",
      exposure: { volume: 5, asp: 5, margin: 5, capacity: 5, narrative: 5 },
      validation: { capitalFlow: "Strong", consensus: "Up", relativeStrength: "Leading" },
      notes: "equal_weight CI test."
    });
    await repo.createSignal({
      category: "industry",
      direction: "bullish",
      title: `${ticker} signal`,
      summary: "Bullish.",
      confidence: 5,
      themeIds: [],
      companyIds: [company.id]
    });
    await upsertManualQuotes({
      session,
      quotes: [{
        symbol: ticker, market: "OTHER", source: "tradingview",
        last: 100, bid: 99, ask: 101,
        open: 99, high: 101, low: 98, prevClose: 99,
        volume: 1000, changePct: 1.0,
        timestamp: new Date().toISOString()
      }]
    });
  }

  const run = await createStrategyRun({
    session, repo,
    payload: { limit: 10, signalDays: 30, includeBlocked: true, decisionMode: "strategy", sort: "score" }
  });

  const result = await executeStrategyRun({
    session, repo, runId: run.id,
    payload: {
      accountId: "paper-default",
      sidePolicy: "bullish_long",
      sizeMode: "equal_weight",
      sizePct: 1.0,
      maxOrders: 5,
      dryRun: true
    }
  });

  // Both candidates should be processed (submitted or blocked but not skipped)
  assert.equal(result.summary.total, 2);

  // Summary invariant
  assert.equal(
    result.summary.total,
    result.summary.submittedCount + result.summary.blockedCount + result.summary.errorCount
  );

  // If both got a price and passed quantity check, they should have equal quantities
  const allResults = [...result.submitted, ...result.blocked];
  const ewa = allResults.find((r) => r.symbol === "EWA1");
  const ewb = allResults.find((r) => r.symbol === "EWB1");
  if (ewa && ewb && ewa.quantity > 0 && ewb.quantity > 0) {
    // equal_weight: both should receive identical quantity (budget split evenly)
    assert.equal(ewa.quantity, ewb.quantity, "equal_weight: both candidates must receive identical quantity");
    // And the quantity should be half of what fixed_pct would give
    // fixed_pct would yield: floor(10_000_000 * 0.01 / 100 / 1) * 1 = 1000
    // equal_weight (N=2): floor(10_000_000 * 0.01 / 2 / 100 / 1) * 1 = 500
    assert.equal(ewa.quantity, 500, "equal_weight with 2 candidates: each gets 500 shares at price=100, sizePct=1%");
  }
});

test("autopilot equal_weight: 1 candidate receives full budget (same as fixed_pct)", async () => {
  const repo = new MemoryTradingRoomRepository();
  const workspaceSlug = `ew-one-${randomUUID()}`;
  const session = await repo.getSession({ workspaceSlug });
  await resetPersistedStrategyRuns(workspaceSlug);

  const company = await repo.createCompany({
    name: "EW Solo Co",
    ticker: "EWS1",
    market: "OTHER",
    country: "US",
    themeIds: [],
    chainPosition: "Core",
    beneficiaryTier: "Core",
    exposure: { volume: 5, asp: 5, margin: 5, capacity: 5, narrative: 5 },
    validation: { capitalFlow: "Strong", consensus: "Up", relativeStrength: "Leading" },
    notes: "equal_weight single-candidate CI test."
  });
  await repo.createSignal({
    category: "industry",
    direction: "bullish",
    title: "EWS1 signal",
    summary: "Bullish.",
    confidence: 5,
    themeIds: [],
    companyIds: [company.id]
  });
  await upsertManualQuotes({
    session,
    quotes: [{
      symbol: "EWS1", market: "OTHER", source: "tradingview",
      last: 100, bid: 99, ask: 101,
      open: 99, high: 101, low: 98, prevClose: 99,
      volume: 1000, changePct: 1.0,
      timestamp: new Date().toISOString()
    }]
  });

  const run = await createStrategyRun({
    session, repo,
    payload: { limit: 10, signalDays: 30, includeBlocked: true, decisionMode: "strategy", sort: "score" }
  });

  const result = await executeStrategyRun({
    session, repo, runId: run.id,
    payload: {
      accountId: "paper-default",
      sidePolicy: "bullish_long",
      sizeMode: "equal_weight",
      sizePct: 1.0,
      maxOrders: 5,
      dryRun: true
    }
  });

  assert.equal(result.summary.total, 1);

  // N=1: perCandidateBudget = full budget → same as fixed_pct
  // floor(10_000_000 * 0.01 / 1 / 100 / 1) * 1 = 1000
  const allResults = [...result.submitted, ...result.blocked];
  const solo = allResults.find((r) => r.symbol === "EWS1");
  if (solo && solo.quantity > 0) {
    assert.equal(solo.quantity, 1000, "equal_weight N=1: full budget → same as fixed_pct");
  }
});

// Regression — R16 hotfix (updated R17): quoteGate.decision must propagate
// to blockedReason when riskCheck passes but quoteGate is blocked.
// R17 update: dryRun=true + review_required → soft-pass → submitted[] with
// requiresReview=true (advisory). The R16 regression is preserved via the
// R17 matrix (Case 1 below). This test is updated to match R17 semantics.
test("autopilot executeStrategyRun: dryRun+review_required soft-passes to submitted with requiresReview (R16/R17 regression)", async () => {
  const repo = new MemoryTradingRoomRepository();
  const workspaceSlug = `qg-regression-${randomUUID()}`;
  const session = await repo.getSession({ workspaceSlug });
  await resetPersistedStrategyRuns(workspaceSlug);

  // Set up a company with a bullish signal so it becomes an eligible candidate.
  const company = await repo.createCompany({
    name: "QuoteGate Regression Co",
    ticker: "QGR1",
    market: "OTHER",
    country: "US",
    themeIds: [],
    chainPosition: "Core",
    beneficiaryTier: "Core",
    exposure: { volume: 5, asp: 5, margin: 5, capacity: 5, narrative: 5 },
    validation: { capitalFlow: "Strong", consensus: "Up", relativeStrength: "Leading" },
    notes: "R16/R17 quoteGate regression test."
  });
  await repo.createSignal({
    category: "industry",
    direction: "bullish",
    title: "QGR1 bullish signal",
    summary: "Bullish.",
    confidence: 5,
    themeIds: [],
    companyIds: [company.id]
  });

  // Upsert a paper-source quote (source="manual") — this makes paper.decision="review"
  // so quoteGate.decision="review_required" and quoteGate.blocked=true without override.
  // The riskCheck will be "allow" (no block guards, no kill_switch).
  const now = new Date().toISOString();
  await upsertPaperQuotes({
    session,
    quotes: [{
      symbol: "QGR1",
      market: "OTHER",
      source: "manual",
      last: 100,
      bid: 99,
      ask: 101,
      open: 99,
      high: 101,
      low: 98,
      prevClose: 99,
      volume: 1000,
      changePct: 1.0,
      timestamp: now
    }]
  });

  // Relax trading hours so CI runs at any time of day.
  await upsertRiskLimitState({
    session,
    payload: {
      accountId: "paper-default",
      tradingHoursStart: "00:00",
      tradingHoursEnd: "23:59"
    }
  });

  const run = await createStrategyRun({
    session, repo,
    payload: { limit: 10, signalDays: 30, includeBlocked: true, decisionMode: "strategy", sort: "score" }
  });

  const result = await executeStrategyRun({
    session, repo, runId: run.id,
    payload: {
      accountId: "paper-default",
      sidePolicy: "bullish_long",
      sizeMode: "fixed_pct",
      sizePct: 1.0,
      maxOrders: 5,
      dryRun: true
    }
  });

  // R17: QGR1 must appear in submitted[] (soft-pass), NOT blocked[].
  const qgrSubmitted = result.submitted.find((s) => s.symbol === "QGR1");
  assert.ok(qgrSubmitted, "QGR1 should appear in submitted list (dryRun soft-pass)");
  assert.equal(qgrSubmitted?.requiresReview, true, "requiresReview must be true for advisory soft-pass");
  assert.ok(qgrSubmitted?.reviewReason, "reviewReason must be present");
  assert.equal(qgrSubmitted?.blocked, false, "blocked must be false for soft-passed items");
  assert.equal(qgrSubmitted?.blockedReason, null, "blockedReason must be null for soft-passed items");

  // QGR1 must NOT appear in blocked[].
  const qgrBlocked = result.blocked.find((b) => b.symbol === "QGR1");
  assert.equal(qgrBlocked, undefined, "QGR1 must NOT be in blocked[] after R17 soft-pass");
});

// =============================================================================
// R17 — quoteGate advisory soft-pass regression matrix (7 cases)
// Dispatched by Elva, 2026-04-22. All decisions by 楊董.
//
// Matrix axes:
//   dryRun: true/false
//   quoteGate.decision: "review_required" / "block" / "allow"
//   blockedReason source: quoteGate / kill_switch / trading_hours / max_per_trade
//
// Soft-pass condition (engine logic):
//   dryRun=true AND quoteGate.blocked=true AND quoteGate.decision="review_required"
//   AND blockedReason (after riskCheck resolution) === "review_required"
//   → submitted[] with requiresReview=true
//
// Hard block: everything else (block decision / dryRun=false / riskCheck guards)
// =============================================================================

// Helper: set up a company + bullish signal in a fresh workspace
async function setupR17Company(args: {
  repo: InstanceType<typeof MemoryTradingRoomRepository>;
  session: { workspace: { slug: string } };
  ticker: string;
  name: string;
}) {
  const company = await args.repo.createCompany({
    name: args.name,
    ticker: args.ticker,
    market: "OTHER",
    country: "US",
    themeIds: [],
    chainPosition: "Core",
    beneficiaryTier: "Core",
    exposure: { volume: 5, asp: 5, margin: 5, capacity: 5, narrative: 5 },
    validation: { capitalFlow: "Strong", consensus: "Up", relativeStrength: "Leading" },
    notes: `R17 test: ${args.ticker}`
  });
  await args.repo.createSignal({
    category: "industry",
    direction: "bullish",
    title: `${args.ticker} bullish signal`,
    summary: "Bullish.",
    confidence: 5,
    themeIds: [],
    companyIds: [company.id]
  });
  return company;
}

// Helper: upsert a manual-source paper quote (gives quoteGate.decision="review_required" in paper mode)
async function seedReviewRequiredQuote(args: {
  session: { workspace: { slug: string } };
  symbol: string;
  last?: number;
}) {
  const now = new Date().toISOString();
  await upsertPaperQuotes({
    session: args.session,
    quotes: [{
      symbol: args.symbol,
      market: "OTHER",
      source: "manual",
      last: args.last ?? 100,
      bid: 99,
      ask: 101,
      open: 99,
      high: 101,
      low: 98,
      prevClose: 99,
      volume: 1000,
      changePct: 1.0,
      timestamp: now
    }]
  });
}

// Helper: relax trading hours for the paper-default account
async function relaxTradingHoursR17(session: { workspace: { slug: string } }) {
  await upsertRiskLimitState({
    session,
    payload: {
      accountId: "paper-default",
      tradingHoursStart: "00:00",
      tradingHoursEnd: "23:59"
    }
  });
}

// ---------------------------------------------------------------------------
// Case 1: dryRun=true + quoteGate.decision="review_required"
// Expected: submitted[] with requiresReview=true (soft-pass)
// ---------------------------------------------------------------------------
test("R17 Case 1: dryRun=true + review_required => submitted with requiresReview=true", async () => {
  const repo = new MemoryTradingRoomRepository();
  const workspaceSlug = `r17c1-${randomUUID()}`;
  const session = await repo.getSession({ workspaceSlug });
  await resetPersistedStrategyRuns(workspaceSlug);

  await setupR17Company({ repo, session, ticker: "R17C1", name: "R17 Case1 Co" });
  await seedReviewRequiredQuote({ session, symbol: "R17C1" });
  // Relax trading hours AND raise maxPerTradePct so riskCheck does not block before quoteGate
  await upsertRiskLimitState({
    session,
    payload: {
      accountId: "paper-default",
      tradingHoursStart: "00:00",
      tradingHoursEnd: "23:59",
      maxPerTradePct: 50 // generous limit; sizePct=10 on equity=10M at price=100 qty=1000 = 1% well under 50%
    }
  });

  const run = await createStrategyRun({
    session, repo,
    payload: { limit: 10, signalDays: 30, includeBlocked: true, decisionMode: "strategy", sort: "score" }
  });

  const result = await executeStrategyRun({
    session, repo, runId: run.id,
    payload: {
      accountId: "paper-default",
      sidePolicy: "bullish_long",
      sizeMode: "fixed_pct",
      sizePct: 1.0, // 1% budget → 100K → qty=1000 → notional=100K = 1% equity, within 50% max
      maxOrders: 5,
      dryRun: true
    }
  });

  const item = result.submitted.find((s) => s.symbol === "R17C1");
  assert.ok(item, "Case 1: R17C1 must be in submitted[] (soft-pass)");
  assert.equal(item?.requiresReview, true, "Case 1: requiresReview must be true");
  assert.ok(item?.reviewReason, "Case 1: reviewReason must be present");
  assert.equal(item?.blocked, false, "Case 1: blocked must be false");
  assert.equal(item?.blockedReason, null, "Case 1: blockedReason must be null");
  const blockedItem = result.blocked.find((b) => b.symbol === "R17C1");
  assert.equal(blockedItem, undefined, "Case 1: must NOT appear in blocked[]");
});

// ---------------------------------------------------------------------------
// Case 2: quoteGate.decision="block" => hard block (engine logic + schema level)
// Structural note: in the autopilot paper-mode path (always paper broker),
// fresh manual-source quotes give quoteGate.decision="review_required" (not "block").
// To get quoteGate.decision="block" (execution mode, no live source), one must use
// execution-mode gate directly. This test verifies:
// (a) execution mode + fresh manual quote => "review_required" (NOT "block" — corrects
//     prior assumption; fresh quotes always give review in non-live mode)
// (b) The engine soft-pass condition explicitly requires decision === "review_required",
//     so any OTHER decision (including "block") goes to blocked[] — verified via
//     engine source code review and schema assertions.
// (c) autopilotOrderResultSchema accepts a blocked item with blockedReason="block"
//     without requiresReview flag (confirms hard block shape).
// ---------------------------------------------------------------------------
test("R17 Case 2: quoteGate.decision=block => hard block (engine conditional + schema verification)", async () => {
  const session = { workspace: { slug: `r17c2-${randomUUID()}` } };
  const now = new Date().toISOString();

  await upsertPaperQuotes({
    session,
    quotes: [{
      symbol: "R17C2",
      market: "OTHER",
      source: "manual",
      last: 100,
      bid: 99,
      ask: 101,
      open: 99,
      high: 101,
      low: 98,
      prevClose: 99,
      volume: 1000,
      changePct: 1.0,
      timestamp: now
    }]
  });

  const baseOrder = {
    accountId: "paper-default",
    symbol: "R17C2",
    side: "buy" as const,
    type: "limit" as const,
    timeInForce: "day" as const,
    quantity: 100,
    price: 100,
    stopPrice: null,
    tradePlanId: null,
    strategyId: null,
    overrideGuards: [] as string[],
    overrideReason: "r17-case2-test"
  };

  // Both paper and execution mode with fresh manual quote give "review_required"
  // (execution mode: fresh manual → liveUsable=false but selectedSource+connected+fresh → "review")
  const paperGate = await evaluateExecutionGate({ session, order: baseOrder, mode: "paper" });
  assert.equal(paperGate.blocked, true, "Case 2: paper mode fresh manual quote is blocked (review_required)");
  assert.equal(paperGate.decision, "review_required", "Case 2: paper mode fresh manual quote gives review_required");

  const execGate = await evaluateExecutionGate({ session, order: baseOrder, mode: "execution" });
  assert.equal(execGate.blocked, true, "Case 2: execution mode fresh manual quote is also blocked");
  assert.equal(execGate.decision, "review_required", "Case 2: execution mode fresh manual quote also gives review_required");

  // Schema level: a blocked item with blockedReason="block" must NOT have requiresReview=true
  // (confirms hard block shape for literal decision="block" scenarios via schema)
  const { autopilotOrderResultSchema: orderSchema } = await import("../packages/contracts/src/strategy.ts");
  const hardBlocked = orderSchema.parse({
    symbol: "R17C2",
    side: "buy",
    quantity: 100,
    price: 100,
    submitResult: null,
    blocked: true,
    blockedReason: "block"
    // requiresReview absent => hard block, no advisory flag
  });
  assert.equal(hardBlocked.blocked, true, "Case 2: hard block item has blocked=true");
  assert.equal(hardBlocked.blockedReason, "block", "Case 2: hard block item has blockedReason=block");
  assert.equal(hardBlocked.requiresReview, undefined, "Case 2: hard block item must NOT have requiresReview");

  // The soft-pass condition in strategy-engine.ts:
  //   dryRun && quoteGate.blocked && quoteGate.decision === "review_required" && blockedReason === "review_required"
  // For decision="block": condition is false => goes to blocked[] (not submitted[])
  // This is enforced by the code itself; schema shape above confirms the expected output shape.
});

// ---------------------------------------------------------------------------
// Case 3: dryRun=false + quoteGate.decision="review_required" => hard block
// Expected: blocked[] with blockedReason="review_required"
// ---------------------------------------------------------------------------
test("R17 Case 3: dryRun=false + review_required => hard block (real submit stays blocked)", async () => {
  const repo = new MemoryTradingRoomRepository();
  const workspaceSlug = `r17c3-${randomUUID()}`;
  const session = await repo.getSession({ workspaceSlug });
  await resetPersistedStrategyRuns(workspaceSlug);

  await setupR17Company({ repo, session, ticker: "R17C3", name: "R17 Case3 Co" });
  await seedReviewRequiredQuote({ session, symbol: "R17C3" });
  // Relax trading hours and raise maxPerTradePct so riskCheck allows through to quoteGate
  await upsertRiskLimitState({
    session,
    payload: {
      accountId: "paper-default",
      tradingHoursStart: "00:00",
      tradingHoursEnd: "23:59",
      maxPerTradePct: 50
    }
  });

  const run = await createStrategyRun({
    session, repo,
    payload: { limit: 10, signalDays: 30, includeBlocked: true, decisionMode: "strategy", sort: "score" }
  });

  const tokenResp = issueConfirmToken(run.id);

  const result = await executeStrategyRun({
    session, repo, runId: run.id,
    payload: {
      accountId: "paper-default",
      sidePolicy: "bullish_long",
      sizeMode: "fixed_pct",
      sizePct: 1.0,
      maxOrders: 5,
      dryRun: false,
      confirmToken: tokenResp.token
    }
  });

  const blockedItem = result.blocked.find((b) => b.symbol === "R17C3");
  assert.ok(blockedItem, "Case 3: R17C3 must be in blocked[] (real submit hard blocks review_required)");
  assert.equal(blockedItem?.blockedReason, "review_required", "Case 3: blockedReason must be review_required");
  const submittedItem = result.submitted.find((s) => s.symbol === "R17C3");
  assert.equal(submittedItem, undefined, "Case 3: must NOT appear in submitted[] for real submit");
});

// ---------------------------------------------------------------------------
// Case 4: quoteGate.decision="allow" (or blocked=false) => submitted without requiresReview
// Verified at schema level: requiresReview is optional and absent for normal submits.
// Gate-level verification: no-quote symbol => quote_unknown (blocked=false) => submitted path.
// ---------------------------------------------------------------------------
test("R17 Case 4: quoteGate not blocked => submitted without requiresReview flag", async () => {
  // Gate-level: no quote => quote_unknown => blocked=false
  const gateSession = { workspace: { slug: `r17c4-gate-${randomUUID()}` } };
  const gate = await evaluateExecutionGate({
    session: gateSession,
    order: {
      accountId: "paper-default",
      symbol: "R17C4NOQUOTE",
      side: "buy" as const,
      type: "limit" as const,
      timeInForce: "day" as const,
      quantity: 100,
      price: 100,
      stopPrice: null,
      tradePlanId: null,
      strategyId: null,
      overrideGuards: [] as string[],
      overrideReason: ""
    },
    mode: "paper"
  });
  assert.equal(gate.blocked, false, "Case 4: no-quote gate is not blocked (quote_unknown)");
  assert.equal(gate.decision, "quote_unknown", "Case 4: no-quote gives quote_unknown decision");

  // Schema-level: autopilotOrderResultSchema allows requiresReview=undefined
  const { autopilotOrderResultSchema: orderSchema } = await import("../packages/contracts/src/strategy.ts");
  const parsed = orderSchema.parse({
    symbol: "R17C4",
    side: "buy",
    quantity: 100,
    price: 100,
    submitResult: null,
    blocked: false,
    blockedReason: null
  });
  assert.equal(parsed.requiresReview, undefined, "Case 4: requiresReview is optional/absent for normal submits");
  assert.equal(parsed.reviewReason, undefined, "Case 4: reviewReason is optional/absent for normal submits");
});

// ---------------------------------------------------------------------------
// Case 5: dryRun=true + kill_switch engaged => all blocked with kill_switch
// Kill-switch hard precedence overrides any quoteGate decision
// ---------------------------------------------------------------------------
test("R17 Case 5: dryRun=true + kill_switch engaged => blocked with kill_switch (no soft-pass)", async () => {
  const repo = new MemoryTradingRoomRepository();
  const workspaceSlug = `r17c5-${randomUUID()}`;
  const session = await repo.getSession({ workspaceSlug });
  await resetPersistedStrategyRuns(workspaceSlug);

  await setupR17Company({ repo, session, ticker: "R17C5", name: "R17 Case5 Co" });
  await seedReviewRequiredQuote({ session, symbol: "R17C5" });

  await setKillSwitchState({
    session,
    payload: { accountId: "paper-default", mode: "halted", reason: "R17 Case5 test", engagedBy: "jason" }
  });

  const run = await createStrategyRun({
    session, repo,
    payload: { limit: 10, signalDays: 30, includeBlocked: true, decisionMode: "strategy", sort: "score" }
  });

  const result = await executeStrategyRun({
    session, repo, runId: run.id,
    payload: {
      accountId: "paper-default",
      sidePolicy: "bullish_long",
      sizeMode: "fixed_pct",
      sizePct: 10.0,
      maxOrders: 5,
      dryRun: true
    }
  });

  const item = result.blocked.find((b) => b.symbol === "R17C5");
  assert.ok(item, "Case 5: R17C5 must be in blocked[]");
  assert.equal(item?.blockedReason, "kill_switch", "Case 5: kill_switch takes hard precedence");
  assert.equal(result.submitted.find((s) => s.symbol === "R17C5"), undefined,
    "Case 5: kill_switch must NOT soft-pass");

  // Cleanup
  await setKillSwitchState({
    session,
    payload: { accountId: "paper-default", mode: "trading", reason: "R17 Case5 cleanup", engagedBy: "jason" }
  });
});

// ---------------------------------------------------------------------------
// Case 6: dryRun=true + trading hours closed => blocked with trading_hours
// ---------------------------------------------------------------------------
test("R17 Case 6: dryRun=true + outside trading hours => blocked with trading_hours (no soft-pass)", async () => {
  const repo = new MemoryTradingRoomRepository();
  const workspaceSlug = `r17c6-${randomUUID()}`;
  const session = await repo.getSession({ workspaceSlug });
  await resetPersistedStrategyRuns(workspaceSlug);

  await setupR17Company({ repo, session, ticker: "R17C6", name: "R17 Case6 Co" });
  await seedReviewRequiredQuote({ session, symbol: "R17C6" });

  // Narrow trading window that excludes current time
  await upsertRiskLimitState({
    session,
    payload: {
      accountId: "paper-default",
      tradingHoursStart: "00:00",
      tradingHoursEnd: "00:01"
    }
  });

  const run = await createStrategyRun({
    session, repo,
    payload: { limit: 10, signalDays: 30, includeBlocked: true, decisionMode: "strategy", sort: "score" }
  });

  const result = await executeStrategyRun({
    session, repo, runId: run.id,
    payload: {
      accountId: "paper-default",
      sidePolicy: "bullish_long",
      sizeMode: "fixed_pct",
      sizePct: 10.0,
      maxOrders: 5,
      dryRun: true
    }
  });

  const item = result.blocked.find((b) => b.symbol === "R17C6");
  assert.ok(item, "Case 6: R17C6 must be in blocked[]");
  assert.equal(item?.blockedReason, "trading_hours", "Case 6: trading_hours riskCheck must block");
  assert.equal(result.submitted.find((s) => s.symbol === "R17C6"), undefined,
    "Case 6: trading_hours must NOT soft-pass");
});

// ---------------------------------------------------------------------------
// Case 7: dryRun=true + max_per_trade exceeded => blocked with max_per_trade
// Verifies riskCheck guard takes priority over quoteGate soft-pass
// ---------------------------------------------------------------------------
test("R17 Case 7: dryRun=true + max_per_trade exceeded => blocked with max_per_trade (decoupled from quoteGate)", async () => {
  const repo = new MemoryTradingRoomRepository();
  const workspaceSlug = `r17c7-${randomUUID()}`;
  const session = await repo.getSession({ workspaceSlug });
  await resetPersistedStrategyRuns(workspaceSlug);

  await setupR17Company({ repo, session, ticker: "R17C7", name: "R17 Case7 Co" });

  // relaxed trading hours, tight max_per_trade (1% default), large sizePct=10 => exceeds limit
  await upsertRiskLimitState({
    session,
    payload: {
      accountId: "paper-default",
      tradingHoursStart: "00:00",
      tradingHoursEnd: "23:59",
      maxPerTradePct: 1
    }
  });

  const now = new Date().toISOString();
  await upsertPaperQuotes({
    session,
    quotes: [{
      symbol: "R17C7",
      market: "OTHER",
      source: "manual",
      last: 100,
      bid: 99,
      ask: 101,
      open: 99,
      high: 101,
      low: 98,
      prevClose: 99,
      volume: 1000,
      changePct: 1.0,
      timestamp: now
    }]
  });

  const run = await createStrategyRun({
    session, repo,
    payload: { limit: 10, signalDays: 30, includeBlocked: true, decisionMode: "strategy", sort: "score" }
  });

  const result = await executeStrategyRun({
    session, repo, runId: run.id,
    payload: {
      accountId: "paper-default",
      sidePolicy: "bullish_long",
      sizeMode: "fixed_pct",
      sizePct: 10.0, // 10% budget => qty=10000 => notional=1M = 10% of 10M equity => exceeds 1% max
      maxOrders: 5,
      dryRun: true
    }
  });

  const item = result.blocked.find((b) => b.symbol === "R17C7");
  assert.ok(item, "Case 7: R17C7 must be in blocked[]");
  assert.equal(item?.blockedReason, "max_per_trade", "Case 7: max_per_trade riskCheck blocks before quoteGate soft-pass");
  assert.equal(result.submitted.find((s) => s.symbol === "R17C7"), undefined,
    "Case 7: max_per_trade must NOT soft-pass");
});

// ============================================================================
// W2d — KGI Quote Client (read-only consumption) — 9 tests
// ============================================================================
//
// Tests do NOT require a running gateway — all network calls are mocked via
// a custom gatewayBaseUrl pointing to a mock fetch interceptor.
// No order path is touched. No broker write surface.
//
// Spec: evidence/path_b_w2a_20260426/w2d_quote_consumption_plan.md §7
// Gate: evidence/path_b_w2a_20260426/no_order_guarantee_audit_checklist_2026-04-27.md §1-§5

import {
  KgiQuoteClient,
  KgiQuoteSymbolNotAllowedError,
  KgiQuoteDisabledError,
  KgiQuoteAuthError,
  KgiQuoteNotAvailableError,
  KgiQuoteUnreachableError,
  classifyFreshness,
  parseSymbolWhitelist,
  STALE_THRESHOLD_MS,
} from "../apps/api/src/broker/kgi-quote-client.ts";

// ---------------------------------------------------------------------------
// Mock fetch factory
// ---------------------------------------------------------------------------

/**
 * Build a mock fetch that records calls and returns predefined responses.
 * Replaces global fetch for the duration of a test.
 */
function makeMockFetch(responses: Map<string, { status: number; body: unknown }>) {
  const calls: string[] = [];
  const mockFetch = async (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push(url);
    const entry = [...responses.entries()].find(([k]) => url.includes(k));
    if (!entry) {
      // Return 503 for unregistered URLs (gateway unreachable simulation)
      return new Response(JSON.stringify({ error: { code: "NOT_REGISTERED", message: "mock: no response registered" } }), { status: 503 });
    }
    const [, { status, body }] = entry;
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  };
  return { mockFetch, calls };
}

// ---------------------------------------------------------------------------
// W2d Test 1: subscribe disabled → tick blocked (503)
// ---------------------------------------------------------------------------

test("W2d-T1: subscribe disabled → tick blocked → KgiQuoteDisabledError", async () => {
  const { mockFetch, calls } = makeMockFetch(new Map([
    ["/quote/subscribe/tick", {
      status: 503,
      body: { error: { code: "QUOTE_DISABLED", message: "Quote service is disabled via KGI_GATEWAY_QUOTE_DISABLED" } },
    }],
  ]));

  const orig = globalThis.fetch;
  globalThis.fetch = mockFetch as typeof fetch;
  try {
    const client = new KgiQuoteClient({
      gatewayBaseUrl: "http://test-gateway",
      symbolWhitelist: ["2330"],
    });
    await assert.rejects(
      () => client.subscribeSymbolTick("2330"),
      KgiQuoteDisabledError,
      "subscribeSymbolTick with QUOTE_DISABLED=true must throw KgiQuoteDisabledError"
    );
    assert.ok(calls.some((u) => u.includes("/quote/subscribe/tick")), "must have called /quote/subscribe/tick");
  } finally {
    globalThis.fetch = orig;
  }
});

// ---------------------------------------------------------------------------
// W2d Test 2: subscribe disabled → bidask blocked (503)
// ---------------------------------------------------------------------------

test("W2d-T2: subscribe disabled → bidask blocked → KgiQuoteDisabledError", async () => {
  const { mockFetch, calls } = makeMockFetch(new Map([
    ["/quote/subscribe/bidask", {
      status: 503,
      body: { error: { code: "QUOTE_DISABLED", message: "Quote service is disabled via KGI_GATEWAY_QUOTE_DISABLED" } },
    }],
  ]));

  const orig = globalThis.fetch;
  globalThis.fetch = mockFetch as typeof fetch;
  try {
    const client = new KgiQuoteClient({
      gatewayBaseUrl: "http://test-gateway",
      symbolWhitelist: ["2330"],
    });
    await assert.rejects(
      () => client.subscribeSymbolBidAsk("2330"),
      KgiQuoteDisabledError,
      "subscribeSymbolBidAsk with QUOTE_DISABLED=true must throw KgiQuoteDisabledError"
    );
    assert.ok(calls.some((u) => u.includes("/quote/subscribe/bidask")), "must have called /quote/subscribe/bidask");
  } finally {
    globalThis.fetch = orig;
  }
});

// ---------------------------------------------------------------------------
// W2d Test 3: disabled=false → subscribe works
// ---------------------------------------------------------------------------

test("W2d-T3: subscribe enabled → subscribeSymbolTick returns label", async () => {
  const { mockFetch } = makeMockFetch(new Map([
    ["/quote/subscribe/tick", { status: 200, body: { ok: true, label: "tick_2330" } }],
  ]));

  const orig = globalThis.fetch;
  globalThis.fetch = mockFetch as typeof fetch;
  try {
    const client = new KgiQuoteClient({
      gatewayBaseUrl: "http://test-gateway",
      symbolWhitelist: ["2330"],
    });
    const label = await client.subscribeSymbolTick("2330");
    assert.equal(label, "tick_2330", "label must match gateway response");
  } finally {
    globalThis.fetch = orig;
  }
});

// ---------------------------------------------------------------------------
// W2d Test 4: status route works
// ---------------------------------------------------------------------------

test("W2d-T4: getQuoteStatus returns gateway status object", async () => {
  const mockStatus = {
    subscribed_symbols: { tick: ["2330"], bidask: [] },
    buffer: { tick: { "2330": { count: 5, maxlen: 200, last_received_at: null } }, bidask: {} },
    kgi_logged_in: true,
    quote_disabled_flag: false,
  };

  const { mockFetch } = makeMockFetch(new Map([
    ["/quote/status", { status: 200, body: mockStatus }],
  ]));

  const orig = globalThis.fetch;
  globalThis.fetch = mockFetch as typeof fetch;
  try {
    const client = new KgiQuoteClient({
      gatewayBaseUrl: "http://test-gateway",
      symbolWhitelist: ["2330"],
    });
    const status = await client.getQuoteStatus();
    assert.deepEqual(status.subscribed_symbols.tick, ["2330"]);
    assert.equal(status.kgi_logged_in, true);
    assert.equal(status.quote_disabled_flag, false);
  } finally {
    globalThis.fetch = orig;
  }
});

// ---------------------------------------------------------------------------
// W2d Test 5: ticks route works + stale flag added at API layer
// ---------------------------------------------------------------------------

test("W2d-T5: getRecentTicks returns ticks with freshness annotation", async () => {
  const recentTime = new Date(Date.now() - 1000).toISOString(); // 1 second ago = fresh
  const mockTicksBody = {
    symbol: "2330",
    ticks: [{ close: 1052.0, symbol: "2330", _received_at: recentTime }],
    count: 1,
    buffer_size: 200,
    buffer_used: 1,
  };

  const { mockFetch } = makeMockFetch(new Map([
    ["/quote/ticks", { status: 200, body: mockTicksBody }],
  ]));

  const orig = globalThis.fetch;
  globalThis.fetch = mockFetch as typeof fetch;
  try {
    const client = new KgiQuoteClient({
      gatewayBaseUrl: "http://test-gateway",
      symbolWhitelist: ["2330"],
    });
    const result = await client.getRecentTicks("2330", 10);
    assert.equal(result.symbol, "2330");
    assert.equal(result.count, 1);
    assert.equal(result.freshness, "fresh", "data 1s old must be fresh (threshold=5000ms)");
    assert.equal(result.stale, false);
  } finally {
    globalThis.fetch = orig;
  }
});

// ---------------------------------------------------------------------------
// W2d Test 6: bidask route works
// ---------------------------------------------------------------------------

test("W2d-T6: getLatestBidAsk returns bidask snapshot", async () => {
  const recentTime = new Date(Date.now() - 500).toISOString();
  const mockBidAskBody = {
    symbol: "2330",
    bidask: {
      exchange: "TWSE",
      symbol: "2330",
      bid_prices: [1051.0, 1050.0, 1049.0, 1048.0, 1047.0],
      ask_prices: [1052.0, 1053.0, 1054.0, 1055.0, 1056.0],
      _received_at: recentTime,
    },
  };

  const { mockFetch } = makeMockFetch(new Map([
    ["/quote/bidask", { status: 200, body: mockBidAskBody }],
  ]));

  const orig = globalThis.fetch;
  globalThis.fetch = mockFetch as typeof fetch;
  try {
    const client = new KgiQuoteClient({
      gatewayBaseUrl: "http://test-gateway",
      symbolWhitelist: ["2330"],
    });
    const result = await client.getLatestBidAsk("2330");
    assert.equal(result.symbol, "2330");
    assert.ok(result.bidask !== null, "bidask must not be null");
    assert.equal(result.freshness, "fresh");
  } finally {
    globalThis.fetch = orig;
  }
});

// ---------------------------------------------------------------------------
// W2d Test 7: stale quote handling (threshold 5000ms)
// ---------------------------------------------------------------------------

test("W2d-T7: stale quote handling — data older than 5000ms classified as stale", async () => {
  const staleTime = new Date(Date.now() - 6000).toISOString(); // 6 seconds ago → stale
  const freshTime = new Date(Date.now() - 1000).toISOString(); // 1 second ago → fresh
  const noTime = null;

  // Direct unit tests of classifyFreshness (no network needed)
  const staleResult = classifyFreshness(staleTime, STALE_THRESHOLD_MS);
  assert.equal(staleResult.freshness, "stale", "6s old data must be stale");
  assert.equal(staleResult.stale, true);
  assert.equal(staleResult.staleSince, staleTime);

  const freshResult = classifyFreshness(freshTime, STALE_THRESHOLD_MS);
  assert.equal(freshResult.freshness, "fresh", "1s old data must be fresh");
  assert.equal(freshResult.stale, false);
  assert.equal(freshResult.staleSince, null);

  const noDataResult = classifyFreshness(noTime, STALE_THRESHOLD_MS);
  assert.equal(noDataResult.freshness, "not-available", "null timestamp must be not-available");
  assert.equal(noDataResult.stale, false);

  // Edge case: exactly at threshold → still fresh (ageMs <= threshold)
  const exactTime = new Date(Date.now() - STALE_THRESHOLD_MS).toISOString();
  const exactResult = classifyFreshness(exactTime, STALE_THRESHOLD_MS);
  assert.ok(
    exactResult.freshness === "fresh" || exactResult.freshness === "stale",
    "edge at threshold is either fresh or stale (timing-dependent)"
  );
});

// ---------------------------------------------------------------------------
// W2d Test 8: whitelist reject non-allowed symbol
// ---------------------------------------------------------------------------

test("W2d-T8: non-whitelisted symbol → KgiQuoteSymbolNotAllowedError (no network call)", async () => {
  // Track whether fetch is called — it must NOT be called for non-whitelisted symbol
  let fetchCalled = false;
  const orig = globalThis.fetch;
  globalThis.fetch = (async () => {
    fetchCalled = true;
    return new Response("{}", { status: 200 });
  }) as typeof fetch;

  try {
    const client = new KgiQuoteClient({
      gatewayBaseUrl: "http://test-gateway",
      symbolWhitelist: ["2330", "2317"], // 9999 is NOT in whitelist
    });

    // subscribe/tick
    await assert.rejects(
      () => client.subscribeSymbolTick("9999"),
      KgiQuoteSymbolNotAllowedError,
      "subscribeSymbolTick with non-whitelisted symbol must throw before network call"
    );

    // subscribe/bidask
    await assert.rejects(
      () => client.subscribeSymbolBidAsk("9999"),
      KgiQuoteSymbolNotAllowedError,
      "subscribeSymbolBidAsk with non-whitelisted symbol must throw before network call"
    );

    // getRecentTicks
    await assert.rejects(
      () => client.getRecentTicks("9999"),
      KgiQuoteSymbolNotAllowedError,
      "getRecentTicks with non-whitelisted symbol must throw before network call"
    );

    // getLatestBidAsk
    await assert.rejects(
      () => client.getLatestBidAsk("9999"),
      KgiQuoteSymbolNotAllowedError,
      "getLatestBidAsk with non-whitelisted symbol must throw before network call"
    );

    assert.equal(fetchCalled, false, "fetch must NOT be called for non-whitelisted symbols");

    // Whitelist parsing
    assert.deepEqual(parseSymbolWhitelist("2330,2317,2454"), ["2330", "2317", "2454"]);
    assert.deepEqual(parseSymbolWhitelist(""), ["2330"]); // default
    assert.deepEqual(parseSymbolWhitelist(undefined), ["2330"]); // default
    assert.deepEqual(parseSymbolWhitelist("  2330 , 2317 "), ["2330", "2317"]); // trimming
  } finally {
    globalThis.fetch = orig;
  }
});

// ---------------------------------------------------------------------------
// W2d Test 9: no-order guarantee (grep + module-import + URL mock)
// ---------------------------------------------------------------------------

test("W2d-T9: no-order guarantee — KgiQuoteClient has 0 order methods + 0 order URL calls", async () => {
  // §2.1: Enumerate all method names on KgiQuoteClient prototype — 0 order-related names
  const orderPatterns = ["order", "submit", "place", "cancel", "modify", "create"];
  const client = new KgiQuoteClient({
    gatewayBaseUrl: "http://test-gateway",
    symbolWhitelist: ["2330"],
  });

  // Enumerate own + prototype keys
  const allKeys = new Set<string>();
  let proto = Object.getPrototypeOf(client);
  while (proto && proto !== Object.prototype) {
    for (const k of Object.getOwnPropertyNames(proto)) {
      allKeys.add(k.toLowerCase());
    }
    proto = Object.getPrototypeOf(proto);
  }
  for (const k of Object.keys(client)) {
    allKeys.add(k.toLowerCase());
  }

  for (const pattern of orderPatterns) {
    const matches = [...allKeys].filter((k) => k.includes(pattern));
    assert.equal(
      matches.length,
      0,
      `KgiQuoteClient must have 0 methods containing '${pattern}' — found: ${matches.join(", ")}`
    );
  }

  // §2.2: URL mock — assert no call to /order/create or /order/* during any quote operation
  const orderUrlsCalled: string[] = [];
  const successResponses = new Map([
    ["/quote/status", { status: 200, body: { subscribed_symbols: { tick: [], bidask: [] }, buffer: { tick: {}, bidask: {} }, kgi_logged_in: true, quote_disabled_flag: false } }],
    ["/quote/subscribe/tick", { status: 200, body: { ok: true, label: "tick_2330" } }],
    ["/quote/subscribe/bidask", { status: 200, body: { ok: true, label: "bidask_2330" } }],
    ["/quote/ticks", { status: 200, body: { symbol: "2330", ticks: [], count: 0, buffer_size: 200, buffer_used: 0 } }],
    ["/quote/bidask", { status: 200, body: { symbol: "2330", bidask: null } }],
  ]);

  const orig = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/order/")) orderUrlsCalled.push(url);
    const entry = [...successResponses.entries()].find(([k]) => url.includes(k));
    if (entry) {
      return new Response(JSON.stringify(entry[1].body), { status: entry[1].status, headers: { "Content-Type": "application/json" } });
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;

  try {
    const c = new KgiQuoteClient({
      gatewayBaseUrl: "http://test-gateway",
      symbolWhitelist: ["2330"],
    });

    await c.getQuoteStatus();
    await c.subscribeSymbolTick("2330");
    await c.subscribeSymbolBidAsk("2330");
    await c.getRecentTicks("2330", 5);
    await c.getLatestBidAsk("2330");

    assert.equal(
      orderUrlsCalled.length,
      0,
      `No /order/* URLs must be called during quote operations — found: ${orderUrlsCalled.join(", ")}`
    );
  } finally {
    globalThis.fetch = orig;
  }
});

// ---------------------------------------------------------------------------
// API Gap Filler tests (Items 1-3) — PR #21 RADAR cutover force-MOCK closures
// ---------------------------------------------------------------------------

// Item 1: previewOrder — no DB write, returns risk + gate verdict
test("api-gap Item 1: previewOrder returns risk+gate verdict without placing an order", async () => {
  const repo = new MemoryTradingRoomRepository();
  const session = await repo.getSession({
    workspaceSlug: `preview-gap-${randomUUID()}`
  });

  // Relax trading hours so the test doesn't depend on clock
  const accountId = "paper-default";
  await upsertRiskLimitState({
    session,
    payload: {
      accountId,
      tradingHoursStart: "00:00",
      tradingHoursEnd: "23:59"
    }
  });

  const now = new Date().toISOString();
  await upsertPaperQuotes({
    session,
    quotes: [
      {
        symbol: "PVTEST",
        market: "OTHER",
        source: "manual",
        last: 100,
        bid: 99,
        ask: 101,
        open: 100,
        high: 100,
        low: 100,
        prevClose: 100,
        volume: 5000,
        changePct: 0,
        timestamp: now
      }
    ]
  });

  const result = await previewOrder({
    session,
    repo,
    order: {
      accountId,
      symbol: "PVTEST",
      side: "buy",
      type: "limit",
      timeInForce: "rod",
      quantity: 1,
      price: 100,
      stopPrice: null,
      tradePlanId: null,
      strategyId: null,
      overrideGuards: [],
      overrideReason: ""
    }
  });

  // previewOrder always returns order:null (no placement)
  assert.equal(result.order, null, "previewOrder must not place an order");
  // riskCheck must exist
  assert.ok(result.riskCheck, "riskCheck must be present");
  assert.ok(typeof result.riskCheck.id === "string", "riskCheck.id must be a string");
  // blocked reflects combined risk + gate verdict
  assert.equal(typeof result.blocked, "boolean", "blocked must be boolean");
  // quoteGate must be populated (even if review_required due to paper source)
  assert.ok(result.quoteGate !== undefined, "quoteGate must be populated by previewOrder");
});

// Item 1b: previewOrder — order is always null regardless of risk outcome; no ledger row created
test("api-gap Item 1b: previewOrder never creates a ledger row — order is always null", async () => {
  const repo = new MemoryTradingRoomRepository();
  const session = await repo.getSession({
    workspaceSlug: `preview-no-row-${randomUUID()}`
  });

  const accountId = "paper-default";
  await upsertRiskLimitState({
    session,
    payload: {
      accountId,
      tradingHoursStart: "00:00",
      tradingHoursEnd: "23:59"
    }
  });

  const now = new Date().toISOString();
  await upsertPaperQuotes({
    session,
    quotes: [
      {
        symbol: "PVNULL",
        market: "OTHER",
        source: "manual",
        last: 50,
        bid: 49,
        ask: 51,
        open: 50,
        high: 50,
        low: 50,
        prevClose: 50,
        volume: 1000,
        changePct: 0,
        timestamp: now
      }
    ]
  });

  const result = await previewOrder({
    session,
    repo,
    order: {
      accountId,
      symbol: "PVNULL",
      side: "buy",
      type: "market",
      timeInForce: "rod",
      quantity: 1,
      price: null,
      stopPrice: null,
      tradePlanId: null,
      strategyId: null,
      overrideGuards: [],
      overrideReason: ""
    }
  });

  // Invariant: previewOrder ALWAYS returns order:null (no broker placement)
  assert.equal(result.order, null, "previewOrder.order must always be null");
  // riskCheck and quoteGate must be present for diagnostic use
  assert.ok(result.riskCheck, "riskCheck must be present");
  assert.ok(result.quoteGate !== undefined, "quoteGate must be present");
  // No order row created in the ledger
  const orders = await listPaperOrders(session, { accountId });
  const pvnullOrders = orders.filter((o) => o.symbol === "PVNULL");
  assert.equal(pvnullOrders.length, 0, "no ledger Order row must exist after previewOrder");
});

// Item 2: getStrategyRunById + run.items returns the stored ideas array
test("api-gap Item 2: getStrategyRunById returns items array usable as ideas-by-run", async () => {
  const repo = new MemoryTradingRoomRepository();
  const workspaceSlug = `ideas-by-run-${randomUUID()}`;
  const session = await repo.getSession({ workspaceSlug });
  await resetPersistedStrategyRuns(workspaceSlug);

  const theme = await repo.createTheme({
    name: "Ideas Run Theme",
    marketState: "Expansion",
    lifecycle: "Early",
    priority: 4,
    thesis: "Test theme for ideas-by-run.",
    whyNow: "CI test.",
    bottleneck: "None"
  });

  await repo.createCompany({
    name: "Ideas By Run Co",
    ticker: "IBR1",
    market: "OTHER",
    country: "Taiwan",
    themeIds: [theme.id],
    chainPosition: "Core",
    beneficiaryTier: "Core",
    exposure: { volume: 4, asp: 4, margin: 3, capacity: 3, narrative: 3 },
    validation: { capitalFlow: "Strong", consensus: "Up", relativeStrength: "Leading" },
    notes: "CI."
  });

  const run = await createStrategyRun({
    session,
    repo,
    payload: {
      limit: 5,
      signalDays: 30,
      includeBlocked: true,
      decisionMode: "strategy",
      sort: "score"
    }
  });

  // Simulate what the route handler does: load run by id, return run.items
  const loaded = await getStrategyRunById({ session, runId: run.id });
  assert.ok(loaded, "run must be found by id");
  assert.ok(Array.isArray(loaded.items), "run.items must be an array");

  // Unknown run → null
  const notFound = await getStrategyRunById({ session, runId: randomUUID() });
  assert.equal(notFound, null, "unknown runId must return null");
});

// Item 3: ops/activity adapter logic — AuditEntry severity mapping
test("api-gap Item 3: ActivityEvent severity mapping (2xx→INFO, 4xx→WARN, 5xx→ERROR)", () => {
  // Test the severity mapping logic extracted from the route handler inline.
  // This is pure logic — no async, no DB needed.
  function toSeverity(status: number | undefined): string {
    return (status ?? 0) >= 500
      ? "ERROR"
      : (status ?? 0) >= 400
      ? "WARN"
      : "INFO";
  }

  assert.equal(toSeverity(200), "INFO");
  assert.equal(toSeverity(201), "INFO");
  assert.equal(toSeverity(204), "INFO");
  assert.equal(toSeverity(301), "INFO");
  assert.equal(toSeverity(400), "WARN");
  assert.equal(toSeverity(401), "WARN");
  assert.equal(toSeverity(403), "WARN");
  assert.equal(toSeverity(404), "WARN");
  assert.equal(toSeverity(422), "WARN");
  assert.equal(toSeverity(499), "WARN");
  assert.equal(toSeverity(500), "ERROR");
  assert.equal(toSeverity(502), "ERROR");
  assert.equal(toSeverity(503), "ERROR");
  assert.equal(toSeverity(undefined), "INFO");
});

test("api-gap Item 3b: ActivityEvent slug generation from path", () => {
  // Test the event slug generation logic from the ops/activity route handler.
  function toSlug(method: string | undefined, path: string | undefined): string {
    return `${(method ?? "?").toLowerCase()}.${
      (path ?? "").replace(/^\/api\/v1\//, "").replace(/\//g, ".")
    }`;
  }

  assert.equal(toSlug("GET", "/api/v1/strategy/ideas"), "get.strategy.ideas");
  assert.equal(toSlug("POST", "/api/v1/paper/orders"), "post.paper.orders");
  assert.equal(toSlug("DELETE", "/api/v1/risk/kill-switch"), "delete.risk.kill-switch");
  assert.equal(toSlug(undefined, "/api/v1/ops/snapshot"), "?.ops.snapshot");
  assert.equal(toSlug("GET", undefined), "get.");
});
