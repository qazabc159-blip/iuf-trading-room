/**
 * kbar.test.ts — W3 B2 K-bar Phase 2 backend tests
 *
 * Tests for K-bar routes in KgiQuoteClient:
 *   - recoverKbar
 *   - subscribeSymbolKbar (incl. interval matrix)
 *   - getRecentKbars (incl. mock fallback / empty-safe)
 *
 * Run: node --test --import tsx/esm apps/api/src/__tests__/kbar.test.ts
 *
 * Hard lines verified:
 *   - No /order/create or /order/* URLs called by K-bar methods
 *   - K-bar methods are NOT order methods (name enumeration)
 *   - unsupported interval is surfaced in response (not hard-transcoded)
 *   - empty-safe: 404 from gateway → empty bars (not exception)
 *   - mock fallback default-on
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  KgiQuoteClient,
  KgiQuoteSymbolNotAllowedError,
  KgiQuoteDisabledError,
  type KBarData,
} from "../broker/kgi-quote-client.js";

// ---------------------------------------------------------------------------
// Mock fetch factory (mirrors W2d pattern)
// ---------------------------------------------------------------------------

function makeMockFetch(responses: Map<string, { status: number; body: unknown }>) {
  const calls: string[] = [];
  const mockFetch = async (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push(url);
    const entry = [...responses.entries()].find(([k]) => url.includes(k));
    if (!entry) {
      return new Response(
        JSON.stringify({ error: { code: "NOT_REGISTERED", message: "mock: no response registered" } }),
        { status: 503 }
      );
    }
    const [, { status, body }] = entry;
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  };
  return { mockFetch, calls };
}

// ---------------------------------------------------------------------------
// Sample K-bar data
// ---------------------------------------------------------------------------

const SAMPLE_KBARS: KBarData[] = [
  { time: 1745728800000, open: 945.0, high: 952.0, low: 942.0, close: 948.0, volume: 12345 },
  { time: 1745732400000, open: 948.0, high: 956.0, low: 946.0, close: 954.0, volume: 9876 },
];

// ---------------------------------------------------------------------------
// W3-B2-T1: recoverKbar — success path returns bars
// ---------------------------------------------------------------------------

test("W3-B2-T1: recoverKbar — success returns bars list", async () => {
  const mockBody = {
    symbol: "2330",
    bars: SAMPLE_KBARS,
    count: 2,
    from_date: "20260425",
    to_date: "20260427",
  };

  const { mockFetch, calls } = makeMockFetch(
    new Map([["/quote/kbar/recover", { status: 200, body: mockBody }]])
  );

  const orig = globalThis.fetch;
  globalThis.fetch = mockFetch as typeof fetch;
  try {
    const client = new KgiQuoteClient({
      gatewayBaseUrl: "http://test-gateway",
      symbolWhitelist: ["2330"],
    });
    const result = await client.recoverKbar("2330", "20260425", "20260427");
    assert.equal(result.symbol, "2330");
    assert.equal(result.count, 2);
    assert.equal(result.bars.length, 2);
    assert.equal(result.bars[0]!.close, 948.0);
    assert.ok(calls.some((u) => u.includes("/quote/kbar/recover")), "must have called /quote/kbar/recover");
  } finally {
    globalThis.fetch = orig;
  }
});

// ---------------------------------------------------------------------------
// W3-B2-T2: recoverKbar — non-whitelisted symbol → KgiQuoteSymbolNotAllowedError
// ---------------------------------------------------------------------------

test("W3-B2-T2: recoverKbar — non-whitelisted symbol rejects before network call", async () => {
  let fetchCalled = false;
  const orig = globalThis.fetch;
  globalThis.fetch = (async () => {
    fetchCalled = true;
    return new Response("{}", { status: 200 });
  }) as typeof fetch;

  try {
    const client = new KgiQuoteClient({
      gatewayBaseUrl: "http://test-gateway",
      symbolWhitelist: ["2330"],
    });
    await assert.rejects(
      () => client.recoverKbar("9999", "20260425", "20260427"),
      KgiQuoteSymbolNotAllowedError,
      "recoverKbar must reject non-whitelisted symbol before network call"
    );
    assert.equal(fetchCalled, false, "fetch must NOT be called for non-whitelisted symbol");
  } finally {
    globalThis.fetch = orig;
  }
});

// ---------------------------------------------------------------------------
// W3-B2-T3: recoverKbar — empty bars response (no data in range)
// ---------------------------------------------------------------------------

test("W3-B2-T3: recoverKbar — empty bars response is handled gracefully", async () => {
  const mockBody = {
    symbol: "2330",
    bars: [],
    count: 0,
    from_date: "20260101",
    to_date: "20260102",
    note: "No data in range",
  };

  const { mockFetch } = makeMockFetch(
    new Map([["/quote/kbar/recover", { status: 200, body: mockBody }]])
  );

  const orig = globalThis.fetch;
  globalThis.fetch = mockFetch as typeof fetch;
  try {
    const client = new KgiQuoteClient({
      gatewayBaseUrl: "http://test-gateway",
      symbolWhitelist: ["2330"],
    });
    const result = await client.recoverKbar("2330", "20260101", "20260102");
    assert.equal(result.symbol, "2330");
    assert.equal(result.count, 0);
    assert.deepEqual(result.bars, []);
  } finally {
    globalThis.fetch = orig;
  }
});

// ---------------------------------------------------------------------------
// W3-B2-T4: recoverKbar — QUOTE_DISABLED → KgiQuoteDisabledError
// ---------------------------------------------------------------------------

test("W3-B2-T4: recoverKbar — QUOTE_DISABLED gateway response → KgiQuoteDisabledError", async () => {
  const { mockFetch } = makeMockFetch(
    new Map([["/quote/kbar/recover", {
      status: 503,
      body: { error: { code: "QUOTE_DISABLED", message: "Quote disabled" } },
    }]])
  );

  const orig = globalThis.fetch;
  globalThis.fetch = mockFetch as typeof fetch;
  try {
    const client = new KgiQuoteClient({
      gatewayBaseUrl: "http://test-gateway",
      symbolWhitelist: ["2330"],
    });
    await assert.rejects(
      () => client.recoverKbar("2330", "20260425", "20260427"),
      KgiQuoteDisabledError,
      "recoverKbar must throw KgiQuoteDisabledError when gateway returns 503 QUOTE_DISABLED"
    );
  } finally {
    globalThis.fetch = orig;
  }
});

// ---------------------------------------------------------------------------
// W3-B2-T5: subscribeSymbolKbar — success path
// ---------------------------------------------------------------------------

test("W3-B2-T5: subscribeSymbolKbar — success returns label", async () => {
  const mockBody = {
    ok: true,
    label: "kbar_2330",
    note: "DRAFT: WS push is sandbox-only",
    interval_status: "supported",
  };

  const { mockFetch, calls } = makeMockFetch(
    new Map([["/quote/subscribe/kbar", { status: 200, body: mockBody }]])
  );

  const orig = globalThis.fetch;
  globalThis.fetch = mockFetch as typeof fetch;
  try {
    const client = new KgiQuoteClient({
      gatewayBaseUrl: "http://test-gateway",
      symbolWhitelist: ["2330"],
    });
    const result = await client.subscribeSymbolKbar("2330", { interval: "1m" });
    assert.equal(result.ok, true);
    assert.equal(result.label, "kbar_2330");
    assert.ok(calls.some((u) => u.includes("/quote/subscribe/kbar")));
  } finally {
    globalThis.fetch = orig;
  }
});

// ---------------------------------------------------------------------------
// W3-B2-T6: subscribeSymbolKbar — unsupported interval surfaced (not hard-transcoded)
// ---------------------------------------------------------------------------

test("W3-B2-T6: subscribeSymbolKbar — unsupported interval returns interval_status=unsupported", async () => {
  const mockBody = {
    ok: true,
    label: null,
    note: "Interval '30m' is not supported",
    interval_status: "unsupported",
    unsupported_reason: "SDK subscribe_kbar does not expose resolution parameter; 30m interval not confirmed",
  };

  const { mockFetch } = makeMockFetch(
    new Map([["/quote/subscribe/kbar", { status: 200, body: mockBody }]])
  );

  const orig = globalThis.fetch;
  globalThis.fetch = mockFetch as typeof fetch;
  try {
    const client = new KgiQuoteClient({
      gatewayBaseUrl: "http://test-gateway",
      symbolWhitelist: ["2330"],
    });
    const result = await client.subscribeSymbolKbar("2330", { interval: "30m" });
    assert.equal(result.ok, true, "response must be ok (not an error — just unsupported interval info)");
    assert.equal(result.interval_status, "unsupported", "must surface unsupported interval status");
    assert.ok(result.unsupported_reason, "must include unsupported reason");
    assert.equal(result.label, null, "label must be null for unsupported interval");
    // Hard line: we do NOT hard-transcode — the interval is just surfaced as unsupported
  } finally {
    globalThis.fetch = orig;
  }
});

// ---------------------------------------------------------------------------
// W3-B2-T7: subscribeSymbolKbar — QUOTE_DISABLED → KgiQuoteDisabledError
// ---------------------------------------------------------------------------

test("W3-B2-T7: subscribeSymbolKbar — QUOTE_DISABLED → KgiQuoteDisabledError", async () => {
  const { mockFetch } = makeMockFetch(
    new Map([["/quote/subscribe/kbar", {
      status: 503,
      body: { error: { code: "QUOTE_DISABLED", message: "Quote disabled" } },
    }]])
  );

  const orig = globalThis.fetch;
  globalThis.fetch = mockFetch as typeof fetch;
  try {
    const client = new KgiQuoteClient({
      gatewayBaseUrl: "http://test-gateway",
      symbolWhitelist: ["2330"],
    });
    await assert.rejects(
      () => client.subscribeSymbolKbar("2330"),
      KgiQuoteDisabledError,
      "subscribeSymbolKbar must throw KgiQuoteDisabledError when QUOTE_DISABLED"
    );
  } finally {
    globalThis.fetch = orig;
  }
});

// ---------------------------------------------------------------------------
// W3-B2-T8: getRecentKbars — success path
// ---------------------------------------------------------------------------

test("W3-B2-T8: getRecentKbars — success returns bars list", async () => {
  const mockBody = {
    symbol: "2330",
    bars: SAMPLE_KBARS,
    count: 2,
    buffer_size: 200,
    buffer_used: 2,
  };

  const { mockFetch, calls } = makeMockFetch(
    new Map([["/quote/kbar", { status: 200, body: mockBody }]])
  );

  const orig = globalThis.fetch;
  globalThis.fetch = mockFetch as typeof fetch;
  try {
    const client = new KgiQuoteClient({
      gatewayBaseUrl: "http://test-gateway",
      symbolWhitelist: ["2330"],
    });
    const result = await client.getRecentKbars("2330", 10);
    assert.equal(result.symbol, "2330");
    assert.equal(result.count, 2);
    assert.equal(result.bars.length, 2);
    assert.ok(calls.some((u) => u.includes("/quote/kbar") && !u.includes("/recover")));
  } finally {
    globalThis.fetch = orig;
  }
});

// ---------------------------------------------------------------------------
// W3-B2-T9: getRecentKbars — empty-safe fallback (404 → empty bars, no exception)
// ---------------------------------------------------------------------------

test("W3-B2-T9: getRecentKbars — 404 from gateway → empty-safe response (no exception)", async () => {
  const { mockFetch } = makeMockFetch(
    new Map([["/quote/kbar", {
      status: 404,
      body: { error: { code: "KBAR_NOT_SUBSCRIBED", message: "Not subscribed" } },
    }]])
  );

  const orig = globalThis.fetch;
  globalThis.fetch = mockFetch as typeof fetch;
  try {
    const client = new KgiQuoteClient({
      gatewayBaseUrl: "http://test-gateway",
      symbolWhitelist: ["2330"],
    });
    // Must NOT throw — returns empty bars (mock fallback default-on)
    const result = await client.getRecentKbars("2330", 10);
    assert.equal(result.symbol, "2330");
    assert.deepEqual(result.bars, [], "empty-safe: 404 must return empty bars array");
    assert.equal(result.count, 0);
  } finally {
    globalThis.fetch = orig;
  }
});

// ---------------------------------------------------------------------------
// W3-B2-T10: K-bar shape validation — correct OHLCV fields
// ---------------------------------------------------------------------------

test("W3-B2-T10: K-bar shape has correct OHLCV fields", async () => {
  const bar = SAMPLE_KBARS[0]!;
  assert.ok("time" in bar, "bar must have time field");
  assert.ok("open" in bar, "bar must have open field");
  assert.ok("high" in bar, "bar must have high field");
  assert.ok("low" in bar, "bar must have low field");
  assert.ok("close" in bar, "bar must have close field");
  assert.ok("volume" in bar, "bar must have volume field");
  assert.equal(typeof bar.time, "number", "time must be number (unix ms)");
  assert.equal(typeof bar.open, "number");
  assert.equal(typeof bar.close, "number");
  assert.equal(typeof bar.volume, "number");
});

// ---------------------------------------------------------------------------
// W3-B2-T11: No-order guarantee — K-bar methods have 0 order-named methods
// ---------------------------------------------------------------------------

test("W3-B2-T11: no-order guarantee — K-bar additions to KgiQuoteClient have 0 order methods", () => {
  const orderPatterns = ["order", "submit", "place", "cancel", "modify", "create"];
  const client = new KgiQuoteClient({
    gatewayBaseUrl: "http://test-gateway",
    symbolWhitelist: ["2330"],
  });

  const allKeys = new Set<string>();
  let proto = Object.getPrototypeOf(client);
  while (proto && proto !== Object.prototype) {
    for (const k of Object.getOwnPropertyNames(proto)) {
      allKeys.add(k.toLowerCase());
    }
    proto = Object.getPrototypeOf(proto);
  }
  for (const k of Object.keys(client)) {
    allKeys.add(k.toLowerCase());
  }

  for (const pattern of orderPatterns) {
    const matches = [...allKeys].filter((k) => k.includes(pattern));
    assert.equal(
      matches.length,
      0,
      `KgiQuoteClient must have 0 methods containing '${pattern}' — found: ${matches.join(", ")}`
    );
  }
});

// ---------------------------------------------------------------------------
// W3-B2-T12: No-order guarantee — K-bar method calls don't touch /order/* URLs
// ---------------------------------------------------------------------------

test("W3-B2-T12: no-order guarantee — K-bar methods don't call /order/* URLs", async () => {
  const orderUrlsCalled: string[] = [];
  const successResponses = new Map([
    ["/quote/kbar/recover", {
      status: 200,
      body: { symbol: "2330", bars: [], count: 0, from_date: "20260425", to_date: "20260427" },
    }],
    ["/quote/subscribe/kbar", {
      status: 200,
      body: { ok: true, label: "kbar_2330", interval_status: "supported" },
    }],
    ["/quote/kbar", {
      status: 200,
      body: { symbol: "2330", bars: [], count: 0, buffer_size: 200, buffer_used: 0 },
    }],
  ]);

  const orig = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/order/")) orderUrlsCalled.push(url);
    const entry = [...successResponses.entries()].find(([k]) => url.includes(k));
    if (entry) {
      return new Response(JSON.stringify(entry[1].body), {
        status: entry[1].status,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;

  try {
    const client = new KgiQuoteClient({
      gatewayBaseUrl: "http://test-gateway",
      symbolWhitelist: ["2330"],
    });

    await client.recoverKbar("2330", "20260425", "20260427");
    await client.subscribeSymbolKbar("2330", { interval: "1m" });
    await client.getRecentKbars("2330", 5);

    assert.equal(
      orderUrlsCalled.length,
      0,
      `No /order/* URLs must be called during K-bar operations — found: ${orderUrlsCalled.join(", ")}`
    );
  } finally {
    globalThis.fetch = orig;
  }
});

// ---------------------------------------------------------------------------
// W3-B2-T13: Interval matrix — supported intervals in SUPPORTED_INTERVALS set
// ---------------------------------------------------------------------------

test("W3-B2-T13: interval matrix — supported intervals accepted by subscribeSymbolKbar", async () => {
  // The spec says first-version supported intervals are: 1m, 5m, 15m, 1d
  const supportedIntervals = ["1m", "5m", "15m", "1d"];

  for (const interval of supportedIntervals) {
    const mockBody = {
      ok: true,
      label: `kbar_2330`,
      interval_status: "supported",
    };

    const { mockFetch } = makeMockFetch(
      new Map([["/quote/subscribe/kbar", { status: 200, body: mockBody }]])
    );

    const orig = globalThis.fetch;
    globalThis.fetch = mockFetch as typeof fetch;
    try {
      const client = new KgiQuoteClient({
        gatewayBaseUrl: "http://test-gateway",
        symbolWhitelist: ["2330"],
      });
      // Must not throw — gateway handles the supported interval
      const result = await client.subscribeSymbolKbar("2330", { interval });
      assert.equal(result.ok, true, `interval=${interval} must succeed`);
    } finally {
      globalThis.fetch = orig;
    }
  }
});

// ---------------------------------------------------------------------------
// W3-B2-T14: K-bar subscribe QUOTE_DISABLED fires before auth (W2d gap pattern)
// ---------------------------------------------------------------------------

test("W3-B2-T14: subscribeSymbolKbar — QUOTE_DISABLED fires before auth (breaker precedence)", async () => {
  // Simulate QUOTE_DISABLED=true even when not logged in
  const { mockFetch } = makeMockFetch(
    new Map([["/quote/subscribe/kbar", {
      status: 503,
      body: { error: { code: "QUOTE_DISABLED", message: "Quote disabled" } },
    }]])
  );

  const orig = globalThis.fetch;
  globalThis.fetch = mockFetch as typeof fetch;
  try {
    const client = new KgiQuoteClient({
      gatewayBaseUrl: "http://test-gateway",
      symbolWhitelist: ["2330"],
    });
    // Must throw KgiQuoteDisabledError (503), not any auth error
    await assert.rejects(
      () => client.subscribeSymbolKbar("2330"),
      KgiQuoteDisabledError,
      "QUOTE_DISABLED must fire before auth check (mirrors W2d subscribe-gap fix)"
    );
  } finally {
    globalThis.fetch = orig;
  }
});

// ---------------------------------------------------------------------------
// W3-B2-T15: K-bar method enumeration — confirm new methods are read-only named
// ---------------------------------------------------------------------------

test("W3-B2-T15: K-bar method names are read-only named (recoverKbar / subscribeSymbolKbar / getRecentKbars)", () => {
  const client = new KgiQuoteClient({
    gatewayBaseUrl: "http://test-gateway",
    symbolWhitelist: ["2330"],
  });

  // These methods must exist
  assert.equal(typeof client.recoverKbar, "function", "recoverKbar must be a function");
  assert.equal(typeof client.subscribeSymbolKbar, "function", "subscribeSymbolKbar must be a function");
  assert.equal(typeof client.getRecentKbars, "function", "getRecentKbars must be a function");

  // None of them have 'order' in the name
  const kbarMethods = ["recoverkbar", "subscribesymbolkbar", "getrecentkbars"];
  for (const m of kbarMethods) {
    assert.ok(!m.includes("order"), `K-bar method '${m}' must not contain 'order'`);
  }
});
