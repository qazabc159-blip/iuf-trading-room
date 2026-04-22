/**
 * smoke-autopilot-dryrun.ts
 *
 * One-shot helper that runs the R15 ops sequence against a live API server:
 *   1. POST /api/v1/market-data/manual-quotes  (seed fresh prices for 2330 + 6488)
 *   2. POST /api/v1/strategy/runs              (create run with includeBlocked=true)
 *   2.5 POST /api/v1/risk/limits               (override paper account maxPerTradePct so TWSE
 *                                               lot-size orders pass the risk guard)
 *   3. POST /api/v1/strategy/runs/:id/execute  (dryRun=true, sizePct=SMOKE_SIZE_PCT, sidePolicy=bullish_long)
 *   4. Print submitted / blocked / errors breakdown with blockedReason distribution
 *
 * Usage:
 *   pnpm smoke:autopilot:dryrun
 *   BASE_URL=http://127.0.0.1:3001 pnpm smoke:autopilot:dryrun
 *   SMOKE_SIZE_PCT=10 SMOKE_MAX_PER_TRADE_PCT=10 pnpm smoke:autopilot:dryrun
 *
 * Defaults to production API if BASE_URL is not set.
 * Always dryRun=true — never sends real orders.
 *
 * --- Why SMOKE_SIZE_PCT default is 10 (not 1) ---
 * TWSE/TPEX trades in lots of 1000 shares.  With equity=10,000,000 TWD:
 *   sizePct=1  → budget=100,000 → floor(100k/875/1000)*1000 = 0 shares (quantity_zero)
 *   sizePct=10 → budget=1,000,000 → floor(1M/875/1000)*1000 = 1,000 shares (1 lot)
 * Lowering sizePct below ~9% produces qty=0 for 2330@875 — a quantity_zero block,
 * which is *worse* than max_per_trade.  sizePct=10 is the minimum that yields ≥1 lot.
 *
 * --- Why SMOKE_MAX_PER_TRADE_PCT default is 10 ---
 * DEFAULT risk maxPerTradePct = 1%.  One lot of 2330@875 = 875k/10M = 8.75% > 1%.
 * This smoke helper overrides *only the paper-default account* risk limit to 10%
 * so the dryRun path can reach submitted>0.  Production real-money accounts are
 * governed by their own (separately persisted) risk limit records and are unaffected.
 */

import process from "node:process";

const BASE_URL = process.env.BASE_URL ?? "https://api-production-8f08.up.railway.app";
const WORKSPACE_SLUG = process.env.WORKSPACE_SLUG ?? "primary-desk";

// Sizing: default 10 is the minimum sizePct that yields ≥1 TWSE lot at 2330@875
// with equity=10M.  Lowering to 1 would produce qty=0 (quantity_zero blocked).
const SMOKE_SIZE_PCT = Number(process.env.SMOKE_SIZE_PCT ?? "10");
// Risk override: sets paper-default account maxPerTradePct before execute so that
// TWSE lot-size orders (8-9% of equity) pass the max_per_trade guard.
const SMOKE_MAX_PER_TRADE_PCT = Number(process.env.SMOKE_MAX_PER_TRADE_PCT ?? "10");
const SMOKE_ACCOUNT_ID = process.env.SMOKE_ACCOUNT_ID ?? "paper-default";

const noColor = !process.stdout.isTTY || process.env.NO_COLOR !== undefined;
const c = {
  green: (s: string) => noColor ? s : `\x1b[32m${s}\x1b[0m`,
  red:   (s: string) => noColor ? s : `\x1b[31m${s}\x1b[0m`,
  yellow:(s: string) => noColor ? s : `\x1b[33m${s}\x1b[0m`,
  cyan:  (s: string) => noColor ? s : `\x1b[36m${s}\x1b[0m`,
  bold:  (s: string) => noColor ? s : `\x1b[1m${s}\x1b[0m`,
  dim:   (s: string) => noColor ? s : `\x1b[2m${s}\x1b[0m`
};

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-workspace-slug": WORKSPACE_SLUG
    },
    body: JSON.stringify(body)
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`POST ${path} → HTTP ${res.status}: ${text}`);
  }
  return JSON.parse(text) as T;
}

