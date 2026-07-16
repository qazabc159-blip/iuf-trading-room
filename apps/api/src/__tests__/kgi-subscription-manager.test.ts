/**
 * kgi-subscription-manager.test.ts
 *
 * Test suite for KGI 40-slot quota manager.
 *
 * QM1: Hard cap — subscribe 41st symbol → quota_exceeded (429 equivalent)
 * QM2: Connection distribution — 2 connections × 20 slots
 * QM3: Permanent slots never swapped (INDEX, STRATEGY, CORE)
 * QM4: LRU swap logic — BUFFER > WATCHLIST > HOLDINGS eviction order
 * QM5: Holdings sync — add/remove/budget enforcement
 * QM6: Watchlist sync — add/remove/budget enforcement
 * QM7: Unsubscribe permanent → rejected
 * QM8: Subscription status shape
 */

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

// ── Mock gateway fetch ─────────────────────────────────────────────────────────
// All tests run with network mocked — no real KGI gateway required.

const _originalFetch = globalThis.fetch;

/**
 * Stateful mock gateway. `online` toggles whether the gateway is reachable
 * at all (simulates "Railway booted before EC2 gateway's 08:20 start" and
 * "gateway process restarted mid-day"). `liveTickSymbols` simulates the
 * gateway's own /quote/status ground truth — subscribing adds to it,
 * restarting (via `resetMockGateway({ keepLive: false })`) wipes it,
 * independent of our local `_slots[].subscribed` bookkeeping, exactly like a
 * real gateway process restart wipes the KGI SDK's in-memory state.
 */
const mockGatewayState = {
  online: true,
  liveTickSymbols: new Set<string>(),
  subscribeCalls: [] as string[],
};

function resetMockGateway(opts: { online?: boolean } = {}): void {
  mockGatewayState.online = opts.online ?? true;
  mockGatewayState.liveTickSymbols = new Set<string>();
  mockGatewayState.subscribeCalls = [];
}

