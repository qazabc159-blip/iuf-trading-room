/**
 * sim-go-live-audit-backfill-round2-20260724.test.ts
 *
 * Coverage:
 *   - Batch A (7/23 v51 45 orders) reproduces Round 1's exact APPLY'd status
 *     breakdown (regression anchor — see reports/sim_go_live_20260723/evidence/
 *     audit_backfill_dry_run_container_1784816245942.json, the container-run
 *     dry-run Elva actually re-verified before APPLY).
 *   - Batch B (7/24 residual, 28 orders) ground-truth resolution: exact
 *     per-symbol status for the tricky cases (phase1/phase2 same-symbol
 *     price-keyed disambiguation, the 4 rejected-both-phases symbols) plus
 *     exact status-breakdown counts for both the v51 and v34 result sets.
 *   - Distinct-entityId non-collision: both entityId strings used here are
 *     structurally guaranteed to never match a real runner's own entityId.
 *   - insertRowIfAbsent(): idempotency (second call with the same key is a
 *     no-op SKIP, not a re-insert) and the "no explicit createdAt" invariant
 *     the "cron picks up the newest row" claim depends on.
 *   - "Cron consumption path" static-scan regression test — see that
 *     section's own header comment for why this is a static check rather
 *     than a live-DB integration test (no local/CI Postgres fixture exists
 *     in this repo; see reconcileUnconfirmedV51Orders's own existing test,
 *     which is also memory-mode-only, not a gap this PR introduces).
 *   - Determinism: re-running the ground-truth builders twice on the same
 *     input files produces byte-identical `results` arrays (dry-run is
 *     side-effect-free and reproducible).
 *
 * No DB. No network. No broker I/O — pure function coverage plus read-only
 * fs access to the already-committed evidence files, and read-only fs access
 * to the two runner source files for the static-scan section.
 */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  type AuditRowInsertClient,
  buildBatchAV51Report,
  buildResidualResults,
  insertRowIfAbsent,
  loadResidualGroundTruth,
  resolveResidualStatus,
} from "./sim-go-live-audit-backfill-round2-20260724.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");

const BATCH_A_ENTITY_ID = "2026-07-13:adhoc-20260723";
const BATCH_B_ENTITY_ID = "2026-07-24:adhoc-resend";

// ---------------------------------------------------------------------------
// Batch A — reproduces Round 1's exact status breakdown with the new entityId.
// ---------------------------------------------------------------------------

test("Batch A: reproduces Round 1's exact 45-order v51 status breakdown", async () => {
  const report = await buildBatchAV51Report();
  assert.equal(report.results.length, 45);
  const counts: Record<string, number> = {};
  for (const r of report.results) counts[r.status] = (counts[r.status] ?? 0) + 1;
  // Anchor: reports/sim_go_live_20260723/evidence/audit_backfill_dry_run_container_1784816245942.json
  // (Elva's actual pre-APPLY container re-verification of Round 1's payload).
  assert.deepEqual(counts, { partially_filled: 6, accepted: 9, filled: 26, rejected: 3, unconfirmed: 1 });
  assert.equal(report.basketSignalDate, "2026-07-13");
  assert.equal(report.entryDateTst, "2026-07-23");
});

test("Batch A: results are deterministic across repeated builds (same input, same output)", async () => {
  const a = await buildBatchAV51Report();
  const b = await buildBatchAV51Report();
  assert.deepEqual(a.results, b.results);
});

// ---------------------------------------------------------------------------
// Batch B — ground truth resolution against the real 2026-07-24 evidence.
// ---------------------------------------------------------------------------

test("Batch B: v51 + v34 residual status breakdowns match hand-verified ground truth", async () => {
  const { results } = await buildResidualResults();
  assert.equal(results.length, 28);

  const v51 = results.filter((r) => r.sleeve !== "v34_c3_proxy");
  const v34 = results.filter((r) => r.sleeve === "v34_c3_proxy");
  assert.equal(v51.length, 24);
  assert.equal(v34.length, 4);

  const countBy = (rows: typeof results) => {
    const out: Record<string, number> = {};
    for (const r of rows) out[r.status] = (out[r.status] ?? 0) + 1;
    return out;
  };
  // Hand-verified against reports/sim_go_live_20260723/evidence/trades_manual_0724.json's
  // 20 valid order_id buckets + 8-entry invalid bucket (see this test file's
  // header and the script's own header for the full derivation).
  assert.deepEqual(countBy(v51), { filled: 11, partially_filled: 4, accepted: 3, rejected: 6 });
  assert.deepEqual(countBy(v34), { filled: 2, rejected: 2 });
});

