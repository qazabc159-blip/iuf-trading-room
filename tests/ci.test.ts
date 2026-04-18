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
  getMarketDataPolicy,
  getMarketDataOverview,
  ingestTradingViewQuote,
  listMarketBars,
  listMarketDataProviderStatuses,
  listMarketQuoteHistory,
  listMarketQuotes,
  listMarketSymbols,
  resolveMarketQuotes,
  upsertPaperQuotes,
  upsertManualQuotes
} from "../apps/api/src/market-data.ts";
import {
  evaluateRiskCheck,
  getKillSwitchState,
  getRiskLimitState,
  setKillSwitchState,
  upsertRiskLimitState
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

  assert.equal(statuses[1]?.source, "paper");
  assert.equal(statuses[1]?.connected, false);
  assert.match(statuses[1]?.errorMessage ?? "", /Paper quote provider not configured/);

  assert.equal(statuses[2]?.source, "tradingview");
  assert.equal(statuses[2]?.connected, false);
  assert.match(statuses[2]?.errorMessage ?? "", /TradingView quote provider not configured/);

  assert.equal(statuses[3]?.source, "kgi");
  assert.equal(statuses[3]?.connected, false);
  assert.match(statuses[3]?.errorMessage ?? "", /KGI quote provider not configured/);
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
  assert.equal(preferredFreshPaper[0]?.source, "paper");
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
  assert.ok(overview.symbols.total >= 2);
  assert.equal(overview.symbols.byMarket.some((item) => item.market === "TWSE" && item.total >= 1), true);
  assert.equal(overview.symbols.byMarket.some((item) => item.market === "OTHER" && item.total >= 1), true);
  assert.equal(overview.quotes.total, 3);
  assert.equal(overview.quotes.fresh, 2);
  assert.equal(overview.quotes.stale, 1);
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