function installMockGateway(): void {
  globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
    const urlStr = String(typeof url === "string" ? url : url instanceof URL ? url.href : (url as Request).url);

    if (!mockGatewayState.online) {
      throw new Error("mock gateway offline (simulated network error)");
    }

    if (urlStr.includes("/quote/subscribe/tick")) {
      const body = init?.body ? (JSON.parse(String(init.body)) as { symbol?: string }) : {};
      if (body.symbol) {
        mockGatewayState.liveTickSymbols.add(body.symbol);
        mockGatewayState.subscribeCalls.push(body.symbol);
      }
      return new Response(JSON.stringify({ ok: true, label: "tick_mock" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (urlStr.includes("/quote/unsubscribe")) {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (urlStr.includes("/quote/status")) {
      return new Response(
        JSON.stringify({
          subscribed_symbols: { tick: Array.from(mockGatewayState.liveTickSymbols), bidask: [] },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (urlStr.includes("/quote/ticks")) {
      return new Response(
        JSON.stringify({
          ticks: [
            {
              close: 20000,
              price_chg: 50,
              pct_chg: 0.25,
              datetime: new Date().toISOString(),
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
    return new Response("not found", { status: 404 });
  };
}

function mockGatewayAlwaysOk(): void {
  installMockGateway();
}

function restoreFetch(): void {
  globalThis.fetch = _originalFetch;
}

// ── Import under test ──────────────────────────────────────────────────────────

import {
  MAX_SLOTS,
  CONN_SLOT_MAX,
  PERMANENT_SLOT_COUNT,
  DYNAMIC_SLOT_COUNT,
  TIER,
  INDEX_SYMBOLS,
  STRATEGY_SYMBOLS,
  CORE_SYMBOLS,
  HEATMAP_CORE_SYMBOLS,
  HOLDINGS_BUDGET,
  WATCHLIST_BUDGET,
  initSubscriptionManager,
  subscribeSymbol,
  unsubscribeSymbol,
  getSubscriptionStatus,
  syncHoldings,
  syncWatchlist,
  getKgiMarketOverview,
  getKgiCoreHeatmap,
  ensurePermanentSubscriptions,
  _resetSubscriptionManager,
} from "../kgi-subscription-manager.js";

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Generate n unique dummy symbols (beyond the permanent set) */
function dummySymbols(n: number, prefix = "T"): string[] {
  return Array.from({ length: n }, (_, i) => `${prefix}${9000 + i}`);
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("KGI Subscription Manager", () => {
  before(() => {
    mockGatewayAlwaysOk();
  });

  beforeEach(() => {
    resetMockGateway();
  });

  after(() => {
    restoreFetch();
    _resetSubscriptionManager();
  });

  // QM0: sanity constants
  it("QM0: constants are correct", () => {
    assert.strictEqual(MAX_SLOTS, 40);
    assert.strictEqual(CONN_SLOT_MAX, 20);
    assert.strictEqual(INDEX_SYMBOLS.length, 2);
    assert.strictEqual(STRATEGY_SYMBOLS.length, 4);
    assert.strictEqual(CORE_SYMBOLS.length, 15);
    assert.strictEqual(HEATMAP_CORE_SYMBOLS.length, 40);
    assert.strictEqual(PERMANENT_SLOT_COUNT, 21); // 2+4+15
    assert.strictEqual(DYNAMIC_SLOT_COUNT, 19);   // 40-21
  });

  // QM1: hard cap — can't exceed 40 slots
  it("QM1: hard cap — subscribe 41st symbol → quota_exceeded (without forceSwap)", async () => {
    _resetSubscriptionManager();
    initSubscriptionManager(); // loads 21 permanent slots

    // Fill remaining 19 dynamic slots
    const extras = dummySymbols(19, "D");
    for (const sym of extras) {
      const result = await subscribeSymbol(sym, TIER.WATCHLIST);
      assert.strictEqual(result.ok, true, `Expected ok for ${sym}`);
    }

    const status = getSubscriptionStatus();
    assert.strictEqual(status.slotsUsed, 40);

    // 41st should fail
    const overflow = await subscribeSymbol("OVERFLOW1", TIER.WATCHLIST);
    assert.strictEqual(overflow.ok, false);
    assert.strictEqual(overflow.action, "quota_exceeded");
    assert.ok(overflow.suggestion, "Should include a suggestion message");
  });

  // QM2: connection distribution — each connection ≤ 20
  it("QM2: connection distribution — neither connection exceeds 20 slots", async () => {
    _resetSubscriptionManager();
    initSubscriptionManager();

    // Fill up to 40
    const extras = dummySymbols(19, "C");
    for (const sym of extras) {
      await subscribeSymbol(sym, TIER.WATCHLIST);
    }

    const status = getSubscriptionStatus();
    assert.strictEqual(status.slotsUsed, 40);
    assert.ok(
      status.connections.connection_a.length <= CONN_SLOT_MAX,
      `connection_a has ${status.connections.connection_a.length} > ${CONN_SLOT_MAX}`
    );
    assert.ok(
      status.connections.connection_b.length <= CONN_SLOT_MAX,
      `connection_b has ${status.connections.connection_b.length} > ${CONN_SLOT_MAX}`
    );
    assert.strictEqual(
      status.connections.connection_a.length + status.connections.connection_b.length,
      40
    );
  });

  // QM3: permanent slots never swapped out
  it("QM3: permanent INDEX/STRATEGY/CORE slots cannot be unsubscribed", async () => {
    _resetSubscriptionManager();
    initSubscriptionManager();

    // Try to unsubscribe a permanent slot from each permanent tier
    const indexSym = INDEX_SYMBOLS[0];
    const strategySym = STRATEGY_SYMBOLS[0];
    const coreSym = CORE_SYMBOLS[0];

    const r1 = await unsubscribeSymbol(indexSym);
    assert.strictEqual(r1.ok, false);
    assert.strictEqual(r1.isPermanent, true);

    const r2 = await unsubscribeSymbol(strategySym);
    assert.strictEqual(r2.ok, false);
    assert.strictEqual(r2.isPermanent, true);

    const r3 = await unsubscribeSymbol(coreSym);
    assert.strictEqual(r3.ok, false);
    assert.strictEqual(r3.isPermanent, true);

    // Permanent count should be unchanged
    const status = getSubscriptionStatus();
    assert.strictEqual(status.permanentSlots, PERMANENT_SLOT_COUNT);
  });

  // QM4: LRU swap logic — BUFFER tier evicted before WATCHLIST before HOLDINGS
  it("QM4: LRU swap — evicts BUFFER before WATCHLIST before HOLDINGS", async () => {
    _resetSubscriptionManager();
    initSubscriptionManager();

    // Add 1 HOLDINGS, 1 WATCHLIST, fill rest with BUFFER to hit 40
    await subscribeSymbol("HOLD1", TIER.HOLDINGS);
    await subscribeSymbol("WATCH1", TIER.WATCHLIST);

    // current used: 21 permanent + 1 holdings + 1 watchlist = 23
    // Fill remaining 17 with buffer
    const buffers = dummySymbols(17, "B");
    for (const sym of buffers) {
      await subscribeSymbol(sym, TIER.BUFFER);
    }

    const statusBefore = getSubscriptionStatus();
    assert.strictEqual(statusBefore.slotsUsed, 40);

    // Now force-subscribe a new symbol — should swap out a BUFFER slot
    const result = await subscribeSymbol("NEWONE", TIER.WATCHLIST, true);
    assert.strictEqual(result.ok, true);
    assert.ok(result.swappedOut, "Should have swapped out something");

    // Verify swapped-out was from BUFFER tier (not HOLDINGS or WATCHLIST)
    assert.ok(
      buffers.includes(result.swappedOut!),
      `Expected swapped-out to be a buffer symbol, got ${result.swappedOut}`
    );

    // Total should still be 40
    const statusAfter = getSubscriptionStatus();
    assert.strictEqual(statusAfter.slotsUsed, 40);
  });

  // QM5: holdings sync
  it("QM5: syncHoldings — adds new, removes stale, respects budget", async () => {
    _resetSubscriptionManager();
    initSubscriptionManager();

    // Initial sync with 3 holdings
    const r1 = await syncHoldings(["H001", "H002", "H003"]);
    assert.strictEqual(r1.added.length, 3);
    assert.strictEqual(r1.removed.length, 0);

    // Update: remove H001, add H004, H005 (budget 5 → ok)
    const r2 = await syncHoldings(["H002", "H003", "H004", "H005"]);
    assert.ok(r2.removed.includes("H001"));
    assert.ok(r2.added.includes("H004") || r2.added.includes("H005"));

    // Over-budget: only HOLDINGS_BUDGET taken
    const manyHoldings = dummySymbols(HOLDINGS_BUDGET + 2, "HX");
    const r3 = await syncHoldings(manyHoldings);
    assert.ok(r3.skipped.length > 0, "Should skip symbols beyond budget");

    // Holdings in pool should never exceed HOLDINGS_BUDGET
    const status = getSubscriptionStatus();
    const holdingsCount = status.slots.filter((s) => s.tier === TIER.HOLDINGS).length;
    assert.ok(holdingsCount <= HOLDINGS_BUDGET, `Holdings ${holdingsCount} exceeds budget ${HOLDINGS_BUDGET}`);
  });

  // QM6: watchlist sync
  it("QM6: syncWatchlist — adds new, removes stale, respects budget", async () => {
    _resetSubscriptionManager();
    initSubscriptionManager();

    const wl1 = dummySymbols(5, "W");
    const r1 = await syncWatchlist(wl1);
    assert.strictEqual(r1.added.length, 5);

    // Over-budget: only WATCHLIST_BUDGET allowed
    const wlMany = dummySymbols(WATCHLIST_BUDGET + 3, "WL");
    const r2 = await syncWatchlist(wlMany);
    assert.ok(r2.skipped.length > 0);

    const status = getSubscriptionStatus();
    const watchlistCount = status.slots.filter((s) => s.tier === TIER.WATCHLIST).length;
    assert.ok(watchlistCount <= WATCHLIST_BUDGET, `Watchlist ${watchlistCount} exceeds budget ${WATCHLIST_BUDGET}`);
  });

  // QM7: already_subscribed is idempotent
  it("QM7: subscribing same symbol twice returns already_subscribed", async () => {
    _resetSubscriptionManager();
    initSubscriptionManager();

    const r1 = await subscribeSymbol("DUPE1", TIER.WATCHLIST);
    assert.strictEqual(r1.action, "subscribed");

    const r2 = await subscribeSymbol("DUPE1", TIER.WATCHLIST);
    assert.strictEqual(r2.ok, true);
    assert.strictEqual(r2.action, "already_subscribed");

    // Slot count should not increase
    const status = getSubscriptionStatus();
    const dupeCount = status.slots.filter((s) => s.symbol === "DUPE1").length;
    assert.strictEqual(dupeCount, 1);
  });

  // QM8: subscription status shape
  it("QM8: getSubscriptionStatus returns correct shape", async () => {
    _resetSubscriptionManager();
    initSubscriptionManager();

    await subscribeSymbol("STAT1", TIER.WATCHLIST);

    const status = getSubscriptionStatus();
    assert.strictEqual(typeof status.slotsUsed, "number");
    assert.strictEqual(typeof status.slotsMax, "number");
    assert.strictEqual(typeof status.bufferRemaining, "number");
    assert.strictEqual(status.slotsMax, 40);
    assert.ok(Array.isArray(status.slots));
    assert.ok(Array.isArray(status.connections.connection_a));
    assert.ok(Array.isArray(status.connections.connection_b));
    assert.strictEqual(typeof status.tierSummary, "object");
    assert.ok(status.tierSummary["index"] >= 2, "Should have at least 2 index slots");
    assert.ok(status.tierSummary["core"] === 15, "Should have 15 core slots");
  });

  // QM9: market overview shape
  it("QM9: getKgiMarketOverview returns correct shape", async () => {
    _resetSubscriptionManager();
    initSubscriptionManager();

    const overview = await getKgiMarketOverview();
    assert.strictEqual(overview.source, "kgi_tick");
    assert.strictEqual(typeof overview.staleAfterSec, "number");
    assert.ok("taiex" in overview);
    assert.ok("otc" in overview);
    assert.strictEqual(overview.taiex.source, "kgi_tick");
    assert.strictEqual(overview.otc.source, "kgi_tick");
    // With mocked fetch returning close=20000
    assert.strictEqual(overview.taiex.value, 20000);
    assert.strictEqual(overview.taiex.changePct, 0.25);
  });

  // QM10: core heatmap shape
  it("QM10: getKgiCoreHeatmap returns correct shape", async () => {
    _resetSubscriptionManager();
    initSubscriptionManager();

    const result = await getKgiCoreHeatmap();
    assert.strictEqual(result.source, "kgi_tick");
    assert.strictEqual(typeof result.tileCount, "number");
    assert.ok(Array.isArray(result.tiles));
    // Dashboard heatmap must not collapse to the 19 subscribed quota symbols.
    assert.ok(result.tiles.length >= HEATMAP_CORE_SYMBOLS.length);
    // Each tile has required fields
    for (const tile of result.tiles) {
      assert.ok("symbol" in tile);
      assert.ok("tier" in tile);
      assert.strictEqual(tile.source, "kgi_tick");
    }
  });

  // ── Durable fix tests (2026-07-16): permanent-tier symbols must actually
  // reach the gateway, not just sit in local bookkeeping. ──────────────────

  // QM11: permanent tier boot subscribe — the actual bug from 2026-07-16.
  it("QM11: ensurePermanentSubscriptions actually calls gateway for all 21 permanent symbols", async () => {
    _resetSubscriptionManager();
    initSubscriptionManager(); // seeds 21 permanent slots, subscribed:false, zero gateway calls so far

    const statusBefore = getSubscriptionStatus();
    // At this point _slots contains exactly the 21 permanent entries (no
    // dynamic subscribe has happened yet).
    assert.strictEqual(statusBefore.slots.length, PERMANENT_SLOT_COUNT);
    assert.ok(
      statusBefore.slots.every((s) => s.subscribed === false),
      "Sanity: before the fix, initSubscriptionManager() alone never confirms any permanent slot"
    );
    assert.strictEqual(mockGatewayState.subscribeCalls.length, 0, "No gateway calls should have happened yet");

    const result = await ensurePermanentSubscriptions();

    assert.strictEqual(result.gatewayReachable, true);
    assert.strictEqual(result.subscribed.length, PERMANENT_SLOT_COUNT); // all 21 newly subscribed
    assert.strictEqual(result.failed.length, 0);
    assert.strictEqual(mockGatewayState.subscribeCalls.length, PERMANENT_SLOT_COUNT);

    // Every INDEX/STRATEGY/CORE symbol is now confirmed subscribed, including 2330.
    const statusAfter = getSubscriptionStatus();
    const twoThreeThirty = statusAfter.slots.find((s) => s.symbol === "2330");
    assert.ok(twoThreeThirty, "2330 must be in the pool (CORE tier)");
    assert.strictEqual(twoThreeThirty!.subscribed, true, "2330 must be confirmed subscribed at the gateway");
    for (const sym of [...INDEX_SYMBOLS, ...STRATEGY_SYMBOLS, ...CORE_SYMBOLS]) {
      const slot = statusAfter.slots.find((s) => s.symbol === sym);
      assert.strictEqual(slot?.subscribed, true, `${sym} must be confirmed subscribed`);
    }
  });

  // QM12: gateway offline at boot, comes online later — reconciler catches up.
  it("QM12: gateway offline at first pass, online on next pass — permanent symbols subscribe late", async () => {
    _resetSubscriptionManager();
    initSubscriptionManager();
    resetMockGateway({ online: false }); // simulate Railway booting before EC2 gateway's 08:20 start

    const firstPass = await ensurePermanentSubscriptions();
    assert.strictEqual(firstPass.gatewayReachable, false);
    assert.strictEqual(firstPass.subscribed.length, 0);
    assert.strictEqual(firstPass.failed.length, 0, "Fail-open: unreachable gateway must not be recorded as a failure");

    const statusStillDown = getSubscriptionStatus();
    assert.ok(
      statusStillDown.slots.every((s) => s.subscribed === false),
      "No state should be mutated while gateway is unreachable"
    );

    // Gateway comes online (e.g. its 08:20 scheduled boot completes).
    mockGatewayState.online = true;

    const secondPass = await ensurePermanentSubscriptions();
    assert.strictEqual(secondPass.gatewayReachable, true);
    assert.strictEqual(secondPass.subscribed.length, PERMANENT_SLOT_COUNT);

    const statusAfter = getSubscriptionStatus();
    assert.ok(statusAfter.slots.every((s) => s.subscribed === true), "All permanent slots subscribed once gateway is reachable");
  });

  // QM13: idempotent — a second reconcile pass over an already-live gateway makes zero new subscribe calls.
  it("QM13: repeated ensurePermanentSubscriptions calls are idempotent (no duplicate gateway calls)", async () => {
    _resetSubscriptionManager();
    initSubscriptionManager();

    const first = await ensurePermanentSubscriptions();
    assert.strictEqual(first.subscribed.length, PERMANENT_SLOT_COUNT);
    const callsAfterFirst = mockGatewayState.subscribeCalls.length;
    assert.strictEqual(callsAfterFirst, PERMANENT_SLOT_COUNT);

    // Second pass: gateway now reports all 21 as live (ground truth), so this
    // must be a pure confirm — zero additional /quote/subscribe/tick calls.
    const second = await ensurePermanentSubscriptions();
    assert.strictEqual(second.subscribed.length, 0, "Nothing new to subscribe");
    assert.strictEqual(second.alreadyLive.length, PERMANENT_SLOT_COUNT, "All 21 confirmed live from gateway status alone");
    assert.strictEqual(
      mockGatewayState.subscribeCalls.length,
      callsAfterFirst,
      "No new gateway subscribe calls on the idempotent pass"
    );
  });

  // QM14: gateway restart mid-day — local flag says subscribed, gateway forgot, reconciler re-subscribes.
  it("QM14: gateway restart wipes live set — reconciler detects and re-subscribes (self-heal)", async () => {
    _resetSubscriptionManager();
    initSubscriptionManager();

    await ensurePermanentSubscriptions();
    assert.strictEqual(mockGatewayState.subscribeCalls.length, PERMANENT_SLOT_COUNT);

    const statusBeforeRestart = getSubscriptionStatus();
    assert.ok(statusBeforeRestart.slots.every((s) => s.subscribed === true));

    // Simulate a gateway process restart: its own live-subscribed set is
    // wiped (fresh KGI SDK session), but our local `_slots[].subscribed`
    // flags are untouched — exactly the 2026-07-16 incident.
    mockGatewayState.liveTickSymbols = new Set<string>();
    mockGatewayState.subscribeCalls = [];

    const afterRestart = await ensurePermanentSubscriptions();
    assert.strictEqual(afterRestart.gatewayReachable, true);
    assert.strictEqual(
      afterRestart.subscribed.length,
      PERMANENT_SLOT_COUNT,
      "Reconciler must notice the gateway forgot everything and re-subscribe all 21"
    );
    assert.strictEqual(mockGatewayState.subscribeCalls.length, PERMANENT_SLOT_COUNT);
  });

  // QM15: subscribeSymbol() no longer trusts "in the pool" as proof of a real subscribe.
  it("QM15: subscribeSymbol retries the real gateway call for an in-pool-but-unconfirmed symbol", async () => {
    _resetSubscriptionManager();
    initSubscriptionManager(); // 2330 is in _slots with subscribed:false, zero gateway calls so far

    assert.strictEqual(mockGatewayState.subscribeCalls.includes("2330"), false);

    const result = await subscribeSymbol("2330", TIER.CORE);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.action, "subscribed", "Must attempt + confirm the real gateway call, not silently claim already_subscribed");
    assert.ok(mockGatewayState.subscribeCalls.includes("2330"), "A real gateway subscribe call must have been made");

    const status = getSubscriptionStatus();
    const slot = status.slots.find((s) => s.symbol === "2330");
    assert.strictEqual(slot?.subscribed, true);

    // A further call for the now-confirmed symbol is the cheap idempotent path.
    const callsBefore = mockGatewayState.subscribeCalls.length;
    const result2 = await subscribeSymbol("2330", TIER.CORE);
    assert.strictEqual(result2.action, "already_subscribed");
    assert.strictEqual(mockGatewayState.subscribeCalls.length, callsBefore, "No duplicate gateway call once confirmed");
  });

  // QM16: recordTickReceived wiring — a real tick observed via fetchKgiLatestTick
  // (through getKgiMarketOverview, which polls ^TWII/^TPEX) must mark the slot live.
  it("QM16: a successful tick fetch marks the matching slot subscribed + lastTickAt", async () => {
    _resetSubscriptionManager();
    initSubscriptionManager();

    const statusBefore = getSubscriptionStatus();
    const twii = statusBefore.slots.find((s) => s.symbol === "^TWII");
    assert.strictEqual(twii?.subscribed, false);
    assert.strictEqual(twii?.lastTickAt, null);

    await getKgiMarketOverview(); // internally calls fetchKgiLatestTick("^TWII") + ("^TPEX")

    const statusAfter = getSubscriptionStatus();
    const twiiAfter = statusAfter.slots.find((s) => s.symbol === "^TWII");
    assert.strictEqual(twiiAfter?.subscribed, true, "recordTickReceived must flip subscribed:true on a real tick");
    assert.ok(twiiAfter?.lastTickAt, "lastTickAt must be populated");
  });
});
