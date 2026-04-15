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
  getThemeGraphView
} from "../apps/api/src/theme-graph.ts";
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
import type { Company, Theme } from "../packages/contracts/src/index.ts";
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
  assert.equal(snapshot.latest.themes[0]?.label, "AI 光通訊");
  assert.equal(snapshot.latest.companies[0]?.label, "2330 台積電");
  assert.equal(snapshot.openAlice.queue.reviewable, 1);
  assert.equal(snapshot.eventHistory.summary.total, 4);
  assert.equal(snapshot.eventHistory.recent[0]?.source, "signal");
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
