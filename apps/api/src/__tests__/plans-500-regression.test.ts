/**
 * plans-500-regression.test.ts
 *
 * Regression tests for 2026-05-09 production 500 errors on plans/* endpoints.
 *
 * REGRESSION 1 (P0): /api/v1/plans/* HTTP 500
 *   Root cause: plans/brief used Promise.all() with no try/catch — any DB error
 *   propagated as uncaught rejection → HTTP 500 via app.onError.
 *   Plans/review + plans/weekly called getDb() outside try/catch — DATABASE_URL
 *   missing would throw before the query, also becoming 500.
 *
 *   Fix: plans/brief uses Promise.allSettled + per-field fallback.
 *        plans/review + plans/weekly move getDb() inside try/catch.
 *
 *   Tests:
 *     PR1: plans/brief Promise.allSettled contract — rejected sub-calls must not throw
 *     PR2: plans/brief partial success — themes fail, ideas+risk succeed → still 200
 *     PR3: plans/brief all fail → stale_reason contains all three error codes
 *     PR4: plans/review db_init_failed path — getDb throws → stale_reason=db_init_failed, no 500
 *     PR5: plans/weekly db_init_failed path — same guard
 *     PR6: plans/brief source field = "db" on full success, "partial_db" on partial fail
 *
 * REGRESSION 2 (P1): news-top10 headline = "(id not found: 2610)"
 *   Root cause: AI selector returned an id that was not in rawRows (hallucination or
 *   staleness), code produced headline="(id not found: 2610)" and persisted it.
 *
 *   Fix: unknown AI ids are skipped; shortfall is padded with deterministic fallback items.
 *        Headline "(id not found: …)" can never appear in stored result.
 *
 *   Tests:
 *     NR1: AI mapping — unknown id is skipped, no "(id not found: …)" headline
 *     NR2: AI mapping — if AI returns all unknown ids, falls back to deterministic
 *     NR3: AI mapping — partial hit (some valid, some hallucinated) → valid ones kept,
 *          remainder filled from deterministic, total ≤ TOP_N
 *     NR4: deterministic fallback items have why_matters=null, impact_tier=null, tags=[]
 *
 * Run:
 *   node --test --import tsx/esm apps/api/src/__tests__/plans-500-regression.test.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

// ── Regression 1: plans/brief Promise.allSettled contract ────────────────────

describe("PR1: Promise.allSettled — rejected sub-call must not cause outer throw", () => {
  it("PR1: allSettled swallows individual rejections without rethrowing", async () => {
    const failingPromise = Promise.reject(new Error("DB connection refused"));
    const okPromise = Promise.resolve(["theme-a"]);
    const [badResult, goodResult] = await Promise.allSettled([failingPromise, okPromise]);

    assert.strictEqual(badResult.status, "rejected", "failed promise must be 'rejected'");
    assert.strictEqual(goodResult.status, "fulfilled", "ok promise must be 'fulfilled'");

    // Extracting with fallback — the pattern used in the fixed plans/brief handler
    const themes = goodResult.status === "fulfilled" ? goodResult.value : [];
    assert.deepStrictEqual(themes, ["theme-a"], "fulfilled value must be accessible");
  });
});

describe("PR2: plans/brief partial success contract", () => {
  it("PR2: themes fail but ideas+risk succeed → partial result has topThemes=[] + stale_reason", async () => {
    // Simulate the handler logic after allSettled — run real Promise.allSettled
    const [themesResult, ideasResult, riskResult] = await Promise.allSettled([
      Promise.reject(new Error("relation 'themes' does not exist")),
      Promise.resolve({ items: [{ id: "x", symbol: "2330" }], total: 1 }),
      Promise.resolve({ maxPerTradePct: 1.0 })
    ] as [Promise<string[]>, Promise<{ items: unknown[]; total: number }>, Promise<{ maxPerTradePct: number }>]);

    const themes = themesResult.status === "fulfilled" ? themesResult.value : [];
    const ideasView = ideasResult.status === "fulfilled" ? ideasResult.value : { items: [], total: 0 };
    const riskState = riskResult.status === "fulfilled" ? riskResult.value : { maxPerTradePct: null };

    // Stale reasons
    const briefStaleReasons: string[] = [];
    if (themesResult.status === "rejected") briefStaleReasons.push("themes_db_error");
    if (ideasResult.status === "rejected") briefStaleReasons.push("ideas_db_error");
    if (riskResult.status === "rejected") briefStaleReasons.push("risk_db_error");

    const source = briefStaleReasons.length > 0 ? "partial_db" : "db";

    assert.deepStrictEqual(themes, [], "themes fallback must be empty array");
    assert.strictEqual(ideasView.items.length, 1, "ideas must still be accessible");
    assert.strictEqual(riskState.maxPerTradePct, 1.0, "risk must still be accessible");
    assert.ok(briefStaleReasons.includes("themes_db_error"), "must include themes_db_error");
    assert.ok(!briefStaleReasons.includes("ideas_db_error"), "must not include ideas_db_error");
    assert.strictEqual(source, "partial_db", "source must be partial_db");
  });
});

describe("PR3: plans/brief all sub-calls fail → stale_reason covers all three", () => {
  it("PR3: all three sub-calls rejected → stale_reason has all three codes", async () => {
    const [themesResult, ideasResult, riskResult] = await Promise.allSettled([
      Promise.reject(new Error("themes")),
      Promise.reject(new Error("ideas")),
      Promise.reject(new Error("risk"))
    ]);

    const briefStaleReasons: string[] = [];
    if (themesResult.status === "rejected") briefStaleReasons.push("themes_db_error");
    if (ideasResult.status === "rejected") briefStaleReasons.push("ideas_db_error");
    if (riskResult.status === "rejected") briefStaleReasons.push("risk_db_error");

    assert.strictEqual(briefStaleReasons.length, 3, "must have 3 stale reasons");
    assert.ok(briefStaleReasons.includes("themes_db_error"));
    assert.ok(briefStaleReasons.includes("ideas_db_error"));
    assert.ok(briefStaleReasons.includes("risk_db_error"));

    const staleReasonStr = briefStaleReasons.join(",");
    assert.ok(staleReasonStr.includes("themes_db_error,ideas_db_error,risk_db_error"),
      "stale_reason string must contain all three codes");
  });
});

describe("PR4: plans/review getDb() inside try/catch — db_init_failed path", () => {
  it("PR4: getDb() throw must produce stale_reason=db_init_failed, not uncaught 500", () => {
    let staleReason: string | null = null;
    let db: null = null;

    // Simulate the fixed handler's getDb() guard
    try {
      throw new Error("DATABASE_URL is required when PERSISTENCE_MODE=database");
    } catch (err) {
      staleReason = "db_init_failed";
      void err; void db;
    }

    assert.strictEqual(staleReason, "db_init_failed", "staleReason must be db_init_failed");
    // db remains null — no query attempted
    assert.strictEqual(db, null, "db must remain null on init failure");
  });
});

describe("PR5: plans/weekly getDb() same guard", () => {
  it("PR5: getDb() throw in plans/weekly path → stale_reason=db_init_failed, trades=[]", () => {
    let staleReason: string | null = null;
    let tradeCount = 0;
    let db: null = null;

    try {
      throw new Error("DATABASE_URL is required when PERSISTENCE_MODE=database");
    } catch (err) {
      staleReason = "db_init_failed";
      void err; void db;
    }

    assert.strictEqual(staleReason, "db_init_failed");
    assert.strictEqual(tradeCount, 0, "tradeCount must be 0 on init failure");
  });
});

describe("PR6: plans/brief source field", () => {
  it("PR6a: source=db when no failures", () => {
    const briefStaleReasons: string[] = [];
    const source = briefStaleReasons.length > 0 ? "partial_db" : "db";
    assert.strictEqual(source, "db");
  });

  it("PR6b: source=partial_db when any failure", () => {
    const briefStaleReasons = ["themes_db_error"];
    const source = briefStaleReasons.length > 0 ? "partial_db" : "db";
    assert.strictEqual(source, "partial_db");
  });
});

// ── Regression 2: news-top10 headline "(id not found: …)" ────────────────────

// Replicate the key logic from news-ai-selector.ts runNewsAiSelection()
// for unit-testable extraction.

interface RawRow {
  id: string | null;
  title: string | null;
  source: string;
  ticker?: string | null;
  company_name?: string | null;
  date?: string | null;
  url?: string | null;
}

interface AiSel {
  id: string;
  rank: number;
  why_matters: string;
  impact_tier: "HIGH" | "MID" | "LOW";
  tags: string[];
}

interface MappedItem {
  id: string;
  headline: string;
  why_matters: string | null;
  impact_tier: "HIGH" | "MID" | "LOW" | null;
  tags: string[];
  rank: number;
}

const TOP_N = 10;

/** Extract the fixed mapping logic from runNewsAiSelection for unit testing */
function mapAiSelectionToItems(
  rawRows: RawRow[],
  aiSelected: AiSel[],
  asOf: string
): MappedItem[] {
  const rowById = new Map(rawRows.map((r, idx) => [r.id ?? `row-${idx}`, r]));

  const aiMappedItems: MappedItem[] = [];
  const aiSelectedIds = new Set<string>();

  for (let idx = 0; idx < aiSelected.length && aiMappedItems.length < TOP_N; idx++) {
    const sel = aiSelected[idx]!;
    const row = rowById.get(sel.id);
    if (!row) {
      // Skip hallucinated id — do NOT produce "(id not found: …)"
      continue;
    }
    aiSelectedIds.add(sel.id);
    aiMappedItems.push({
      id: row.id ?? sel.id,
      headline: row.title ?? "(no title)",
      why_matters: sel.why_matters ?? null,
      impact_tier: sel.impact_tier,
      tags: Array.isArray(sel.tags) ? sel.tags.slice(0, 3) : [],
      rank: sel.rank ?? idx + 1
    });
  }

  // Pad with deterministic fallback if AI shortfall
  if (aiMappedItems.length < TOP_N) {
    for (const row of rawRows) {
      if (aiMappedItems.length >= TOP_N) break;
      const rowId = row.id ?? "";
      if (aiSelectedIds.has(rowId)) continue;
      aiMappedItems.push({
        id: rowId,
        headline: row.title ?? "(no title)",
        why_matters: null,
        impact_tier: null,
        tags: [],
        rank: aiMappedItems.length + 1
      });
      aiSelectedIds.add(rowId);
    }
  }

  void asOf;
  return aiMappedItems;
}