test("Batch B: phase1/phase2 same-symbol requote disambiguation via (symbol, price) join key", async () => {
  const { results } = await buildResidualResults();
  const byKey = (symbol: string, phase: "phase1" | "phase2") =>
    results.find((r) => r.stockId === symbol && r.phase === phase);

  // 4113/2465/8059: phase1 unfilled-still-open (accepted), phase2 fully filled —
  // proves the join correctly separates two orders for the same symbol using price,
  // not just symbol (which would be ambiguous).
  for (const symbol of ["4113", "2465", "8059"]) {
    const p1 = byKey(symbol, "phase1");
    const p2 = byKey(symbol, "phase2");
    assert.ok(p1, `expected a phase1 result for ${symbol}`);
    assert.ok(p2, `expected a phase2 result for ${symbol}`);
    assert.equal(p1!.status, "accepted", `${symbol} phase1 should be accepted (open, unfilled, superseded by phase2 requote)`);
    assert.equal(p2!.status, "filled", `${symbol} phase2 should be filled`);
    assert.notEqual(p1!.kgiOrderId, p2!.kgiOrderId, `${symbol} phase1/phase2 must resolve to two DIFFERENT KGI order ids, not merge`);
  }
});

test("Batch B: the 4 INVALID symbols (1271/5267/6808/6505) are rejected in both phase1 and phase2", async () => {
  const { results } = await buildResidualResults();
  for (const symbol of ["1271", "5267", "6808", "6505"]) {
    const matches = results.filter((r) => r.stockId === symbol);
    assert.equal(matches.length, 2, `expected exactly 2 attempts (phase1+phase2) for ${symbol}`);
    for (const m of matches) {
      assert.equal(m.status, "rejected", `${symbol} ${m.phase} should be rejected`);
      assert.match(m.error ?? "", /kgi_invalid_order_bucket/);
    }
  }
});

test("Batch B: partial fills with no phase2 retry stay terminal 'partially_filled' (no unconfirmed leakage)", async () => {
  const { results } = await buildResidualResults();
  for (const symbol of ["6177", "2101", "6885", "4416"]) {
    const matches = results.filter((r) => r.stockId === symbol);
    assert.equal(matches.length, 1, `${symbol} should have exactly 1 attempt (no phase2 retry)`);
    assert.equal(matches[0].status, "partially_filled");
  }
});

test("Batch B: resolveResidualStatus returns 'unconfirmed' (not a guess) when no ground-truth bucket matches", async () => {
  const gt = await loadResidualGroundTruth();
  const result = resolveResidualStatus({ symbol: "9999", price: 12.34 }, gt);
  assert.equal(result.status, "unconfirmed");
  assert.match(result.error ?? "", /no_matching_order_id_bucket_for_symbol_price/);
});

test("Batch B: results are deterministic across repeated builds (same input, same output)", async () => {
  const a = await buildResidualResults();
  const b = await buildResidualResults();
  assert.deepEqual(a.results, b.results);
});

// ---------------------------------------------------------------------------
// entityId distinctness — structurally guaranteed non-collision with any
// real runner-written row.
// ---------------------------------------------------------------------------

test("entityId strings can never collide with a real runner's own entityId", () => {
  const realEntityIdShape = /^\d{4}-\d{2}-\d{2}$/;
  assert.equal(realEntityIdShape.test(BATCH_A_ENTITY_ID), false, "BATCH_A_ENTITY_ID must not look like a bare YYYY-MM-DD basketSignalDate/basketAsOfDate");
  assert.equal(realEntityIdShape.test(BATCH_B_ENTITY_ID), false, "BATCH_B_ENTITY_ID must not look like a bare YYYY-MM-DD basketSignalDate/basketAsOfDate");
  // The two known real/already-occupied entityId values from Round 1's incident.
  assert.notEqual(BATCH_A_ENTITY_ID, "2026-07-13", "must not reuse the entityId that collided with the real v51 runner row (a851467f)");
  assert.notEqual(BATCH_B_ENTITY_ID, "2026-07-21", "must not reuse Round 1's already-inserted v34 entityId (9df694a1)");
  assert.notEqual(BATCH_A_ENTITY_ID, BATCH_B_ENTITY_ID);
});

