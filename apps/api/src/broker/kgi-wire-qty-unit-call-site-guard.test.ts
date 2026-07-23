/**
 * kgi-wire-qty-unit-call-site-guard.test.ts
 *
 * Standing regression guard for Pete's PR #1345 round-2 🟡 #1 (non-blocking,
 * fast-follow): "a small standing regression test that greps
 * reconcileKgiOrder(/reconcileUnconfirmedAuditOrders( call sites in
 * s1-sim-runner.ts/v34-sim-runner.ts/v51-sim-basket-runner.ts/server.ts and
 * asserts each one sets wireQtyUnit/isOddLot explicitly, so a future
 * omission fails CI instead of failing silently in production."
 *
 * Why this matters: reconcileKgiOrder()'s `wireQtyUnit` (and
 * reconcileUnconfirmedAuditOrders()'s `isOddLot`) default to "no conversion"
 * for backward compat (see kgi-order-reconciliation.ts). A NEW call site in
 * one of these 4 files that forgets to set it silently reintroduces the
 * exact 1000x board-lot bug #1345 fixed (lots read back as if already
 * shares) — with zero compile-time signal, because the field is optional.
 *
 * Deliberately scoped to these 4 files only. kgi-order-reconciliation.ts's
 * OWN syncKgiUnifiedOrders() (UTA-C2) caller intentionally omits
 * wireQtyUnit — reviewed and accepted as out-of-scope in PR #1345 round-2
 * §3c (a different, not-yet-verified code path; changing its default would
 * be an unreviewed behavior change outside that PR's mandate). Do not add
 * kgi-order-reconciliation.ts itself to SCANNED_FILES.
 *
 * This is a text/grep-level guard (per Pete's own suggested shape), not a
 * full AST check — it looks for the wireQtyUnit/isOddLot marker within a
 * generous line window around each call site, because callers sometimes
 * build the order object several lines before the call (e.g. server.ts's
 * `baseOrders` array is built ~30 lines above its `reconcileKgiOrders()`
 * call).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const SCANNED_FILES = [
  "apps/api/src/s1-sim-runner.ts",
  "apps/api/src/v34-sim-runner.ts",
  "apps/api/src/v51-sim-basket-runner.ts",
  "apps/api/src/server.ts",
];

const CALL_PATTERN = /\b(?:reconcileKgiOrder|reconcileKgiOrders|reconcileUnconfirmedAuditOrders)\s*\(/;
const MARKER_PATTERN = /wireQtyUnit|isOddLot/;
const WINDOW_LINES = 40;

/**
 * Returns 1-indexed line numbers of reconcile*() call sites in `source`
 * that have no wireQtyUnit/isOddLot marker within WINDOW_LINES lines
 * (before or after).
 *
 * KNOWN LIMITATION (Pete PR #1348 review 🟡 #1, not fixed this round — text/
 * grep-level, not AST-level): this window check does NOT verify the marker
 * actually belongs to the SAME call's order object — it only checks that
 * the marker string appears somewhere nearby. If a future edit adds two
 * call sites in one of these files less than ~80 lines apart, where one has
 * a marker and the other doesn't, the unmarked one could silently borrow
 * its neighbor's marker and pass when it shouldn't. Verified safe as of
 * 2026-07-23: every real call-site pair in these 4 files today is >180
 * lines apart (s1-sim-runner.ts 918/1124, v34-sim-runner.ts 816/969,
 * v51-sim-basket-runner.ts 700/850, server.ts 5856/6136 — actual line
 * numbers may drift, the >180-line gap is the invariant that matters). If
 * this guard ever needs to be hardened against that gap (e.g. after adding
 * a new close-together call site), tighten the window or switch to
 * matching the marker inside the same `{...}` argument block specifically —
 * out of scope for this fast-follow, tracked as a queue item, not fixed
 * here.
 */
function findUnmarkedCallSites(source: string): number[] {
  const lines = source.split("\n");
  const violations: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!CALL_PATTERN.test(lines[i])) continue;
    const start = Math.max(0, i - WINDOW_LINES);
    const end = Math.min(lines.length, i + WINDOW_LINES);
    const windowText = lines.slice(start, end).join("\n");
    if (!MARKER_PATTERN.test(windowText)) violations.push(i + 1);
  }
  return violations;
}

for (const relPath of SCANNED_FILES) {
  test(`${relPath}: every reconcile*() call site sets wireQtyUnit/isOddLot within ${WINDOW_LINES} lines`, () => {
    const source = readFileSync(path.join(process.cwd(), relPath), "utf8");
    const callSiteCount = (source.match(new RegExp(CALL_PATTERN.source, "g")) ?? []).length;
    assert.ok(
      callSiteCount > 0,
      `expected at least 1 reconcile*() call site in ${relPath} — if this file no longer calls reconcile*(), remove it from SCANNED_FILES in this test`,
    );

    const violations = findUnmarkedCallSites(source);
    assert.deepEqual(
      violations,
      [],
      `${relPath}: reconcile*() call(s) at line(s) ${violations.join(", ")} have no wireQtyUnit/isOddLot within ${WINDOW_LINES} lines — ` +
        `this is the exact call-site class that caused PR #1345's 1000x board-lot bug (lots silently read back as shares). ` +
        `Set wireQtyUnit ("lots"|"shares") on the order object, or isOddLot on the UnconfirmedAuditOrder.`,
    );
  });
}

test("findUnmarkedCallSites: detects a real call site with its marker removed (proves the guard is not a no-op)", () => {
  // Take REAL current source and, in memory only (never written to disk),
  // strip exactly one wireQtyUnit occurrence — proves the detector actually
  // fires on the call-site shape this repo uses today, not just a synthetic
  // fixture that happens to match the regex.
  const source = readFileSync(path.join(process.cwd(), "apps/api/src/s1-sim-runner.ts"), "utf8");
  assert.deepEqual(findUnmarkedCallSites(source), [], "sanity: real file is clean before mutation");

  const markerLine = /^\s*wireQtyUnit: "lots",\s*$/m;
  assert.match(source, markerLine, "expected to find a literal `wireQtyUnit: \"lots\",` line to remove for this test");
  const mutated = source.replace(markerLine, "");
  assert.notEqual(mutated, source, "mutation must actually change the source");

  const violations = findUnmarkedCallSites(mutated);
  assert.ok(
    violations.length > 0,
    "removing the wireQtyUnit marker line must turn the guard red — if this assertion fails, the guard is not actually checking anything",
  );
});

test("findUnmarkedCallSites: synthetic fixture without any marker is flagged, with-marker fixture passes", () => {
  const withMarker = [
    "  const reconciled = reconcileKgiOrder({",
    "    order: {",
    "      tradeId,",
    "      symbol: entry.symbol,",
    "      side: \"buy\",",
    "      requestedQty: entry.target_shares,",
    "      wireQtyUnit: \"lots\",",
    "    },",
    "  });",
  ].join("\n");
  const withoutMarker = [
    "  const reconciled = reconcileKgiOrder({",
    "    order: {",
    "      tradeId,",
    "      symbol: entry.symbol,",
    "      side: \"buy\",",
    "      requestedQty: entry.target_shares,",
    "    },",
    "  });",
  ].join("\n");

  assert.deepEqual(findUnmarkedCallSites(withMarker), []);
  assert.deepEqual(findUnmarkedCallSites(withoutMarker), [1]);
});