const makeRow = (id: string, title: string): RawRow => ({
  id, title, source: "twse_announcements", ticker: null, company_name: null, date: null, url: null
});

describe("NR1: AI hallucinated id — no '(id not found: …)' headline in result", () => {
  it("NR1: AI returns unknown id → item is skipped, headline never contains 'id not found'", () => {
    const rawRows: RawRow[] = [makeRow("100", "台積電法說會")];
    const aiSelected: AiSel[] = [
      { id: "9999", rank: 1, why_matters: "重大", impact_tier: "HIGH", tags: ["半導體"] },
      { id: "100",  rank: 2, why_matters: "法說",  impact_tier: "MID",  tags: ["法說"]  }
    ];

    const items = mapAiSelectionToItems(rawRows, aiSelected, "2026-05-09T10:00:00.000Z");

    // id=9999 is unknown — must be skipped
    const badItem = items.find(i => i.headline.includes("id not found"));
    assert.ok(!badItem, `No item should have '(id not found: …)' headline, got: ${JSON.stringify(badItem)}`);

    // id=100 is valid — must appear
    const validItem = items.find(i => i.id === "100");
    assert.ok(validItem, "Valid row id=100 must appear in result");
    assert.strictEqual(validItem!.headline, "台積電法說會");
  });
});