async function fetchCurrentMaxPerTradePct(accountId: string): Promise<number> {
  const url = `${BASE_URL}/api/v1/risk/limits?accountId=${encodeURIComponent(accountId)}`;
  const res = await fetch(url, {
    headers: { "x-workspace-slug": WORKSPACE_SLUG }
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GET /api/v1/risk/limits → HTTP ${res.status}: ${text}`);
  }
  const json = JSON.parse(text) as { data: { maxPerTradePct: number } };
  return json.data.maxPerTradePct;
}

async function restoreMaxPerTradePct(accountId: string, value: number): Promise<void> {
  await apiPost("/api/v1/risk/limits", {
    accountId,
    maxPerTradePct: value
  });
}

async function main() {
  console.log(c.bold("\n=== Autopilot dryRun Ops Sequence (R16.5 hotfix) ==="));
  console.log(c.dim(`  base:              ${BASE_URL}`));
  console.log(c.dim(`  workspace:         ${WORKSPACE_SLUG}`));
  console.log(c.dim(`  accountId:         ${SMOKE_ACCOUNT_ID}`));
  console.log(c.dim(`  sizePct:           ${SMOKE_SIZE_PCT}%  (env SMOKE_SIZE_PCT)`));
  console.log(c.dim(`  maxPerTradePct:    ${SMOKE_MAX_PER_TRADE_PCT}%  (env SMOKE_MAX_PER_TRADE_PCT — paper account override)`));
  console.log(c.dim("  dryRun:            true (no orders submitted)\n"));

  // ─── Step 1: seed fresh manual quotes ─────────────────────────────────────
  console.log(c.cyan("[ Step 1 ] POST /api/v1/market-data/manual-quotes"));
  const t1 = Date.now();
  await apiPost("/api/v1/market-data/manual-quotes", {
    quotes: [
      {
        symbol: "2330",
        market: "TWSE",
        source: "manual",
        last: 875,
        bid: 874,
        ask: 876,
        open: 870,
        high: 880,
        low: 865,
        prevClose: 870,
        volume: 10000,
        changePct: 0.57,
        timestamp: new Date().toISOString()
      },
      {
        symbol: "6488",
        market: "TPEX",
        source: "manual",
        last: 410,
        bid: 409,
        ask: 411,
        open: 405,
        high: 415,
        low: 400,
        prevClose: 405,
        volume: 5000,
        changePct: 1.23,
        timestamp: new Date().toISOString()
      }
    ]
  });
  console.log(c.green("  PASS") + c.dim(` seeded 2330=875, 6488=410 (${Date.now() - t1}ms)`));

  // ─── Step 2: create strategy run ──────────────────────────────────────────
  console.log(c.cyan("\n[ Step 2 ] POST /api/v1/strategy/runs"));
  const t2 = Date.now();
  const runRes = await apiPost<{ data: { id: string; summary: { total: number; bullish: number; neutral: number; bearish: number } } }>(
    "/api/v1/strategy/runs",
    {
      limit: 50,
      signalDays: 30,
      includeBlocked: true,
      decisionMode: "strategy",
      sort: "score"
    }
  );
  const runId = runRes.data.id;
  const runSummary = runRes.data.summary;
  console.log(c.green("  PASS") + c.dim(` runId=${runId.slice(0, 8)}...  total=${runSummary.total}  bullish=${runSummary.bullish}  neutral=${runSummary.neutral}  bearish=${runSummary.bearish}  (${Date.now() - t2}ms)`));

  // ─── Step 2.4: GET original maxPerTradePct (backup before override) ───────
  console.log(c.cyan(`\n[ Step 2.4 ] GET /api/v1/risk/limits  accountId=${SMOKE_ACCOUNT_ID}  (backup before override)`));
  const t24 = Date.now();
  const originalMaxPerTrade = await fetchCurrentMaxPerTradePct(SMOKE_ACCOUNT_ID);
  console.log(c.green("  PASS") + c.dim(` originalMaxPerTradePct=${originalMaxPerTrade}% captured (${Date.now() - t24}ms)`));

  // ─── Steps 2.5 + 3 wrapped in try/finally for guaranteed rollback ─────────
  // This ensures that even if execute throws, even if process.exit fires inside
  // a catch, the finally block always restores maxPerTradePct to its original value.
  try {
    // ─── Step 2.5: override paper account risk limit so TWSE lots pass max_per_trade ──
    // DEFAULT maxPerTradePct=1%. One TWSE lot of 2330@875 = 8.75% of 10M equity,
    // which exceeds 1% and gets blocked.  We set the paper-default account limit to
    // SMOKE_MAX_PER_TRADE_PCT (default 10%) so dryRun can reach submitted>0.
    // Real-money accounts have separate persisted risk records and are unaffected.
    console.log(c.cyan(`\n[ Step 2.5 ] POST /api/v1/risk/limits  accountId=${SMOKE_ACCOUNT_ID}  maxPerTradePct=${SMOKE_MAX_PER_TRADE_PCT}%`));
    const t25 = Date.now();
    await apiPost("/api/v1/risk/limits", {
      accountId: SMOKE_ACCOUNT_ID,
      maxPerTradePct: SMOKE_MAX_PER_TRADE_PCT
    });
    console.log(c.green("  PASS") + c.dim(` paper account maxPerTradePct=${SMOKE_MAX_PER_TRADE_PCT}% set (${Date.now() - t25}ms)`));

    // ─── Step 3: execute dryRun ──────────────────────────────────────────────
    console.log(c.cyan(`\n[ Step 3 ] POST /api/v1/strategy/runs/:id/execute  dryRun=true sizePct=${SMOKE_SIZE_PCT} sidePolicy=bullish_long`));
    const t3 = Date.now();
    const execRes = await apiPost<{
      data: {
        runId: string;
        dryRun: boolean;
        executedAt: string;
        submitted: Array<{ symbol: string; side: string; quantity: number; price: number | null; blockedReason: string | null; requiresReview?: boolean; reviewReason?: string }>;
        blocked: Array<{ symbol: string; side: string; quantity: number; price: number | null; blockedReason: string | null }>;
        errors: Array<{ symbol: string; message: string }>;
        summary: { total: number; submittedCount: number; blockedCount: number; errorCount: number };
      };
    }>(
      `/api/v1/strategy/runs/${runId}/execute`,
      {
        accountId: SMOKE_ACCOUNT_ID,
        sidePolicy: "bullish_long",
        sizeMode: "fixed_pct",
        sizePct: SMOKE_SIZE_PCT,
        maxOrders: 5,
        dryRun: true
      }
    );
    const exec = execRes.data;
    const elapsedStep3 = Date.now() - t3;
    console.log(c.green("  PASS") + c.dim(` (${elapsedStep3}ms)`));

    // ─── Step 4: print breakdown ─────────────────────────────────────────────
    console.log(c.bold("\n[ Result Breakdown ]"));
    const s = exec.summary;
    console.log(`  total=${s.total}  submitted=${c.green(String(s.submittedCount))}  blocked=${s.blockedCount > 0 ? c.yellow(String(s.blockedCount)) : "0"}  errors=${s.errorCount > 0 ? c.red(String(s.errorCount)) : "0"}`);

    if (exec.submitted.length > 0) {
      const advisoryCount = exec.submitted.filter((o) => o.requiresReview).length;
      console.log(c.bold("\n  Submitted:") + (advisoryCount > 0 ? c.yellow(` (${advisoryCount} advisory requiresReview)`) : ""));
      for (const o of exec.submitted) {
        const advisoryHint = o.requiresReview ? c.yellow(" [requiresReview]") : "";
        console.log(`    ${c.green(o.symbol)}  side=${o.side}  qty=${o.quantity}  price=${o.price ?? "null"}${advisoryHint}`);
      }
    }

    if (exec.blocked.length > 0) {
      // Tally blockedReason distribution
      const reasonCounts = new Map<string, number>();
      for (const b of exec.blocked) {
        const r = b.blockedReason ?? "unknown";
        reasonCounts.set(r, (reasonCounts.get(r) ?? 0) + 1);
      }

      console.log(c.bold("\n  Blocked:"));
      for (const b of exec.blocked) {
        console.log(`    ${c.yellow(b.symbol)}  reason=${c.yellow(b.blockedReason ?? "unknown")}  qty=${b.quantity}  price=${b.price ?? "null"}`);
      }

      console.log(c.bold("\n  blockedReason distribution:"));
      for (const [reason, count] of [...reasonCounts.entries()].sort()) {
        console.log(`    ${c.yellow(reason)}: ${count}`);
      }
    }

    if (exec.errors.length > 0) {
      console.log(c.bold("\n  Errors:"));
      for (const e of exec.errors) {
        console.log(`    ${c.red(e.symbol)}: ${e.message}`);
      }
    }

    // Final assessment
    console.log("");
    if (s.submittedCount > 0) {
      const advisorySubmits = exec.submitted.filter((o) => o.requiresReview);
      if (advisorySubmits.length > 0) {
        console.log(c.green("  Gate CLEARED — submitted > 0 (dryRun).") + c.yellow(` ${advisorySubmits.length} advisory (requiresReview=true; quoteGate=review_required soft-pass).`));
        console.log(c.dim("  Advisory items passed dryRun but would be hard-blocked on real submit without quote override."));
      } else {
        console.log(c.green("  Gate CLEARED — submitted > 0 (dryRun). Ready for real execution gate."));
      }
    } else if (exec.blocked.some((b) => b.blockedReason === "trading_hours")) {
      console.log(c.yellow("  trading_hours gate — run during Taiwan trading hours (Mon-Fri 09:00-13:30 TST)."));
    } else if (exec.blocked.some((b) => b.blockedReason === "no_price")) {
      console.log(c.red("  no_price gate — manual-quotes may have expired. Re-run within 60s of quote seed."));
    } else if (exec.blocked.some((b) => b.blockedReason === "kill_switch")) {
      console.log(c.red("  kill_switch engaged — check risk/kill-switch endpoint."));
    } else if (exec.blocked.some((b) => b.blockedReason === "max_per_trade")) {
      console.log(c.red("  max_per_trade gate — TWSE lot-size too large for maxPerTradePct limit."));
      console.log(c.dim(`  Tip: set SMOKE_MAX_PER_TRADE_PCT env var (current=${SMOKE_MAX_PER_TRADE_PCT}) or raise equity.`));
    } else if (exec.blocked.some((b) => b.blockedReason === "quantity_zero")) {
      console.log(c.red("  quantity_zero gate — sizePct too small to buy 1 TWSE lot."));
      console.log(c.dim(`  Tip: set SMOKE_SIZE_PCT env var (current=${SMOKE_SIZE_PCT}). Min ~9% for 2330@875 with equity=10M.`));
    } else if (s.total === 0) {
      console.log(c.yellow("  No qualifying ideas — check signal seeds and sidePolicy."));
    } else {
      console.log(c.dim("  See breakdown above for details."));
    }
    console.log("");
  } finally {
    // ─── Rollback: restore original maxPerTradePct unconditionally ──────────
    // Fires on success, exception, and any error path.
    // If rollback itself fails, we log + exit non-zero so the caller knows.
    try {
      await restoreMaxPerTradePct(SMOKE_ACCOUNT_ID, originalMaxPerTrade);
      console.log(c.dim(`[smoke] rolled back maxPerTradePct to ${originalMaxPerTrade}% (accountId=${SMOKE_ACCOUNT_ID})`));
    } catch (rollbackErr) {
      console.error(c.red(`[smoke] ROLLBACK FAILED — maxPerTradePct may still be ${SMOKE_MAX_PER_TRADE_PCT}% on accountId=${SMOKE_ACCOUNT_ID}`));
      console.error(c.red(`[smoke] Manual fix required: POST /api/v1/risk/limits { accountId: "${SMOKE_ACCOUNT_ID}", maxPerTradePct: ${originalMaxPerTrade} }`));
      console.error(rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr));
      process.exit(2);
    }
  }
}

main().catch((err) => {
  console.error(c.red("\n[FATAL]"), err instanceof Error ? err.message : String(err));
  process.exit(1);
});
