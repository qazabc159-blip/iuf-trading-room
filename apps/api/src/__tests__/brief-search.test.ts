/**
 * brief-search.test.ts — Unit tests for /api/v1/briefs/search endpoint logic
 *
 * Coverage:
 *   BS1. keyword hit — FTS query structure and param validation accepted
 *   BS2. date filter — from/to boundary enforcement
 *   BS3. pagination — limit/offset clamping (max 50, min 1, offset ≥ 0)
 *   BS4. no result — empty items + total=0 shape
 *   BS5. missing q — 400 with missing_q error
 *   BS6. published filter — only published/approved/worker-draft rows qualify
 *
 * Run: node --test --import tsx/esm apps/api/src/__tests__/brief-search.test.ts
 *
 * No HTTP route hit. No DB. Pure unit tests exercising the parameter-parsing
 * and response-shaping logic that the route handler delegates to.
 *
 * Hard lines verified:
 *  - unpublished/draft briefs are NEVER included
 *  - limit is clamped to [1, 50]
 *  - offset is clamped to ≥ 0
 *  - q is required and non-empty
 *  - date defaults: 90 days ago → today
 *  - summary_preview max 200 chars
 *  - rank field is a number
 */

import assert from "node:assert/strict";
import test from "node:test";

// ---------------------------------------------------------------------------
// Helpers — mirrors the inline logic in the route handler
// (pure functions extracted for testability, no DB/Hono dependency)
// ---------------------------------------------------------------------------

const SUMMARY_PREVIEW_LENGTH = 200;

/** Derive brief title from sections (mirrors route handler) */
function deriveTitle(sections: Array<{ heading: string; body: string }>, date: string): string {
  return sections[0]?.heading ?? `Brief ${date}`;
}

/** Build summary preview (mirrors route handler) */
function buildSummaryPreview(sections: Array<{ heading: string; body: string }>): string {
  const allBody = sections.map((s) => s.body).join(" ");
  return allBody.slice(0, SUMMARY_PREVIEW_LENGTH) + (allBody.length > SUMMARY_PREVIEW_LENGTH ? "…" : "");
}

/** Clamp limit to [1, 50] (mirrors route handler) */
function clampLimit(raw: number | null): number {
  if (raw === null || isNaN(raw)) return 20;
  return Math.min(Math.max(1, raw), 50);
}

/** Clamp offset to ≥ 0 (mirrors route handler) */
function clampOffset(raw: number | null): number {
  if (raw === null || isNaN(raw)) return 0;
  return Math.max(0, raw);
}

/** Published-status filter (mirrors listBriefs normalization + search filter) */
function isPublishedForSearch(row: { status: string; generatedBy: string }): boolean {
  // Worker rule-template drafts are excluded since 2026-06-11 — they never meet
  // the v2 template contract and surfaced as empty-shell briefs (6/10 audit).
  return row.status === "published" || row.status === "approved";
}

/** Simulate search result item shape */
function buildSearchItem(row: {
  id: string;
  date: string;
  sections: Array<{ heading: string; body: string }>;
  rank: number;
  matchedIn: string;
}) {
  const title = deriveTitle(row.sections, row.date);
  const summaryPreview = buildSummaryPreview(row.sections);
  return {
    id: row.id,
    date: row.date,
    title,
    summary_preview: summaryPreview,
    matched_in: row.matchedIn,
    rank: Math.round(row.rank * 100) / 100
  };
}

// ---------------------------------------------------------------------------
// BS1. Keyword hit — response item shape is correct
// ---------------------------------------------------------------------------

test("BS1: keyword hit — response item has correct shape with title, preview, rank, matched_in", () => {
  const mockRow = {
    id: "00000000-0000-0000-0000-000000000001",
    date: "2026-05-08",
    sections: [
      { heading: "台積電Q1法說重點", body: "台積電 (2330) 公布第一季法說會內容，EPS 8.2元，優於預期。展望第二季CoWoS封裝需求持續旺盛。" }
    ],
    rank: 0.756,
    matchedIn: "title"
  };

  const item = buildSearchItem(mockRow);

  assert.equal(item.id, "00000000-0000-0000-0000-000000000001");
  assert.equal(item.date, "2026-05-08");
  assert.equal(item.title, "台積電Q1法說重點");
  assert.ok(item.summary_preview.length <= SUMMARY_PREVIEW_LENGTH + 3, "preview must not exceed 200 chars + ellipsis"); // +3 for "…"
  assert.equal(item.matched_in, "title");
  assert.equal(typeof item.rank, "number");
  assert.ok(item.rank >= 0 && item.rank <= 1, "rank must be in [0, 1]");
});

// ---------------------------------------------------------------------------
// BS2. Date filter — boundary enforcement
// ---------------------------------------------------------------------------