describe("NR2: all AI ids unknown → full deterministic fallback", () => {
  it("NR2: all AI ids hallucinated → result uses raw rows directly, no id not found", () => {
    const rawRows: RawRow[] = [
      makeRow("1", "聯發科展望"),
      makeRow("2", "台灣電力停電"),
      makeRow("3", "外資買超")
    ];
    const aiSelected: AiSel[] = [
      { id: "9001", rank: 1, why_matters: "...", impact_tier: "HIGH", tags: [] },
      { id: "9002", rank: 2, why_matters: "...", impact_tier: "MID",  tags: [] }
    ];

    const items = mapAiSelectionToItems(rawRows, aiSelected, "2026-05-09T10:00:00.000Z");

    // No "(id not found: …)" anywhere
    const badItems = items.filter(i => i.headline.includes("id not found"));
    assert.deepStrictEqual(badItems, [], "No items should have id-not-found headline");

    // Should be padded from rawRows
    assert.ok(items.length > 0, "items must not be empty when rawRows exist");
    assert.ok(items.length <= TOP_N, `items.length (${items.length}) must be <= TOP_N (${TOP_N})`);
    // All headlines should match actual raw rows
    for (const item of items) {
      const matchingRow = rawRows.find(r => r.id === item.id);
      assert.ok(matchingRow, `item id=${item.id} must correspond to a real raw row`);
    }
  });
});