// ---------------------------------------------------------------------------
// insertRowIfAbsent — idempotency + the "no explicit createdAt" invariant.
// ---------------------------------------------------------------------------

function makeFakeAuditRowInsertClient() {
  const store: Array<{ workspaceId: string; action: string; entityType: string; entityId: string; payload: unknown; insertCallArgs?: unknown }> = [];
  const insertCalls: unknown[] = [];
  const client: AuditRowInsertClient = {
    async selectExisting(key) {
      return store
        .filter((r) => r.workspaceId === key.workspaceId && r.action === key.action && r.entityType === key.entityType && r.entityId === key.entityId)
        .map((r, i) => ({ id: `fake-id-${i}` }));
    },
    async insertRow(row) {
      insertCalls.push(row);
      store.push(row);
      return [{ id: `fake-id-${store.length - 1}` }];
    },
  };
  return { client, store, insertCalls };
}

test("insertRowIfAbsent: first call inserts, second call with the SAME key is a no-op SKIP (idempotency)", async () => {
  const { client, insertCalls } = makeFakeAuditRowInsertClient();
  const row = { workspaceId: "ws-1", action: "v51_sim.order_submit", entityType: "v51_sim", entityId: BATCH_B_ENTITY_ID, payload: { ok: true } };

  const first = await insertRowIfAbsent(client, row);
  assert.equal(first.inserted, true);

  const second = await insertRowIfAbsent(client, row);
  assert.equal(second.inserted, false);
  assert.equal(second.id, first.id, "SKIP must return the id of the EXISTING row, not fabricate a new one");

  assert.equal(insertCalls.length, 1, "insertRow must be called exactly once across both invocations — the second is a pure read-and-skip");
});

test("insertRowIfAbsent: a DIFFERENT entityId at the same key coordinates is NOT skipped (proves the key is entityId-specific, not overly broad)", async () => {
  const { client } = makeFakeAuditRowInsertClient();
  const rowA = { workspaceId: "ws-1", action: "v51_sim.order_submit", entityType: "v51_sim", entityId: BATCH_A_ENTITY_ID, payload: {} };
  const rowB = { workspaceId: "ws-1", action: "v51_sim.order_submit", entityType: "v51_sim", entityId: BATCH_B_ENTITY_ID, payload: {} };
  const resultA = await insertRowIfAbsent(client, rowA);
  const resultB = await insertRowIfAbsent(client, rowB);
  assert.equal(resultA.inserted, true);
  assert.equal(resultB.inserted, true);
  assert.notEqual(resultA.id, resultB.id);
});

test("insertRowIfAbsent: never passes an explicit createdAt through to insertRow (relies on the DB's defaultNow(), which is what guarantees the cron's ORDER BY createdAt DESC picks up this row as newest)", async () => {
  const { client, insertCalls } = makeFakeAuditRowInsertClient();
  await insertRowIfAbsent(client, { workspaceId: "ws-1", action: "v51_sim.order_submit", entityType: "v51_sim", entityId: BATCH_B_ENTITY_ID, payload: {} });
  assert.equal(insertCalls.length, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(insertCalls[0] as object, "createdAt"), false);
});

// ---------------------------------------------------------------------------
// "Cron consumption path" — static-scan regression test.
//
// WHY STATIC, NOT A LIVE-DB TEST: this repo has no local/CI Postgres test
// fixture (packages/db/src/client.ts's isDatabaseMode() gates on
// PERSISTENCE_MODE=database, and the existing reconcileUnconfirmedV51Orders
// test — v51-sim-basket-runner.test.ts — is explicitly documented as
// exercising ONLY the memory-mode no-op path for that same reason). Building
// a real Postgres-backed integration harness is out of scope for a backfill
// task (would be new, unrequested test infrastructure — Simplicity First).
//
// What CAN be verified without a DB: the readLatest{V51,V34}OrderSubmitAuditRow
// functions' SQL query CONSTRUCTION — i.e. that the WHERE clause has no
// entityId filter and the query is ORDER BY createdAt DESC LIMIT 1. That
// query shape, combined with insertRowIfAbsent's proven "no explicit
// createdAt" behavior above (which lets Postgres's audit_logs.createdAt
// defaultNow() stamp every backfilled row strictly later than any historical
// row), is the complete proof: the cron reads whichever row was inserted
// most recently, and Round 2's rows are always the most recent ones at
// APPLY time. This test is a REGRESSION GUARD — if someone later "fixes"
// the cron to filter on entityId (which would silently break every
// distinct-entityId backfill including this one), this test fails.
// ---------------------------------------------------------------------------

