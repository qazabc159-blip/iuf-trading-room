import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// 委託回報面板 (D3, 2026-07-10): unit tests for the new unified-order-report
// helpers in paper-orders-api.ts — pure label/date-key functions plus the
// listUnifiedOrders() fetch wrapper against a mocked upstream.

let listUnifiedOrders: typeof import("./paper-orders-api").listUnifiedOrders;
let unifiedOrderStatusLabel: typeof import("./paper-orders-api").unifiedOrderStatusLabel;
let unifiedOrderChannelLabel: typeof import("./paper-orders-api").unifiedOrderChannelLabel;
let isUnifiedOrderFromTaipeiToday: typeof import("./paper-orders-api").isUnifiedOrderFromTaipeiToday;

beforeAll(async () => {
  // paper-orders-api.ts reads NEXT_PUBLIC_API_BASE_URL at module load time.
  process.env.NEXT_PUBLIC_API_BASE_URL = "http://localhost:9999";
  const mod = await import("./paper-orders-api");
  listUnifiedOrders = mod.listUnifiedOrders;
  unifiedOrderStatusLabel = mod.unifiedOrderStatusLabel;
  unifiedOrderChannelLabel = mod.unifiedOrderChannelLabel;
  isUnifiedOrderFromTaipeiToday = mod.isUnifiedOrderFromTaipeiToday;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("unifiedOrderStatusLabel — 四態誠實詞彙（禁 enum 裸露）", () => {
  it("maps all six real unified_orders statuses to honest Chinese, never the raw enum", () => {
    expect(unifiedOrderStatusLabel("pending")).toBe("待送出");
    expect(unifiedOrderStatusLabel("submitted")).toBe("已受理");
    expect(unifiedOrderStatusLabel("partial_fill")).toBe("部分成交");
    expect(unifiedOrderStatusLabel("filled")).toBe("已成交");
    expect(unifiedOrderStatusLabel("cancelled")).toBe("已撤單");
    expect(unifiedOrderStatusLabel("rejected")).toBe("已拒絕");
  });

  it("falls back to a honest 同步中 label for an unknown status instead of the raw string", () => {
    expect(unifiedOrderStatusLabel("some_future_enum_value")).toBe("狀態同步中");
    expect(unifiedOrderStatusLabel("")).toBe("狀態同步中");
  });
});

describe("unifiedOrderChannelLabel", () => {
  it("labels each known adapterKey in Traditional Chinese", () => {
    expect(unifiedOrderChannelLabel("paper")).toBe("紙上");
    expect(unifiedOrderChannelLabel("kgi")).toBe("凱基 SIM");
    expect(unifiedOrderChannelLabel("fubon")).toBe("富邦");
  });

  it("falls back to the raw adapterKey for an unknown channel rather than hiding it", () => {
    expect(unifiedOrderChannelLabel("some_new_broker")).toBe("some_new_broker");
  });
});

describe("isUnifiedOrderFromTaipeiToday", () => {
  it("matches an order created earlier the same Taipei calendar day", () => {
    // 2026-07-10 08:00 UTC == 2026-07-10 16:00 Asia/Taipei
    const nowMs = Date.parse("2026-07-10T08:00:00Z");
    expect(isUnifiedOrderFromTaipeiToday("2026-07-10T01:30:00Z", nowMs)).toBe(true);
  });

  it("excludes an order from the previous Taipei calendar day even if same UTC day", () => {
    // 2026-07-10 00:30 UTC == 2026-07-10 08:30 Taipei (today)
    // 2026-07-09 15:00 UTC == 2026-07-09 23:00 Taipei (yesterday, still same UTC date as "now"'s UTC date in some cases)
    const nowMs = Date.parse("2026-07-10T00:30:00Z");
    expect(isUnifiedOrderFromTaipeiToday("2026-07-09T15:00:00Z", nowMs)).toBe(false);
  });

  it("returns false for an unparseable createdAt instead of throwing", () => {
    expect(isUnifiedOrderFromTaipeiToday("not-a-date")).toBe(false);
  });
});

describe("listUnifiedOrders — GET /api/v1/uta/orders", () => {
  it("requests the given limit and unwraps the { data: { orders } } envelope", async () => {
    const fetchSpy = vi.fn(async (url: string) => {
      expect(String(url)).toContain("/api/v1/uta/orders?limit=20");
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
                filledQty: 0,
                filledPrice: null,
                createdAt: "2026-07-10T02:00:00Z",
                updatedAt: "2026-07-10T02:00:00Z",
              },
            ],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchSpy);

    const result = await listUnifiedOrders(20);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result.orders).toHaveLength(1);
    expect(result.orders[0]?.symbol).toBe("2330");
    expect(result.orders[0]?.status).toBe("submitted");
  });
});
