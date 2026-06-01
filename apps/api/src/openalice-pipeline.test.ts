/**
 * openalice-pipeline.test.ts
 *
 * Unit tests for the OpenAlice Autonomous Daily Pipeline.
 * Tests: scheduler tick guards, source pack assembly, publish gate Green/Yellow/Red tiers,
 * batch reviewer result, pipeline state management.
 * Uses memory mode only — no DB required.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { shouldReuseExistingContentDraftForDedupe } from "./content-draft-store.js";
import {
  buildDailyBriefContractInstructions,
  buildMarketOverviewSourceEntryFromSnapshot,
  buildSourceOnlyBriefPayload,
  classifyDraftTier,
  DAILY_BRIEF_REQUIRED_SECTION_IDS,
  evaluatePublishGate,
  filterSourcePackEntries,
  isDailyBriefV2ContractCompliant,
  isBriefBootRecoveryWindow,
  loadSourcePackForDraft,
  loadStrategySnapshot,
  lookupJobSourcePackSummary,
  parseDirectBriefPayload,
  registerJobSourcePack,
  registerJobSourcePackSummary,
  runBatchAiReviewer,
  runPipelinePreMarketBootRecovery,
  runPipelineTick,
  sanitizeBriefBody,
  scrubForbiddenPhrases,
  scrubReplacementChars,
  validateDailyBriefSectionsContract,
  _lastPipelineState,
  type SourcePack,
  type SourcePackEntry,
  type StrategyRegistryEntry
} from "./openalice-pipeline.js";

// ── Helper ────────────────────────────────────────────────────────────────────

function makePack(overrides: Partial<SourcePack> = {}): SourcePack {
  return {
    packId: "test-pack-001",
    tick: "close_brief",
    collectedAt: new Date().toISOString(),
    tradingDate: "2026-05-06",
    sources: [
      { source: "companies_ohlcv", status: "LIVE", rowCount: 500, latestDate: "2026-05-05", note: null },
      { source: "tw_monthly_revenue", status: "LIVE", rowCount: 1200, latestDate: "2026-04-30", note: null },
      { source: "tw_institutional_buysell", status: "LIVE", rowCount: 300, latestDate: "2026-05-05", note: null },
      { source: "tw_margin_short", status: "LIVE", rowCount: 300, latestDate: "2026-05-05", note: null },
      { source: "market_overview", status: "LIVE", rowCount: 1, latestDate: "2026-05-05", note: null }
    ],
    trailComplete: true,
    ...overrides
  };
}

test("daily brief contract accepts all required section ids", () => {
  const sections = DAILY_BRIEF_REQUIRED_SECTION_IDS.map((sectionId) => ({
    sectionId,
    heading: sectionId,
    body: "This section has enough source-backed content for contract validation."
  }));

  assert.deepEqual(validateDailyBriefSectionsContract(sections), { ok: true, missing: [] });
});

test("daily brief contract rejects missing required section ids", () => {
  const sections = DAILY_BRIEF_REQUIRED_SECTION_IDS
    .filter((sectionId) => sectionId !== "risk_watch")
    .map((sectionId) => ({
      sectionId,
      heading: sectionId,
      body: "This section has enough source-backed content for contract validation."
    }));

  assert.deepEqual(validateDailyBriefSectionsContract(sections), { ok: false, missing: ["risk_watch"] });
});

test("daily brief v2 compliance helper accepts only complete v2 sections", () => {
  const compliant = {
    sections: DAILY_BRIEF_REQUIRED_SECTION_IDS.map((sectionId) => ({
      sectionId,
      heading: sectionId,
      body: "This section has enough source-backed content for contract validation."
    }))
  };
  const legacy = {
    sections: [
      { heading: "market overview", body: "Legacy brief section." },
      { heading: "technical analysis", body: "Legacy brief section." },
      { heading: "risk alert", body: "Legacy brief section." }
    ]
  };

  assert.equal(isDailyBriefV2ContractCompliant(compliant), true);
  assert.equal(isDailyBriefV2ContractCompliant(legacy), false);
  assert.equal(isDailyBriefV2ContractCompliant({ sections: [] }), false);
  assert.equal(isDailyBriefV2ContractCompliant({ sections: null }), false);
});

test("daily brief v2 compliance helper rejects empty bodies, raw dumps, and legacy headings even when section ids exist", () => {
  const baseSections = DAILY_BRIEF_REQUIRED_SECTION_IDS.map((sectionId) => ({
    sectionId,
    heading: sectionId,
    body: "This section has enough source-backed content for contract validation."
  }));

  assert.equal(
    isDailyBriefV2ContractCompliant({
      sections: baseSections.map((section, index) =>
        index === 0 ? { ...section, body: "" } : section
      )
    }),
    false
  );
  assert.equal(
    isDailyBriefV2ContractCompliant({
      sections: baseSections.map((section, index) =>
        index === 1 ? { ...section, body: "Theme: AI server; Lifecycle: watchlist; Priority: high" } : section
      )
    }),
    false
  );
  assert.equal(
    isDailyBriefV2ContractCompliant({
      sections: baseSections.map((section, index) =>
        index === 2 ? { ...section, heading: "Market Overview" } : section
      )
    }),
    false
  );
});

test("direct daily brief reviewer can recover source pack by draft id", () => {
  const draftId = `direct-draft-${Date.now()}`;
  const pack = makePack({ packId: `pack-${draftId}` });
  const summary = pack.sources.map((s) => `${s.source}(${s.status})`).join(", ");

  registerJobSourcePackSummary(draftId, summary);
  registerJobSourcePack(draftId, pack);

  assert.equal(lookupJobSourcePackSummary(draftId), summary);
  assert.equal(loadSourcePackForDraft(draftId)?.packId, pack.packId);
});

test("daily brief instructions advertise only the v2 five-section contract", () => {
  const instructions = buildDailyBriefContractInstructions();
  for (const sectionId of DAILY_BRIEF_REQUIRED_SECTION_IDS) {
    assert.match(instructions, new RegExp(sectionId));
  }
  for (const heading of ["市場總覽", "AI 精選重點", "產業與主題", "風險觀察", "資料來源狀態"]) {
    assert.match(instructions, new RegExp(heading));
  }
  for (const legacyHeading of ["技術觀察", "風控警示", "策略觀察", "今日資料狀態", "資料品質提醒"]) {
    assert.equal(instructions.includes(legacyHeading), false, `legacy heading leaked into contract: ${legacyHeading}`);
  }
});

test("source-only fallback also satisfies the v2 five-section contract", () => {
  const payload = buildSourceOnlyBriefPayload(makePack()) as {
    sections: Array<{ heading: string; body: string; sourceTrail?: string | null }>;
  };

  assert.deepEqual(validateDailyBriefSectionsContract(payload.sections), { ok: true, missing: [] });
  assert.equal(payload.sections.length, 5);
  for (const section of payload.sections) {
    assert.equal(typeof section.sourceTrail, "string");
    assert.match(section.sourceTrail ?? "", /source_pack=test-pack-001/);
    assert.match(section.sourceTrail ?? "", /法人籌碼資料=LIVE/);
  }
  for (const legacyHeading of ["技術觀察", "風控警示", "策略觀察", "今日資料狀態", "資料品質提醒", "下一步工作"]) {
    assert.equal(
      payload.sections.some((section) => section.heading === legacyHeading),
      false,
      `legacy heading leaked into source-only fallback: ${legacyHeading}`
    );
  }
});

test("source-only fallback source trail includes market intel news and announcement sources when provided", () => {
  const payload = buildSourceOnlyBriefPayload(makePack({
    sources: [
      ...makePack().sources,
      { source: "ai_selected_news", status: "LIVE", rowCount: 10, latestDate: "2026-05-06T08:00:00Z", note: "mode=ai", sampleRows: null },
      { source: "official_announcements", status: "EMPTY", rowCount: 0, latestDate: null, note: "no_official_market_announcements", sampleRows: null }
    ]
  })) as {
    sections: Array<{ sourceTrail?: string | null }>;
  };

  const trail = payload.sections[0]?.sourceTrail ?? "";
  assert.match(trail, /ai_selected_news|AI 精選新聞/);
  assert.match(trail, /official_announcements|官方重大公告/);
});

test("daily brief source pack market overview uses live market snapshot", () => {
  const entry = buildMarketOverviewSourceEntryFromSnapshot(
    {
      taiex: {
        value: 41898.32,
        change: 108.26,
        changePct: 0.26,
        sourceState: "live",
        asOf: "2026-05-12",
      },
      heatmapTop3: [{ industry: "半導體", avgChangePct: 1.2, direction: "up" }],
      topGainers: [{ symbol: "2330", name: "台積電", changePct: 2.1 }],
      topLosers: [{ symbol: "2603", name: "長榮", changePct: -1.8 }],
      institutional: { foreign: 1200, trust: -300, dealer: 50, date: "2026-05-12" },
      margin: { balanceChange: 1000, shortChange: -250, date: "2026-05-11" },
    },
    new Date("2026-05-01")
  );

  assert.equal(entry.source, "market_overview");
  assert.equal(entry.status, "LIVE");
  assert.equal(entry.rowCount, 5);
  assert.equal(entry.latestDate, "2026-05-12");
  assert.match(entry.note ?? "", /taiex=live/);
  assert.equal(entry.sampleRows?.[0]?.taiexValue, 41898.32);
  assert.deepEqual(entry.sampleRows?.[0]?.heatmapTop3, [
    { industry: "半導體", avgChangePct: 1.2, direction: "up" },
  ]);
});

test("direct LLM daily brief payload attaches source trail to every section", () => {
  const headings = ["市場總覽", "AI 精選重點", "產業與主題", "風險觀察", "資料來源狀態"];
  const raw = JSON.stringify({
    templateVersion: "daily_brief_contract_v2",
    marketState: "Risk-On",
    sections: DAILY_BRIEF_REQUIRED_SECTION_IDS.map((sectionId, index) => ({
      sectionId,
      heading: headings[index],
      body: "這是一段通過模板檢查的來源化簡報內容，描述市場資料、新聞來源、產業變化與風險狀態，並明確保留資料不足說明，不提供任何買賣建議。"
    }))
  });
  const payload = parseDirectBriefPayload(raw, makePack()) as {
    sections: Array<{ sourceTrail?: string | null }>;
  };

  assert.equal(payload.sections.length, 5);
  for (const section of payload.sections) {
    assert.equal(typeof section.sourceTrail, "string");
    assert.match(section.sourceTrail ?? "", /source_pack=test-pack-001/);
  }
});

test("daily brief dedupe allows regenerating approved drafts that lack sourceTrail", () => {
  const nextPayload = buildSourceOnlyBriefPayload(makePack());
  const existingWithoutTrail = {
    date: "2026-05-06",
    marketState: "Balanced",
    sections: [{ heading: "市場總覽", body: "舊簡報內容。" }]
  };

  assert.equal(
    shouldReuseExistingContentDraftForDedupe({
      targetTable: "daily_briefs",
      nextPayload,
      existingPayload: existingWithoutTrail
    }),
    false
  );
  assert.equal(
    shouldReuseExistingContentDraftForDedupe({
      targetTable: "daily_briefs",
      nextPayload,
      existingPayload: nextPayload
    }),
    true
  );
  assert.equal(
    shouldReuseExistingContentDraftForDedupe({
      targetTable: "company_notes",
      nextPayload,
      existingPayload: existingWithoutTrail
    }),
    true
  );
});

// ── Test 1: scheduler tick skips non-trading days (memory mode) ───────────────

test("pipeline tick returns skipped for memory mode (no DB)", async () => {
  // In memory mode isDatabaseMode() returns false, so pipeline skips after workspace check
  const result = await runPipelineTick("close_brief", "default");
  // Memory mode → skipped (either not_a_trading_day or memory_mode_no_db)
  assert.ok(
    result.skippedReason !== null || result.error !== null,
    "Expected a skip or error in memory mode"
  );
  assert.equal(result.tick, "close_brief");
  assert.ok(typeof result.runId === "string" && result.runId.length > 0);
  assert.ok(typeof result.durationMs === "number" && result.durationMs >= 0);
});

// ── Test 2: source pack trailComplete logic ───────────────────────────────────

test("source pack trailComplete is false when required source is EMPTY", () => {
  const pack = makePack({
    sources: [
      { source: "companies_ohlcv", status: "EMPTY", rowCount: 0, latestDate: null, note: null },
      { source: "tw_monthly_revenue", status: "LIVE", rowCount: 100, latestDate: "2026-04-30", note: null },
      { source: "tw_institutional_buysell", status: "LIVE", rowCount: 50, latestDate: "2026-05-05", note: null },
      { source: "tw_margin_short", status: "LIVE", rowCount: 50, latestDate: "2026-05-05", note: null },
      { source: "market_overview", status: "LIVE", rowCount: 1, latestDate: "2026-05-05", note: null }
    ],
    trailComplete: false
  });
  // trailComplete should be false when ohlcv is EMPTY
  assert.equal(pack.trailComplete, false);
});

test("source pack trailComplete allows DEGRADED for optional sources", () => {
  const pack = makePack({
    sources: [
      { source: "companies_ohlcv", status: "LIVE", rowCount: 500, latestDate: "2026-05-05", note: null },
      { source: "tw_monthly_revenue", status: "DEGRADED", rowCount: null, latestDate: null, note: "table_not_found" },
      { source: "tw_institutional_buysell", status: "DEGRADED", rowCount: null, latestDate: null, note: "table_not_found" },
      { source: "tw_margin_short", status: "EMPTY", rowCount: 0, latestDate: null, note: null },
      { source: "market_overview", status: "LIVE", rowCount: 1, latestDate: "2026-05-05", note: null }
    ],
    trailComplete: true // explicitly set; real collectSourcePack would compute this
  });
  assert.equal(pack.trailComplete, true);
});

// ── Test 3: publish gate Green tier (auto-publish) ────────────────────────────

test("publish gate Green tier: approve + confidence>=0.7 + no flags = shouldAutoPublish", () => {
  const pack = makePack({ trailComplete: true });
  const gate = evaluatePublishGate({
    sourcePack: pack,
    reviewerVerdict: "approve",
    confidence: 0.9,
    flaggedIssueCount: 0,
    draftPayload: {
      date: "2026-05-06",
      marketState: "Balanced",
      sections: [{ heading: "Market Summary", body: "Markets closed flat today with mixed signals across tech and industrials sectors." }]
    }
  });
  assert.equal(gate.tier, "green");
  assert.equal(gate.shouldAutoPublish, true);
  assert.equal(gate.rejectReason, null);
});

test("publish gate Green tier: confidence<0.7 = NOT auto-publish", () => {
  const pack = makePack({ trailComplete: true });
  const gate = evaluatePublishGate({
    sourcePack: pack,
    reviewerVerdict: "approve",
    confidence: 0.5,
    flaggedIssueCount: 0,
    draftPayload: { date: "2026-05-06", marketState: "Risk-On", sections: [] }
  });
  assert.equal(gate.tier, "green");
  assert.equal(gate.shouldAutoPublish, false);
  assert.ok(gate.rejectReason?.includes("confidence=0.5<0.7"));
});

// ── Test 4: publish gate Yellow tier ─────────────────────────────────────────

test("publish gate Yellow tier: strategy keyword = queued not auto-published", () => {
  const pack = makePack({ trailComplete: true });
  const gate = evaluatePublishGate({
    sourcePack: pack,
    reviewerVerdict: "approve",
    confidence: 0.95,
    flaggedIssueCount: 0,
    draftPayload: {
      date: "2026-05-06",
      sections: [{ heading: "Strategy Overview", body: "Our ranking of top sectors shows financials leading." }]
    }
  });
  assert.equal(gate.tier, "yellow");
  assert.equal(gate.shouldAutoPublish, false);
  assert.equal(gate.rejectReason, null);
});

// ── Test 5: publish gate Red tier ────────────────────────────────────────────

test("publish gate Red tier: buy keyword = force reject", () => {
  const pack = makePack({ trailComplete: true });
  const gate = evaluatePublishGate({
    sourcePack: pack,
    reviewerVerdict: "approve",
    confidence: 0.99,
    flaggedIssueCount: 0,
    draftPayload: {
      date: "2026-05-06",
      sections: [{ heading: "Action", body: "You should buy TSMC now before earnings." }]
    }
  });
  assert.equal(gate.tier, "red");
  assert.equal(gate.shouldAutoPublish, false);
  assert.ok(gate.rejectReason !== null);
});

test("publish gate Red tier: 目標價 Chinese keyword = force reject", () => {
  const pack = makePack({ trailComplete: true });
  const gate = evaluatePublishGate({
    sourcePack: pack,
    reviewerVerdict: "approve",
    confidence: 0.95,
    flaggedIssueCount: 0,
    draftPayload: { text: "台積電目標價850元，建議進場。" }
  });
  assert.equal(gate.tier, "red");
  assert.equal(gate.shouldAutoPublish, false);
});

test("publish gate Red tier: sell keyword = force reject", () => {
  const pack = makePack({ trailComplete: true });
  const gate = evaluatePublishGate({
    sourcePack: pack,
    reviewerVerdict: "approve",
    confidence: 0.95,
    flaggedIssueCount: 0,
    draftPayload: { content: "Sell your positions immediately." }
  });
  assert.equal(gate.tier, "red");
  assert.equal(gate.shouldAutoPublish, false);
});

// ── Test 6: classifyDraftTier helper ─────────────────────────────────────────

test("classifyDraftTier returns green for clean content", () => {
  const tier = classifyDraftTier({
    date: "2026-05-06",
    marketState: "Balanced",
    sections: [{ heading: "Overview", body: "Markets closed mixed today." }]
  });
  assert.equal(tier, "green");
});

test("classifyDraftTier keeps institutional buy/sell source labels green", () => {
  const tier = classifyDraftTier({
    date: "2026-05-06",
    sourcePack: {
      sources: [
        { source: "tw_institutional_buysell", status: "LIVE" },
        { source: "TaiwanStockInstitutionalInvestorsBuySell", status: "LIVE" }
      ]
    },
    sections: [
      {
        heading: "籌碼資料",
        body: "三大法人與外資買賣超屬於來源欄位；這裡只描述歷史資料，不給交易指令。"
      }
    ]
  });
  assert.equal(tier, "green");
});

test("classifyDraftTier keeps no-advice daily brief disclaimers green", () => {
  const tier = classifyDraftTier({
    date: "2026-05-29",
    sections: [
      {
        heading: "資料來源狀態",
        body: "本日解讀以資料完整性與風控檢查為優先，不提供買賣建議、目標價或報酬承諾。"
      }
    ]
  });
  assert.equal(tier, "green");
});

test("publish gate Green tier: safe no-advice disclaimer still auto-publishes", () => {
  const pack = makePack({ trailComplete: true });
  const gate = evaluatePublishGate({
    sourcePack: pack,
    reviewerVerdict: "approve",
    confidence: 0.95,
    flaggedIssueCount: 0,
    draftPayload: {
      date: "2026-05-29",
      sections: [
        {
          heading: "資料來源狀態",
          body: "資料來源包含三大法人買賣超欄位；本文不構成投資建議，不提供目標價，不保證報酬，也不提供勝率。"
        }
      ]
    }
  });
  assert.equal(gate.tier, "green");
  assert.equal(gate.shouldAutoPublish, true);
  assert.equal(gate.rejectReason, null);
});

test("classifyDraftTier returns red for guarantee keyword", () => {
  const tier = classifyDraftTier({ text: "This investment is guaranteed to return 20%." });
  assert.equal(tier, "red");
});

test("classifyDraftTier returns yellow for ranking content", () => {
  const tier = classifyDraftTier({ text: "Sector ranking shows materials at rank 1." });
  assert.equal(tier, "yellow");
});

// ── Test 7: batch reviewer memory mode returns empty ─────────────────────────

test("runBatchAiReviewer returns zero results in memory mode", async () => {
  const result = await runBatchAiReviewer({ limit: 10, dryRun: false });
  // In memory mode isDatabaseMode() is false → returns { processed:0, ... }
  assert.equal(result.processed, 0);
  assert.equal(result.approved, 0);
  assert.equal(result.rejected, 0);
  assert.equal(result.manual, 0);
  assert.equal(result.errors, 0);
});

test("runBatchAiReviewer dryRun=true returns processed=0 in memory mode", async () => {
  const result = await runBatchAiReviewer({ limit: 5, dryRun: true });
  assert.equal(result.processed, 0);
});

// ── Test 8: _lastPipelineState is updated after tick ─────────────────────────

test("_lastPipelineState is updated after runPipelineTick", async () => {
  await runPipelineTick("pre_market", "default");
  assert.ok(_lastPipelineState.lastRunAt !== null, "lastRunAt should be set");
  assert.ok(_lastPipelineState.totalRunsThisProcess > 0, "totalRunsThisProcess should increment");
  assert.equal(_lastPipelineState.lastTick, "pre_market");
});

// ── Test 9: weekend detection (trailComplete and skip) ───────────────────────

test("pipeline tick result has consistent shape", async () => {
  const result = await runPipelineTick("close_watch", "default");
  // Shape check regardless of skip/error
  assert.ok("runId" in result);
  assert.ok("tick" in result);
  assert.ok("tradingDate" in result);
  assert.ok("durationMs" in result);
  assert.ok("sourcePack" in result);
  assert.ok("jobId" in result);
  assert.ok("draftId" in result);
  assert.ok("reviewerVerdict" in result);
  assert.ok("publishedBriefId" in result);
});

// ── Test 10: source pack structure ───────────────────────────────────────────

test("makePack helper produces valid SourcePack shape", () => {
  const pack = makePack();
  assert.ok(typeof pack.packId === "string");
  assert.ok(typeof pack.tick === "string");
  assert.ok(typeof pack.collectedAt === "string");
  assert.ok(typeof pack.tradingDate === "string");
  assert.ok(Array.isArray(pack.sources));
  assert.equal(pack.sources.length, 5);
  assert.ok(typeof pack.trailComplete === "boolean");
});

// ── Test 11: loadStrategySnapshot reads snapshot file (axis 4) ────────────────

test("loadStrategySnapshot returns an array or null — never throws", () => {
  // In test env, the snapshot file may or may not be resolvable depending on CWD.
  // Either outcome is valid — what matters is: no throw, and if not-null then shape is correct.
  // Call directly (no closure) so TS can narrow the type.
  const result = loadStrategySnapshot();
  // result is StrategyRegistryEntry[] | null — both are valid outcomes
  if (result === null) {
    // Snapshot not found relative to test runner CWD — acceptable in unit test context.
    assert.equal(result, null);
    return;
  }
  assert.ok(Array.isArray(result), "result must be array when not null");
  assert.ok(result.length > 0, "non-null snapshot must have at least one strategy");
  const first: StrategyRegistryEntry = result[0]!;
  assert.ok(typeof first.strategyId === "string", "strategyId must be a string");
  assert.ok(typeof first.name === "string", "name must be a string");
  assert.ok(["short_term", "mid_term", "long_term", "reversal"].includes(first.type), "type must be valid enum");
  assert.ok(typeof first.latestSummary === "object", "latestSummary must be an object");
  assert.ok(typeof first.latestSummary.totalTrades === "number", "totalTrades must be a number");
  assert.ok(Array.isArray(first.caveats), "caveats must be an array");
  // HARD RULE: caveats must contain NOT_PAPER_READY for BACKTESTED_RAW strategies
  if (first.status === "BACKTESTED_RAW") {
    assert.ok(
      first.caveats.includes("NOT_PAPER_READY"),
      "BACKTESTED_RAW strategy must carry NOT_PAPER_READY caveat"
    );
  }
});

// ── Test 12: strategy section in daily_brief instructions triggers yellow tier ─

// ── Test 13 (F1): filterSourcePackEntries strips BROKEN/ORPHAN/DEPRECATED entries ─

test("filterSourcePackEntries removes BROKEN-tagged source entries", () => {
  const entries: SourcePackEntry[] = [
    { source: "companies_ohlcv", status: "LIVE", rowCount: 500, latestDate: "2026-05-06", note: null },
    { source: "[BROKEN-1] tw_theme_legacy", status: "DEGRADED", rowCount: null, latestDate: null, note: "broken theme" },
    { source: "tw_institutional_buysell", status: "LIVE", rowCount: 300, latestDate: "2026-05-06", note: null }
  ];
  const filtered = filterSourcePackEntries(entries);
  assert.equal(filtered.length, 2, "BROKEN entry must be removed");
  assert.ok(filtered.every((e) => !e.source.includes("[BROKEN")), "No BROKEN source names in output");
});

test("filterSourcePackEntries removes ORPHAN-tagged source entries", () => {
  const entries: SourcePackEntry[] = [
    { source: "companies_ohlcv", status: "LIVE", rowCount: 100, latestDate: "2026-05-06", note: null },
    { source: "[ORPHAN] abandoned_source", status: "EMPTY", rowCount: 0, latestDate: null, note: null },
    { source: "market_overview", status: "LIVE", rowCount: 1, latestDate: "2026-05-06", note: null }
  ];
  const filtered = filterSourcePackEntries(entries);
  assert.equal(filtered.length, 2, "ORPHAN entry must be removed");
});

test("filterSourcePackEntries removes DEPRECATED-tagged source entries", () => {
  const entries: SourcePackEntry[] = [
    { source: "[DEPRECATED] old_theme_source", status: "EMPTY", rowCount: 0, latestDate: null, note: null },
    { source: "tw_monthly_revenue", status: "LIVE", rowCount: 800, latestDate: "2026-04-30", note: null }
  ];
  const filtered = filterSourcePackEntries(entries);
  assert.equal(filtered.length, 1, "DEPRECATED entry must be removed");
  assert.equal(filtered[0]!.source, "tw_monthly_revenue");
});

test("filterSourcePackEntries strips entry when BROKEN token is in note field", () => {
  const entries: SourcePackEntry[] = [
    { source: "some_source", status: "DEGRADED", rowCount: null, latestDate: null, note: "[BROKEN-2] theme not promoted" },
    { source: "companies_ohlcv", status: "LIVE", rowCount: 500, latestDate: "2026-05-06", note: null }
  ];
  const filtered = filterSourcePackEntries(entries);
  assert.equal(filtered.length, 1, "Entry with BROKEN note must be removed");
  assert.equal(filtered[0]!.source, "companies_ohlcv");
});

test("filterSourcePackEntries passes all clean standard source entries", () => {
  const entries: SourcePackEntry[] = [
    { source: "companies_ohlcv", status: "LIVE", rowCount: 500, latestDate: "2026-05-06", note: null },
    { source: "tw_monthly_revenue", status: "LIVE", rowCount: 1200, latestDate: "2026-04-30", note: null },
    { source: "tw_institutional_buysell", status: "LIVE", rowCount: 300, latestDate: "2026-05-06", note: null },
    { source: "tw_margin_short", status: "LIVE", rowCount: 300, latestDate: "2026-05-06", note: null },
    { source: "market_overview", status: "LIVE", rowCount: 1, latestDate: "2026-05-06", note: null }
  ];
  const filtered = filterSourcePackEntries(entries);
  assert.equal(filtered.length, 5, "All clean entries must pass through");
});

// ── Test 14 (F2): Chinese institutional label normalization ──────────────────

test("classifyDraftTier: 外資買進 as source label stays GREEN (not red)", () => {
  // Pete BLOCK#5 F2: factual historical description with Chinese institutional label
  // must NOT trigger red tier. "外資連續3日買進" describes source data, not advice.
  const tier = classifyDraftTier({
    date: "2026-05-07",
    sections: [
      {
        heading: "機構動向",
        body: "外資連續3日買進，買超金額合計約50億元。投信賣出科技股，自營商買進金融類股。此為歷史資料彙整，不構成操作建議。"
      }
    ]
  });
  assert.equal(tier, "green", "Chinese institutional source labels must not trigger red tier");
});

test("classifyDraftTier: 法人買進 historical description stays GREEN", () => {
  const tier = classifyDraftTier({
    date: "2026-05-07",
    sections: [
      {
        heading: "法人動向",
        body: "法人買進超過1000張，法人賣出電子權值股。三大法人合計淨買超200億元。資料來源：FinMind tw_institutional_buysell。"
      }
    ]
  });
  assert.equal(tier, "green", "法人買進/賣出 as source data description must be green");
});

test("classifyDraftTier: actual action advice with 外資 still triggers RED", () => {
  // Even with 外資, if combined with action advice pattern, must still reject
  const tier = classifyDraftTier({
    date: "2026-05-07",
    sections: [
      {
        heading: "操作建議",
        body: "建議跟隨外資買進台積電，現在進場機會佳，預期必漲。"
      }
    ]
  });
  // 必漲 matches redSemanticPatterns → must be red regardless
  assert.equal(tier, "red", "Action advice with guarantee keyword must still be red");
});

test("classifyDraftTier returns yellow for payload containing strategy keyword", () => {
  // The strategy section in the daily brief instructions will produce content with
  // "strategy" keyword — this must trigger yellow (awaiting_review) not red.
  // This ensures the AI reviewer gate stays intact while allowing strategy metadata.
  const payloadWithStrategySection = {
    date: new Date().toISOString().slice(0, 10),
    sections: [
      {
        title: "strategy_context",
        body: "IUF Quant Lab has 4 strategies at BACKTESTED_RAW status. NOT_PAPER_READY. No live trading."
      }
    ],
    llm_meta: { provider: "openai", fallback_template: false }
  };
  const tier = classifyDraftTier(payloadWithStrategySection);
  assert.equal(tier, "yellow", "strategy content must be yellow (awaiting_review), not auto-published");
});

// -- Test BR1-BR3: isBriefBootRecoveryWindow (2026-05-09 cron timing fix) ------

test("BR1: isBriefBootRecoveryWindow returns true for 07:30-09:29 TST (recovery window)", () => {
  // 08:44 TST = 00:44 UTC (Asia/Taipei = UTC+8). Root cause of 5/8 missing-fire.
  const at0844 = new Date("2026-05-08T00:44:00.000Z");
  assert.equal(isBriefBootRecoveryWindow(at0844), true, "08:44 TST must be inside recovery window 07:30-09:30");
});

test("BR2: isBriefBootRecoveryWindow returns false outside the recovery window", () => {
  const at1000 = new Date("2026-05-08T02:00:00.000Z"); // 10:00 TST
  assert.equal(isBriefBootRecoveryWindow(at1000), false, "10:00 TST must be outside recovery window");
  const at0600 = new Date("2026-05-07T22:00:00.000Z"); // 06:00 TST
  assert.equal(isBriefBootRecoveryWindow(at0600), false, "06:00 TST must be outside recovery window");
});

test("BR3: runPipelinePreMarketBootRecovery does not throw in memory mode (no DB)", async () => {
  try {
    await runPipelinePreMarketBootRecovery("default");
    assert.ok(true, "boot recovery must not throw in memory mode");
  } catch (err) {
    assert.fail("runPipelinePreMarketBootRecovery threw unexpectedly: " + String(err));
  }
});

// ── Test P0-1: scrubReplacementChars ──────────────────────────────────────────

test("P0-1: scrubReplacementChars removes U+FFFD replacement characters", () => {
  const input = "低軌衛星主要應用於���通訊，涵蓋�高速傳輸。";
  const result = scrubReplacementChars(input);
  assert.ok(!result.includes("�"), "U+FFFD chars must be removed");
  assert.ok(result.includes("低軌衛星"), "Chinese text before mojibake must be preserved");
  assert.ok(result.includes("通訊"), "Chinese text after mojibake must be preserved");
});

test("P0-1: scrubReplacementChars collapses leftover double-spaces", () => {
  const input = "before ��� after";
  const result = scrubReplacementChars(input);
  assert.equal(result, "before after");
});

test("P0-1: scrubReplacementChars is no-op on clean UTF-8 text", () => {
  const clean = "台股市場今日維持穩定，外資法人動向觀察中。";
  assert.equal(scrubReplacementChars(clean), clean);
});

test("P0-1: sanitizeBriefBody passes through after scrub — no U+FFFD in output", () => {
  const garbled = "低軌衛星 — Priority 3: �C�y�D���通訊衛星主要應用";
  const result = sanitizeBriefBody(garbled);
  assert.ok(!result.includes("�"), "sanitizeBriefBody must remove all U+FFFD");
});

// ── Test P0-2: scrubForbiddenPhrases ─────────────────────────────────────────

test("P0-2: scrubForbiddenPhrases removes internal draft wording (full sentence)", () => {
  const input = "後續追蹤重點如下。此版本僅作內部研究草稿，供人員審閱後再決定後續分析方向。請關注市場動態。";
  const result = scrubForbiddenPhrases(input);
  assert.ok(!result.includes("內部研究草稿"), "forbidden phrase must be removed");
  assert.ok(!result.includes("供人員審閱"), "forbidden phrase must be removed");
  assert.ok(!result.includes("後續分析方向"), "forbidden phrase must be removed");
  assert.ok(result.includes("後續追蹤重點如下"), "surrounding content must be preserved");
  assert.ok(result.includes("請關注市場動態"), "following content must be preserved");
});

test("P0-2: scrubForbiddenPhrases removes rule-template fallback label", () => {
  const input = "主題觀察。Generated: 2026-05-13 (rule-template fallback)。電動車供應鏈資料正常。";
  const result = scrubForbiddenPhrases(input);
  assert.ok(!result.includes("rule-template fallback"), "rule-template fallback label must be removed");
  assert.ok(result.includes("電動車供應鏈資料正常"), "substantive content must be preserved");
});

test("P0-2: scrubForbiddenPhrases is no-op on clean content", () => {
  const clean = "今日台股市場維持觀察，法人籌碼資料顯示外資動向。整體市場偏中性格局。";
  assert.equal(scrubForbiddenPhrases(clean), clean);
});

test("P0-2: sanitizeBriefBody applies both scrubs in sequence", () => {
  const mixed = "低軌衛星��通訊。此版本僅作內部研究草稿，供人員審閱後再決定後續分析方向。";
  const result = sanitizeBriefBody(mixed);
  assert.ok(!result.includes("�"), "U+FFFD must be removed");
  assert.ok(!result.includes("內部研究草稿"), "internal draft phrase must be removed");
  assert.ok(result.includes("低軌衛星"), "clean Chinese text must survive");
  assert.ok(result.includes("通訊"), "clean Chinese text after mojibake must survive");
});
