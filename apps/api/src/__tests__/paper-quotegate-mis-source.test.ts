/**
 * paper-quotegate-mis-source.test.ts — 2026-07-13 P1 fix
 *
 * Root cause (Bruce 2026-07-13 intraday verification): the TWSE MIS
 * intraday cron/sweep injected genuine official real-time quotes into the
 * "manual" bucket, tagging them source="manual" — indistinguishable from a
 * genuinely hand-typed Admin value. isSyntheticSource() therefore always
 * flagged them synthetic, and buildConsumerDecision()'s paper-mode branch
 * could never get past decision="review" — which paper submits have no way
 * to pass (no `quote_review` override path exists for paper orders) —
 * blocking every paper order whenever the KGI feed was down (KGI has been
 * down company-wide since ~6/2).
 *
 * Fix: MIS-injected quotes are now tagged source="twse_mis" (new QuoteSource
 * enum value, additive). isSyntheticSource() correctly excludes it (it is
 * real official data, not synthetic) and the paper-mode consumer decision
 * treats a fresh twse_mis quote as trustworthy enough to auto-allow.
 *
 * Coverage:
 *   T01: paper mode + twse_mis source + fresh quote -> decision "allow"
 *   T02: paper mode + manual source (genuinely hand-typed) + fresh quote
 *        -> decision "review" (REGRESSION LOCK: still blocked, unrelaxed)
 *   T03: execution (real-money) mode + twse_mis source -> decision stays
 *        "review", never "allow" (REGRESSION LOCK: live channel unaffected)
 *   T04: end-to-end evaluateExecutionGate({mode:"paper"}) with twse_mis
 *        source -> blocked=false (the actual gate paper-risk-bridge.ts calls)
 *   T05: end-to-end evaluateExecutionGate({mode:"paper"}) with manual source
 *        -> blocked=true, decision="review_required" (REGRESSION LOCK)
 *
 * Run: node --import tsx --test apps/api/src/__tests__/paper-quotegate-mis-source.test.ts
 */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  getMarketDataConsumerSummary,
  ingestTradingViewQuote,
  resetMarketDataWorkspaceState,
  upsertManualQuotes,
  upsertTwseMisQuotes
} from "../market-data.js";
import { evaluateExecutionGate } from "../broker/execution-gate.js";
import { buildPaperOrderContext } from "../domain/trading/paper-risk-bridge.js";

function makeSession(slug: string) {
  return {
    workspace: { id: `workspace-${slug}`, name: slug, slug },
    user: { id: `user-${slug}`, name: "Test User", email: "test@example.com", role: "Owner" },
    persistenceMode: "memory"
  } as any;
}

async function withTempStore(run: () => Promise<void>) {
  const originalStoreDir = process.env.MARKET_DATA_STORE_DIR;
  const storeDir = await mkdtemp(path.join(tmpdir(), "iuf-paper-quotegate-mis-"));
  process.env.MARKET_DATA_STORE_DIR = storeDir;
  try {
    await run();
  } finally {
    if (originalStoreDir === undefined) delete process.env.MARKET_DATA_STORE_DIR;
    else process.env.MARKET_DATA_STORE_DIR = originalStoreDir;
    await rm(storeDir, { recursive: true, force: true });
  }
}

function freshQuoteItem(symbol: string, source: "manual" | "twse_mis" = "manual") {
  return {
    symbol,
    market: "TWSE" as const,
    source,
    last: 100,
    bid: 99.5,
    ask: 100.5,
    open: 100,
    high: 101,
    low: 99,
    prevClose: 99,
    volume: 1000,
    changePct: 1.01,
    timestamp: new Date().toISOString()
  };
}

// ---------------------------------------------------------------------------
// T01 + T02: paper-mode consumer decision
// ---------------------------------------------------------------------------

