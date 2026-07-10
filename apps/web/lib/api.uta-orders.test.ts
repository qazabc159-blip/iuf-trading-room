import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// Regression lock for Pete #1206 review finding (fixed 2026-07-10): a prior
// version of UnifiedOrderEntry declared fields (side/quantity/simOnly, plus a
// `total` on the getUtaOrders() response) that never existed on the real
// backend wire shape — GET /api/v1/uta/orders responds `{ data: { orders } }`
// with rows shaped by apps/api/src/broker/unified-order-store.ts
// UnifiedOrderRecord (action/qty, no `total`, no per-row sim flag). This test
// pins the real shape (confirmed via a live prod curl 2026-07-10, response
// `{"data":{"orders":[]}}`) so the type can't silently drift again.

let getUtaOrders: typeof import("./api").getUtaOrders;

beforeAll(async () => {
  process.env.NEXT_PUBLIC_API_BASE_URL = "http://localhost:9999";
  const mod = await import("./api");
  getUtaOrders = mod.getUtaOrders;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getUtaOrders — GET /api/v1/uta/orders", () => {
  it("unwraps the real { data: { orders } } envelope and preserves action/qty field names", async () => {
    const fetchSpy = vi.fn(async (url: string) => {
      expect(String(url)).toContain("/api/v1/uta/orders?limit=50");
      return new Response(
        JSON.stringify({
          data: {
            orders: [
              {
                id: "o1",
                adapterKey: "kgi",
                symbol: "2330",
                action: "Buy",
                qty: 1000,
                quantityUnit: "SHARE",
                priceType: "Limit",
                limitPrice: 950.5,
                status: "submitted",
                createdAt: "2026-07-10T02:00:00Z",
              },
            ],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchSpy);

    const res = await getUtaOrders({ limit: 50 });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(res.data.orders).toHaveLength(1);
    expect(res.data.orders[0]?.action).toBe("Buy");
    expect(res.data.orders[0]?.qty).toBe(1000);
    // `total` was never sent by the backend and nothing in the app reads it —
    // confirm the type no longer claims it exists.
    expect((res.data as Record<string, unknown>).total).toBeUndefined();
  });

  it("matches the real prod shape for an empty result (curl-verified 2026-07-10, no simOnly/total)", async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify({ data: { orders: [] } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchSpy);

    const res = await getUtaOrders({ limit: 50 });

    expect(res.data.orders).toEqual([]);
  });
});
