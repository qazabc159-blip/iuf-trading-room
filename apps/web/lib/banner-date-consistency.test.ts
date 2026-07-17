/**
 * banner-date-consistency.test.ts — 2026-07-18 banner-date-unify invariant lock.
 *
 * 楊董反覆抓到跨頁「顯示 MM/DD 收盤資料」banner 日期不一致（同一個交易日，公司頁 /
 * AI 推薦頁顯示 07/16，首頁顯示 07/17）。這個測試鎖住修好之後的不變式：
 * 不管哪一頁、不管後端哪一個來源（UTC "Z" 格式或 Taipei-local "+08:00" 格式）
 * 被 resolver 選中，最終顯示給使用者的 "MM/DD (weekday)" 標籤必須完全一致 —
 * 這條測試若紅，代表某處又重新長出了獨立、互相不知道對方存在的日期格式化邏輯。
 */
import { describe, expect, it, vi } from "vitest";
import { resolveBannerLastCloseDate } from "./index-snapshot-freshness";
import { formatTradeDateWithWeekday } from "./market-state-banner";

const { getMarketDataOverviewMock, getTwseMarketOverviewMock } = vi.hoisted(() => ({
  getMarketDataOverviewMock: vi.fn(),
  getTwseMarketOverviewMock: vi.fn(),
}));

vi.mock("./api", () => ({
  getMarketDataOverview: getMarketDataOverviewMock,
  getTwseMarketOverview: getTwseMarketOverviewMock,
}));

describe("cross-page banner date invariant", () => {
  it("company/ai-recommendations (resolveBannerLastCloseDate, UTC-format winning candidate) renders the SAME label as the homepage's Taipei-local-format KGI source, for the same real trading day", async () => {
    // Real prod shapes captured 2026-07-18 for the 2026-07-17 (Fri) close:
    getMarketDataOverviewMock.mockResolvedValueOnce({
      data: {
        marketContext: {
          index: { state: "STALE", last: 42671.27, timestamp: "2026-07-16T16:00:00.000Z" },
        },
      },
    });
    getTwseMarketOverviewMock.mockResolvedValueOnce({
      taiex: { value: 42671.27, change: -2953.71, changePct: -6.47, ts: "2026-07-17T13:30:00+08:00" },
    });

    const companyPageDate = await resolveBannerLastCloseDate();
    const companyPageLabel = formatTradeDateWithWeekday(companyPageDate);

    // The homepage's readMarketIndex() KGI branch (when available) feeds
    // <MarketStateBanner lastCloseDate={kgi.ts}> directly with a
    // Taipei-local "+08:00" timestamp for the same trading day.
    const homepageKgiTs = "2026-07-17T13:30:00+08:00";
    const homepageLabel = formatTradeDateWithWeekday(homepageKgiTs);

    expect(companyPageLabel).toBe("07/17 (五)");
    expect(companyPageLabel).toBe(homepageLabel);
  });

  it("resolveBannerLastCloseDate's resolved date, whichever source wins, ALWAYS formats to the same label as its own Taipei calendar date reference", async () => {
    // Order-flip sanity: even if twse_overview (Taipei-local format) were the
    // one that won the comparison instead of market_context_index (UTC
    // format), the rendered label must not change — same trading day.
    getMarketDataOverviewMock.mockResolvedValueOnce({
      data: { marketContext: { index: { state: "EMPTY", last: null, timestamp: null } } },
    });
    getTwseMarketOverviewMock.mockResolvedValueOnce({
      taiex: { value: 42671.27, change: -2953.71, changePct: -6.47, ts: "2026-07-17T13:30:00+08:00" },
    });

    const resolved = await resolveBannerLastCloseDate();
    expect(formatTradeDateWithWeekday(resolved)).toBe("07/17 (五)");
  });
});