test("T01: paper mode allows a fresh twse_mis-sourced quote (no KGI/tradingview needed)", async () => {
  await withTempStore(async () => {
    const slug = `paper-quotegate-mis-${Date.now()}`;
    const session = makeSession(slug);
    resetMarketDataWorkspaceState(slug);

    await upsertTwseMisQuotes({ session, quotes: [freshQuoteItem("2330")] });

    const summary = await getMarketDataConsumerSummary({
      session,
      mode: "paper",
      symbols: "2330"
    });

    const item = summary.items.find((entry) => entry.symbol === "2330");
    assert.ok(item, "2330 must be present in paper consumer summary");
    assert.equal(item!.selectedSource, "twse_mis");
    assert.equal(item!.decision, "allow", "twse_mis fresh quote must allow paper orders");
    assert.equal(item!.usable, true);

    resetMarketDataWorkspaceState(slug);
  });
});

test("T02: paper mode still requires review for a genuinely hand-typed manual quote (regression lock)", async () => {
  await withTempStore(async () => {
    const slug = `paper-quotegate-manual-${Date.now()}`;
    const session = makeSession(slug);
    resetMarketDataWorkspaceState(slug);

    await upsertManualQuotes({ session, quotes: [freshQuoteItem("2454")] });

    const summary = await getMarketDataConsumerSummary({
      session,
      mode: "paper",
      symbols: "2454"
    });

    const item = summary.items.find((entry) => entry.symbol === "2454");
    assert.ok(item, "2454 must be present in paper consumer summary");
    assert.equal(item!.selectedSource, "manual");
    assert.equal(
      item!.decision,
      "review",
      "a truly synthetic/hand-typed manual quote must NOT be auto-allowed for paper — the fix must not relax this"
    );

    resetMarketDataWorkspaceState(slug);
  });
});

// ---------------------------------------------------------------------------
// T03: execution (real-money) mode must be unaffected
// ---------------------------------------------------------------------------

test("T03: execution mode never allows on a twse_mis source — real-money channel unaffected", async () => {
  await withTempStore(async () => {
    const slug = `execution-quotegate-mis-${Date.now()}`;
    const session = makeSession(slug);
    resetMarketDataWorkspaceState(slug);

    await upsertTwseMisQuotes({ session, quotes: [freshQuoteItem("2317")] });

    const summary = await getMarketDataConsumerSummary({
      session,
      mode: "execution",
      symbols: "2317"
    });

    const item = summary.items.find((entry) => entry.symbol === "2317");
    assert.ok(item, "2317 must be present in execution consumer summary");
    assert.equal(item!.selectedSource, "twse_mis");
    assert.notEqual(
      item!.decision,
      "allow",
      "execution/live-money mode must never auto-allow a non-kgi source, twse_mis included"
    );
    assert.equal(item!.decision, "review", "unchanged from pre-fix manual-tagged behavior");

    resetMarketDataWorkspaceState(slug);
  });
});

// ---------------------------------------------------------------------------
// T04 + T05: end-to-end evaluateExecutionGate (the actual function
// paper-risk-bridge.ts::evaluatePaperOrderRisk calls before an order is
// accepted).
// ---------------------------------------------------------------------------

test("T04: evaluateExecutionGate mode=paper is not blocked on a twse_mis-sourced quote", async () => {
  await withTempStore(async () => {
    const slug = `gate-e2e-mis-${Date.now()}`;
    const session = makeSession(slug);
    resetMarketDataWorkspaceState(slug);

    await upsertTwseMisQuotes({ session, quotes: [freshQuoteItem("2330")] });

    const order = buildPaperOrderContext({
      idempotencyKey: "idem-t04",
      symbol: "2330",
      side: "buy",
      orderType: "limit",
      qty: 1,
      quantity_unit: "SHARE",
      price: 100
    });

    const gate = await evaluateExecutionGate({ session, order, mode: "paper" });

    assert.equal(gate.blocked, false, "paper submit must not be blocked when the only source is twse_mis");
    assert.equal(gate.decision, "allow");
    assert.equal(gate.selectedSource, "twse_mis");

    resetMarketDataWorkspaceState(slug);
  });
});