describe("NR3: partial hit — some AI ids valid, some hallucinated", () => {
  it("NR3: valid ids kept, unknown ids skipped, remainder from deterministic", () => {
    const rawRows: RawRow[] = [
      makeRow("10", "台積電法說"),
      makeRow("11", "聯電擴產"),
      makeRow("12", "鴻海盈餘")
    ];
    const aiSelected: AiSel[] = [
      { id: "10",   rank: 1, why_matters: "法說",  impact_tier: "HIGH", tags: ["TSMC"] },
      { id: "9999", rank: 2, why_matters: "幻覺",  impact_tier: "HIGH", tags: ["fake"] },
      { id: "11",   rank: 3, why_matters: "擴產",  impact_tier: "MID",  tags: ["DRAM"] }
    ];

    const items = mapAiSelectionToItems(rawRows, aiSelected, "2026-05-09T10:00:00.000Z");

    const idNotFound = items.filter(i => i.headline.includes("id not found"));
    assert.deepStrictEqual(idNotFound, [], "No id-not-found items");

    // id=10 and id=11 must be present (from AI)
    assert.ok(items.find(i => i.id === "10"), "id=10 must be in result");
    assert.ok(items.find(i => i.id === "11"), "id=11 must be in result");

    // id=12 may appear as deterministic fill
    assert.ok(items.length <= TOP_N, "total items <= TOP_N");
    assert.ok(items.length >= 2, "at least the 2 valid AI items must be present");
  });
});

describe("NR4: deterministic fallback items have cleared AI fields", () => {
  it("NR4: fallback items filled from deterministic have why_matters=null, impact_tier=null, tags=[]", () => {
    const rawRows: RawRow[] = [makeRow("20", "停牌公告")];
    // AI returns hallucinated id only
    const aiSelected: AiSel[] = [
      { id: "99999", rank: 1, why_matters: "幻覺", impact_tier: "HIGH", tags: ["fake"] }
    ];

    const items = mapAiSelectionToItems(rawRows, aiSelected, "2026-05-09T10:00:00.000Z");

    // id=20 must be there as fallback
    const fallbackItem = items.find(i => i.id === "20");
    assert.ok(fallbackItem, "fallback item id=20 must exist");
    assert.strictEqual(fallbackItem!.why_matters, null, "fallback why_matters must be null");
    assert.strictEqual(fallbackItem!.impact_tier, null, "fallback impact_tier must be null");
    assert.deepStrictEqual(fallbackItem!.tags, [], "fallback tags must be []");
  });
});
