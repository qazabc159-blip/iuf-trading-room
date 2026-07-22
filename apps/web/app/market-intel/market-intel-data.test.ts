import { describe, expect, it } from "vitest";

import { resolveInstitutional, type MarketIntelSources } from "./market-intel-data";

// 2026-07-22 回歸鎖：/api/v1/market/institutional-summary/finmind 的
// institutions[].name 是 FinMind 英文 enum（非中文），舊版用中文子字串
// `.includes()` 比對永遠比不到，三大法人 Panel 9 格恆顯 `--`
// （見 reports/design_redesign_20260722/ORIGINAL_PAGES_INVENTORY_20260722.md
// §2.3，Bruce 2026-07-22 curl 實測 prod 抓到的真實 institutions 形狀）。
function sources(institutional: MarketIntelSources["institutional"]): Pick<MarketIntelSources, "institutional"> {
  return { institutional };
}

describe("resolveInstitutional", () => {
  it("buckets FinMind English enum names into non-null 外資/投信/自營商 lines (real prod shape)", async () => {
    const result = await resolveInstitutional(
      sources(
        Promise.resolve({
          asOf: "2026-07-22",
          totalNet: 74095131,
          // Real shape captured via prod curl 2026-07-22 (see report above):
          // 自營商 splits into multiple English-labelled rows that must all
          // be summed into the same bucket, not just the first match.
          institutions: [
            { name: "Foreign_Investor", buy: 3078231273, sell: 2518136142, net: 560095131 },
            { name: "Dealer_Hedging", buy: 5000000, sell: 2000000, net: 3000000 },
            { name: "Investment_Trust", buy: 146510791, sell: 100000000, net: 46510791 },
            { name: "Foreign_Dealer_Self", buy: 10000000, sell: 5000000, net: 5000000 },
            { name: "Dealer", buy: 8000000, sell: 3000000, net: 5000000 },
            { name: "Dealer_self", buy: 2000000, sell: 1000000, net: 1000000 },
          ],
          topNetBuy: [],
          topNetSell: [],
          source: "finmind",
          state: "live",
        }),
      ),
    );

    expect(result).not.toBeNull();
    // 9 格皆非 --（皆為數字，非 null）
    for (const line of [result!.foreign, result!.invest, result!.dealer]) {
      expect(line).not.toBeNull();
      expect(typeof line!.buy).toBe("number");
      expect(typeof line!.sell).toBe("number");
      expect(typeof line!.net).toBe("number");
    }

    // 外資 = Foreign_Investor + Foreign_Dealer_Self（同時命中 /Foreign/ 的兩列都要算進外資）
    expect(result!.foreign).toEqual({ buy: 3088231273, sell: 2523136142, net: 565095131 });
    // 投信 = Investment_Trust 單列
    expect(result!.invest).toEqual({ buy: 146510791, sell: 100000000, net: 46510791 });
    // 自營商 = Dealer_Hedging + Dealer + Dealer_self 三列加總，不能只取第一筆命中
    expect(result!.dealer).toEqual({ buy: 15000000, sell: 6000000, net: 9000000 });
  });

  it("still buckets legacy Chinese labels (no regression on any source that already returns Chinese)", async () => {
    const result = await resolveInstitutional(
      sources(
        Promise.resolve({
          asOf: "2026-07-22",
          totalNet: 100,
          institutions: [
            { name: "外資", buy: 100, sell: 40, net: 60 },
            { name: "投信", buy: 30, sell: 10, net: 20 },
            { name: "自營商(自行買賣)", buy: 8, sell: 3, net: 5 },
            { name: "自營商(避險)", buy: 2, sell: 1, net: 1 },
          ],
          topNetBuy: [],
          topNetSell: [],
          source: "finmind",
          state: "live",
        }),
      ),
    );

    expect(result!.foreign).toEqual({ buy: 100, sell: 40, net: 60 });
    expect(result!.invest).toEqual({ buy: 30, sell: 10, net: 20 });
    expect(result!.dealer).toEqual({ buy: 10, sell: 4, net: 6 });
  });

  it("returns null lines (not a throw) when institutions is genuinely empty", async () => {
    const result = await resolveInstitutional(
      sources(
        Promise.resolve({
          asOf: null,
          totalNet: null,
          institutions: [],
          topNetBuy: [],
          topNetSell: [],
          source: "finmind",
          state: "unavailable",
          reason: "no_token",
        }),
      ),
    );

    expect(result!.foreign).toBeNull();
    expect(result!.invest).toBeNull();
    expect(result!.dealer).toBeNull();
  });
});