test("T05: evaluateExecutionGate mode=paper still blocks on a hand-typed manual quote (regression lock)", async () => {
  await withTempStore(async () => {
    const slug = `gate-e2e-manual-${Date.now()}`;
    const session = makeSession(slug);
    resetMarketDataWorkspaceState(slug);

    await upsertManualQuotes({ session, quotes: [freshQuoteItem("2454")] });

    const order = buildPaperOrderContext({
      idempotencyKey: "idem-t05",
      symbol: "2454",
      side: "buy",
      orderType: "limit",
      qty: 1,
      quantity_unit: "SHARE",
      price: 100
    });

    const gate = await evaluateExecutionGate({ session, order, mode: "paper" });

    assert.equal(gate.blocked, true, "a genuinely synthetic manual quote must still block paper submits");
    assert.equal(gate.decision, "review_required");

    resetMarketDataWorkspaceState(slug);
  });
});

// ---------------------------------------------------------------------------
// T06-T08: provenance lock on upsertManualQuotes (Pete #1246 review, Finding
// #1). The admin manual-quotes endpoint feeds caller-controlled `source`
// values through upsertManualQuotes; the forced sourceOverride:"manual" must
// hold no matter what the item claims.
// ---------------------------------------------------------------------------

test("T06: upsertManualQuotes cannot spoof source=twse_mis — lands as manual, paper stays review", async () => {
  await withTempStore(async () => {
    const slug = `manual-spoof-mis-${Date.now()}`;
    const session = makeSession(slug);
    resetMarketDataWorkspaceState(slug);

    await upsertManualQuotes({ session, quotes: [freshQuoteItem("2330", "twse_mis")] });

    const summary = await getMarketDataConsumerSummary({
      session,
      mode: "paper",
      symbols: "2330"
    });

    const item = summary.items.find((entry) => entry.symbol === "2330");
    assert.ok(item, "2330 must be present in paper consumer summary");
    assert.equal(
      item!.selectedSource,
      "manual",
      "an admin-entered quote claiming source=twse_mis must be stored as manual"
    );
    assert.equal(item!.decision, "review", "the spoofed quote must not auto-allow paper orders");

    resetMarketDataWorkspaceState(slug);
  });
});

test("T07: upsertManualQuotes cannot spoof source=kgi — lands as manual, never feeds liveUsable", async () => {
  await withTempStore(async () => {
    const slug = `manual-spoof-kgi-${Date.now()}`;
    const session = makeSession(slug);
    resetMarketDataWorkspaceState(slug);

    await upsertManualQuotes({
      session,
      quotes: [{ ...freshQuoteItem("2317"), source: "kgi" } as any]
    });

    const summary = await getMarketDataConsumerSummary({
      session,
      mode: "execution",
      symbols: "2317"
    });

    const item = summary.items.find((entry) => entry.symbol === "2317");
    assert.ok(item, "2317 must be present in execution consumer summary");
    assert.equal(
      item!.selectedSource,
      "manual",
      "an admin-entered quote claiming source=kgi must be stored as manual (pre-existing spoof gap)"
    );
    assert.notEqual(item!.decision, "allow", "the spoofed quote must never allow execution mode");

    resetMarketDataWorkspaceState(slug);
  });
});

test("T08: TradingView webhook ingest still lands in the tradingview bucket", async () => {
  await withTempStore(async () => {
    const slug = `tv-ingest-bucket-${Date.now()}`;
    const session = makeSession(slug);
    resetMarketDataWorkspaceState(slug);

    const quote = await ingestTradingViewQuote({
      session,
      ticker: "2454",
      exchange: "TWSE",
      price: "1234.5",
      timestamp: new Date().toISOString()
    });

    assert.ok(quote, "webhook ingest must return the upserted quote");
    assert.equal(
      quote!.source,
      "tradingview",
      "ingestTradingViewQuote must keep writing to the tradingview bucket after the manual override lock"
    );

    resetMarketDataWorkspaceState(slug);
  });
});