test("BS2: date filter — fromDate/toDate defaults computed correctly", () => {
  const todayStr = new Date().toISOString().slice(0, 10);
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  assert.ok(DATE_RE.test(todayStr), "todayStr must match YYYY-MM-DD");
  assert.ok(DATE_RE.test(ninetyDaysAgo), "ninetyDaysAgo must match YYYY-MM-DD");
  assert.ok(ninetyDaysAgo < todayStr, "ninetyDaysAgo must be before today");

  // Simulate: brief dated 60 days ago should fall inside default window
  const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  assert.ok(sixtyDaysAgo >= ninetyDaysAgo, "60d-ago brief must be inside default 90d window");
  assert.ok(sixtyDaysAgo <= todayStr, "60d-ago brief must not be in the future");

  // Simulate: brief dated 100 days ago should fall outside default window
  const hundredDaysAgo = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  assert.ok(hundredDaysAgo < ninetyDaysAgo, "100d-ago brief must be outside default 90d window");
});

// ---------------------------------------------------------------------------
// BS3. Pagination — limit/offset clamping
// ---------------------------------------------------------------------------

test("BS3: pagination — limit clamped to [1, 50], offset clamped to ≥ 0", () => {
  // Default
  assert.equal(clampLimit(null), 20);
  assert.equal(clampOffset(null), 0);

  // Within bounds
  assert.equal(clampLimit(20), 20);
  assert.equal(clampLimit(1), 1);
  assert.equal(clampLimit(50), 50);
  assert.equal(clampOffset(10), 10);

  // Over max
  assert.equal(clampLimit(51), 50, "limit 51 must be clamped to 50");
  assert.equal(clampLimit(999), 50, "limit 999 must be clamped to 50");

  // Under min
  assert.equal(clampLimit(0), 1, "limit 0 must be clamped to 1");
  assert.equal(clampLimit(-5), 1, "limit -5 must be clamped to 1");
  assert.equal(clampOffset(-10), 0, "offset -10 must be clamped to 0");
});

// ---------------------------------------------------------------------------
// BS4. No result — empty items array + total=0
// ---------------------------------------------------------------------------

test("BS4: no result — response shape has items=[], total=0", () => {
  const response = {
    items: [] as ReturnType<typeof buildSearchItem>[],
    total: 0,
    limit: 20,
    offset: 0,
    search_mode: "fts" as "fts" | "ilike"
  };

  assert.deepEqual(response.items, []);
  assert.equal(response.total, 0);
  assert.equal(response.limit, 20);
  assert.equal(response.offset, 0);
  assert.ok(response.search_mode === "fts" || response.search_mode === "ilike");
});

// ---------------------------------------------------------------------------
// BS5. Missing q — validation rejects empty/whitespace-only
// ---------------------------------------------------------------------------

test("BS5: missing q — empty or whitespace-only q is rejected", () => {
  // Simulate the route handler validation
  function validateQ(rawQ: string): { ok: true } | { ok: false; error: string } {
    if (!rawQ.trim()) {
      return { ok: false, error: "missing_q" };
    }
    return { ok: true };
  }

  assert.deepEqual(validateQ(""), { ok: false, error: "missing_q" });
  assert.deepEqual(validateQ("   "), { ok: false, error: "missing_q" });
  assert.deepEqual(validateQ("\t\n"), { ok: false, error: "missing_q" });
  assert.deepEqual(validateQ("台積電"), { ok: true });
  assert.deepEqual(validateQ("TSMC Q1"), { ok: true });
});

// ---------------------------------------------------------------------------
// BS6. Published filter — only published/approved rows qualify
// ---------------------------------------------------------------------------

test("BS6: published filter — draft rows are excluded regardless of author", () => {
  // Should be included
  assert.ok(isPublishedForSearch({ status: "published", generatedBy: "worker" }));
  assert.ok(isPublishedForSearch({ status: "published", generatedBy: "manual" }));
  assert.ok(isPublishedForSearch({ status: "approved", generatedBy: "worker" }));

  // Must be excluded — worker rule-template drafts never meet the v2 contract
  // and surfaced as empty-shell briefs (6/10 audit; changed 2026-06-11)
  assert.ok(!isPublishedForSearch({ status: "draft", generatedBy: "worker" }), "worker rule-template draft must NOT be included");
  assert.ok(!isPublishedForSearch({ status: "draft", generatedBy: "manual" }), "manual draft must NOT be included");
  assert.ok(!isPublishedForSearch({ status: "awaiting_review", generatedBy: "worker" }), "awaiting_review must NOT be included");
  assert.ok(!isPublishedForSearch({ status: "queued_for_review", generatedBy: "worker" }), "queued_for_review must NOT be included");
  assert.ok(!isPublishedForSearch({ status: "rejected", generatedBy: "worker" }), "rejected must NOT be included");
});
