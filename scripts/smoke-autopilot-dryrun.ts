/**
 * smoke-autopilot-dryrun.ts
 *
 * One-shot helper that runs the R15 ops sequence against a live API server:
 *   1. POST /api/v1/market-data/manual-quotes  (seed fresh prices for 2330 + 6488)
 *   2. POST /api/v1/strategy/runs              (create run with includeBlocked=true)
 *   3. POST /api/v1/strategy/runs/:id/execute  (dryRun=true, sizePct=10, sidePolicy=bullish_long)
 *   4. Print submitted / blocked / errors breakdown with blockedReason distribution
 *
 * Usage:
 *   pnpm smoke:autopilot:dryrun
 *   BASE_URL=http://127.0.0.1:3001 pnpm smoke:autopilot:dryrun
 *
 * Defaults to production API if BASE_URL is not set.
 * Always dryRun=true — never sends real orders.
 */

import process from "node:process";

const BASE_URL = process.env.BASE_URL ?? "https://api-production-8f08.up.railway.app";
const WORKSPACE_SLUG = process.env.WORKSPACE_SLUG ?? "primary-desk";

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

async function main() {
  console.log(c.bold("\n=== Autopilot dryRun Ops Sequence (R15 one-shot) ==="));
  console.log(c.dim(`  base: ${BASE_URL}`));
  console.log(c.dim(`  workspace: ${WORKSPACE_SLUG}`));
  console.log(c.dim("  dryRun: true (no orders submitted)\n"));

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

  // ─── Step 3: execute dryRun ────────────────────────────────────────────────
  console.log(c.cyan("\n[ Step 3 ] POST /api/v1/strategy/runs/:id/execute  dryRun=true sizePct=10 sidePolicy=bullish_long"));
  const t3 = Date.now();
  const execRes = await apiPost<{
    data: {
      runId: string;
      dryRun: boolean;
      executedAt: string;
      submitted: Array<{ symbol: string; side: string; quantity: number; price: number | null; blockedReason: string | null }>;
      blocked: Array<{ symbol: string; side: string; quantity: number; price: number | null; blockedReason: string | null }>;
      errors: Array<{ symbol: string; message: string }>;
      summary: { total: number; submittedCount: number; blockedCount: number; errorCount: number };
    };
  }>(
    `/api/v1/strategy/runs/${runId}/execute`,
    {
      accountId: "paper-default",
      sidePolicy: "bullish_long",
      sizeMode: "fixed_pct",
      sizePct: 10,
      maxOrders: 5,
      dryRun: true
    }
  );
  const exec = execRes.data;
  const elapsedStep3 = Date.now() - t3;
  console.log(c.green("  PASS") + c.dim(` (${elapsedStep3}ms)`));

  // ─── Step 4: print breakdown ───────────────────────────────────────────────
  console.log(c.bold("\n[ Result Breakdown ]"));
  const s = exec.summary;
  console.log(`  total=${s.total}  submitted=${c.green(String(s.submittedCount))}  blocked=${s.blockedCount > 0 ? c.yellow(String(s.blockedCount)) : "0"}  errors=${s.errorCount > 0 ? c.red(String(s.errorCount)) : "0"}`);

  if (exec.submitted.length > 0) {
    console.log(c.bold("\n  Submitted:"));
    for (const o of exec.submitted) {
      console.log(`    ${c.green(o.symbol)}  side=${o.side}  qty=${o.quantity}  price=${o.price ?? "null"}`);
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
    console.log(c.green("  Gate CLEARED — submitted > 0 (dryRun). Ready for real execution gate."));
  } else if (exec.blocked.some((b) => b.blockedReason === "trading_hours")) {
    console.log(c.yellow("  trading_hours gate — run during Taiwan trading hours (Mon-Fri 09:00-13:30 TST)."));
  } else if (exec.blocked.some((b) => b.blockedReason === "no_price")) {
    console.log(c.red("  no_price gate — manual-quotes may have expired. Re-run within 60s of quote seed."));
  } else if (exec.blocked.some((b) => b.blockedReason === "kill_switch")) {
    console.log(c.red("  kill_switch engaged — check risk/kill-switch endpoint."));
  } else if (s.total === 0) {
    console.log(c.yellow("  No qualifying ideas — check signal seeds and sidePolicy."));
  } else {
    console.log(c.dim("  See breakdown above for details."));
  }
  console.log("");
}

main().catch((err) => {
  console.error(c.red("\n[FATAL]"), err instanceof Error ? err.message : String(err));
  process.exit(1);
});
