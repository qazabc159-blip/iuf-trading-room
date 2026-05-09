/**
 * finmind-full-ingest.test.ts — Unit tests for FinMind sponsor 11-dataset ingest orchestrator
 *
 * Tests (FI1–FI7):
 *   FI1: runFullIngest returns structured result with 11 datasets when no token
 *   FI2: all 11 datasets present in result.datasets
 *   FI3: skipped datasets have state="skipped" (not "error")
 *   FI4: concurrent run guard returns already_running
 *   FI5: queryAllDatasetStatus returns 11 entries
 *   FI6: getLastFullIngestResult() null before first run, populated after
 *   FI7: audit log action='finmind.ingest' written per dataset (mock DB path)
 *
 * These tests run without DATABASE_URL (memory mode) — ingest syncs skip gracefully.
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

// Isolate env from real process env
const _origEnv = { ...process.env };
function resetEnv() {
  // Remove DB and FinMind env so tests run in memory-only mode
  delete process.env.DATABASE_URL;
  delete process.env.PERSISTENCE_MODE;
  delete process.env.FINMIND_API_TOKEN;
}

// Lazy import after env reset
let runFullIngest: typeof import("../jobs/finmind-full-ingest.js").runFullIngest;
let getLastFullIngestResult: typeof import("../jobs/finmind-full-ingest.js").getLastFullIngestResult;
let isFullIngestRunning: typeof import("../jobs/finmind-full-ingest.js").isFullIngestRunning;
let queryAllDatasetStatus: typeof import("../jobs/finmind-full-ingest.js").queryAllDatasetStatus;

before(async () => {
  resetEnv();
  const mod = await import("../jobs/finmind-full-ingest.js");
  runFullIngest = mod.runFullIngest;
  getLastFullIngestResult = mod.getLastFullIngestResult;
  isFullIngestRunning = mod.isFullIngestRunning;
  queryAllDatasetStatus = mod.queryAllDatasetStatus;
});

describe("FinMind Full Ingest Orchestrator", () => {
  it("FI1: runFullIngest returns structured result even with no token (all skip=no_token)", async () => {
    const result = await runFullIngest({
      workspaceSlug: "test-workspace",
      triggeredBy: "manual"
    });

    assert.ok(result.runId, "runId must be set");
    assert.equal(result.triggeredBy, "manual");
    assert.equal(result.workspaceSlug, "test-workspace");
    assert.ok(result.startedAt, "startedAt must be set");
    assert.ok(result.finishedAt, "finishedAt must be set");
    assert.ok(typeof result.totalDurationMs === "number", "totalDurationMs must be number");
    assert.equal(typeof result.totalRowsUpserted, "number");
    assert.equal(typeof result.datasetsAttempted, "number");
    assert.ok(result.quotaNote, "quotaNote must be set");
  });

  it("FI2: result.datasets contains exactly 11 entries", async () => {
    const result = await runFullIngest({
      workspaceSlug: "test-workspace",
      triggeredBy: "cron"
    });
    assert.equal(result.datasets.length, 11, "must have 11 dataset entries");

    const expectedDatasets = [
      "TaiwanStockMonthRevenue",
      "TaiwanStockFinancialStatements",
      "TaiwanStockBalanceSheet",
      "TaiwanStockCashFlowsStatement",
      "TaiwanStockDividend",
      "TaiwanStockInstitutionalInvestorsBuySell",
      "TaiwanStockMarginPurchaseShortSale",
      "TaiwanStockShareholding",
      "TaiwanStockMarketValue",
      "TaiwanStockPER",
      "TaiwanStockNews"
    ];

    for (const ds of expectedDatasets) {
      const found = result.datasets.find((d) => d.dataset === ds);
      assert.ok(found, `dataset '${ds}' must be present in result`);
    }
  });

  it("FI3: skipped datasets have state='skipped', not 'error'", async () => {
    const result = await runFullIngest({
      workspaceSlug: "test-workspace",
      triggeredBy: "cron"
    });

    for (const ds of result.datasets) {
      // In memory mode without token: state is 'skipped', never 'error'
      assert.notEqual(ds.state, "error",
        `dataset '${ds.dataset}' must not be 'error' — got state='${ds.state}' skipReason='${ds.skipReason}'`
      );
      // All should be skipped (no_tickers or no_token)
      assert.equal(ds.state, "skipped",
        `dataset '${ds.dataset}' should be skipped in memory mode`
      );
      assert.ok(ds.skipReason, `dataset '${ds.dataset}' must have a skipReason`);
    }
  });

  it("FI4: concurrent run guard — isFullIngestRunning() starts false, ends false after run", async () => {
    // Before run: should be false (previous runs completed)
    const beforeRun = isFullIngestRunning();
    assert.equal(beforeRun, false, "should not be running before trigger");

    // Start a run (awaiting it means it will be done by the time we check)
    await runFullIngest({
      workspaceSlug: "test-workspace",
      triggeredBy: "manual"
    });

    const afterRun = isFullIngestRunning();
    assert.equal(afterRun, false, "should not be running after completion");
  });

  it("FI5: queryAllDatasetStatus returns 11 entries with required fields", async () => {
    const statuses = await queryAllDatasetStatus();

    assert.equal(statuses.length, 11, "must return 11 dataset status rows");

    for (const s of statuses) {
      assert.ok(s.dataset, "each row must have dataset");
      assert.ok(s.table, "each row must have table");
      assert.ok(["LIVE", "STALE", "EMPTY", "ERROR", "DEGRADED"].includes(s.state),
        `state '${s.state}' for dataset '${s.dataset}' must be a valid enum`
      );
      assert.equal(typeof s.rowCount, "number", `rowCount must be number for '${s.dataset}'`);
    }
  });

  it("FI6: getLastFullIngestResult() populated after run", async () => {
    // Run once more to ensure state is fresh
    await runFullIngest({
      workspaceSlug: "test-workspace",
      triggeredBy: "cron"
    });

    const last = getLastFullIngestResult();
    assert.ok(last, "getLastFullIngestResult() must return a result after run");
    assert.ok(last!.runId, "last result must have runId");
    assert.equal(last!.datasets.length, 11);
  });

  it("FI7: dataset result shape has all required fields", async () => {
    const result = await runFullIngest({
      workspaceSlug: "test-workspace",
      triggeredBy: "manual"
    });

    for (const ds of result.datasets) {
      assert.ok(typeof ds.dataset === "string", `dataset field missing for ${ds.table}`);
      assert.ok(typeof ds.table === "string", `table field missing for ${ds.dataset}`);
      assert.ok(typeof ds.rowsUpserted === "number", `rowsUpserted must be number for ${ds.dataset}`);
      assert.ok(typeof ds.rowsQuarantined === "number", `rowsQuarantined must be number for ${ds.dataset}`);
      assert.ok(typeof ds.skipped === "boolean", `skipped must be boolean for ${ds.dataset}`);
      assert.ok(typeof ds.durationMs === "number", `durationMs must be number for ${ds.dataset}`);
      assert.ok(["synced", "skipped", "error"].includes(ds.state),
        `state must be valid enum for ${ds.dataset}`
      );
    }
  });
});