/**
 * Extracts a top-level `async function name(...): ReturnType { ... }` declaration's
 * full source text (params through the closing brace), starting from the given
 * signature substring. Skips past the parameter list and TS return-type
 * annotation (tracking `<...>` generic depth, since e.g. `Promise<{ id: ... }>`
 * contains a `{` that is NOT the function body's opening brace) before
 * brace-balancing the real body.
 */
function extractFunctionBody(source: string, signature: string): string {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, `signature not found in source: ${signature}`);

  const parenStart = source.indexOf("(", start);
  assert.ok(parenStart >= 0, `no parameter list found after signature: ${signature}`);
  let parenDepth = 0;
  let afterParams = -1;
  for (let i = parenStart; i < source.length; i++) {
    if (source[i] === "(") parenDepth++;
    else if (source[i] === ")") {
      parenDepth--;
      if (parenDepth === 0) {
        afterParams = i + 1;
        break;
      }
    }
  }
  assert.ok(afterParams >= 0, `unbalanced parens extracting parameter list: ${signature}`);

  let angleDepth = 0;
  let braceStart = -1;
  for (let i = afterParams; i < source.length; i++) {
    const ch = source[i];
    if (ch === "<") angleDepth++;
    else if (ch === ">" && angleDepth > 0) angleDepth--;
    else if (ch === "{" && angleDepth === 0) {
      braceStart = i;
      break;
    }
  }
  assert.ok(braceStart >= 0, `no function body opening brace found after return-type annotation: ${signature}`);

  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced braces extracting function body: ${signature}`);
}

test("cron consumption path (static): readLatestV51OrderSubmitAuditRow has NO entityId filter and IS ordered by createdAt DESC LIMIT 1", async () => {
  const source = await fs.readFile(path.join(REPO_ROOT, "apps/api/src/v51-sim-basket-runner.ts"), "utf8");
  const body = extractFunctionBody(source, "async function readLatestV51OrderSubmitAuditRow(");
  assert.doesNotMatch(body, /entityId/, "readLatestV51OrderSubmitAuditRow must not filter on entityId — that's what lets a distinct-entityId backfill row be picked up as 'latest'");
  assert.match(body, /\.orderBy\(desc\(auditLogs\.createdAt\)\)/);
  assert.match(body, /\.limit\(1\)/);
});

test("cron consumption path (static): readLatestV34OrderSubmitAuditRow has NO entityId filter and IS ordered by createdAt DESC LIMIT 1", async () => {
  const source = await fs.readFile(path.join(REPO_ROOT, "apps/api/src/v34-sim-runner.ts"), "utf8");
  const body = extractFunctionBody(source, "async function readLatestV34OrderSubmitAuditRow(");
  assert.doesNotMatch(body, /entityId/, "readLatestV34OrderSubmitAuditRow must not filter on entityId — that's what lets a distinct-entityId backfill row be picked up as 'latest'");
  assert.match(body, /\.orderBy\(desc\(auditLogs\.createdAt\)\)/);
  assert.match(body, /\.limit\(1\)/);
});

test("cron consumption path (static): audit_logs.createdAt defaults to defaultNow() at the DB level (schema.ts) — the mechanism that makes every fresh INSERT sort as 'latest'", async () => {
  const source = await fs.readFile(path.join(REPO_ROOT, "packages/db/src/schema.ts"), "utf8");
  const signature = 'export const auditLogs = pgTable("audit_logs", {';
  const start = source.indexOf(signature);
  assert.ok(start >= 0, "auditLogs table definition not found in schema.ts");
  let depth = 0;
  let end = -1;
  for (let i = start + signature.length - 1; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  assert.ok(end >= 0, "unbalanced braces extracting auditLogs table definition");
  const body = source.slice(start, end + 1);
  assert.match(body, /createdAt:\s*timestamp\("created_at",[^)]*\)\.defaultNow\(\)/);
});
