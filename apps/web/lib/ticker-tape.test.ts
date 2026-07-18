import { describe, expect, it } from "vitest";

import {
  deriveTickerDisplay,
  formatTickerNumber,
  formatTickerPct,
  shouldRenderTickerTape,
  tickerDirection,
} from "./ticker-tape";
import type { MarketDataOverview } from "./api";

function baseOverview(overrides: Partial<MarketDataOverview["marketContext"]> = {}): MarketDataOverview {
  return {
    generatedAt: "2026-07-10T05:00:00.000Z",
    providers: [],
    marketContext: {
      state: "LIVE",
      source: "twse_mis_intraday",
      index: {
        state: "LIVE",
        symbol: "t00",
        market: "TW_INDEX",
        name: "加權指數",
        source: "twse_mis_intraday",
        last: 43225.54,
        change: 76.08,
        changePct: 0.18,
        timestamp: "2026-07-10T05:00:00.000Z",
        freshnessStatus: "fresh",
        reason: null,
      },
      breadth: { state: "LIVE", up: 500, down: 400, flat: 100, total: 1000, updatedAt: null, source: "mis", reason: null },
      heatmap: [
        { symbol: "2330", market: "TW", name: "台積電", source: "mis", last: 1105, changePct: 1.38, volume: 100, timestamp: "t", weight: 30, readiness: "ready", freshnessStatus: "fresh" },
        { symbol: "2317", market: "TW", name: "鴻海", source: "mis", last: 210.5, changePct: -0.47, volume: 50, timestamp: "t", weight: 12, readiness: "ready", freshnessStatus: "fresh" },
      ],
      ...overrides,
    },
    symbols: { total: 0, byMarket: [] },
    quotes: {
      total: 0, fresh: 0, stale: 0, latestQuoteTimestamp: null,
      readiness: { connectedSources: [], disconnectedSources: [], preferredSourceOrder: [], effectiveSelection: { total: 0, ready: 0, degraded: 0, blocked: 0, strategyUsable: 0, paperUsable: 0, liveUsable: 0 } },
      bySource: [], byMarket: [],
    },
    quality: { evaluatedSymbols: 0, history: { ready: 0, degraded: 0, blocked: 0, total: 0 }, bars: { ready: 0, degraded: 0, blocked: 0, total: 0 } },
    leaders: { topGainers: [], topLosers: [], mostActive: [] },
  } as unknown as MarketDataOverview;
}

const MONDAY_TRADING_HOURS = new Date("2026-07-13T02:30:00.000Z"); // 2026-07-13 is a Monday, 10:30 Taipei
const SUNDAY = new Date("2026-07-12T02:30:00.000Z");
// 2026-07-19 側欄健康 widget 修復 fixture: 2026-07-18 is a Saturday — Elva 派工
// 指定的 non-trading-day fixture（末交易日 07/17 資料在架上，不應判「延遲」）。
const SATURDAY_20260718 = new Date("2026-07-18T02:30:00.000Z"); // 10:30 Taipei

describe("deriveTickerDisplay", () => {
  it("returns empty state with honest reason when overview is null", () => {
    const result = deriveTickerDisplay(null);
    expect(result.dataState).toBe("empty");
    expect(result.reason).toBeTruthy();
    expect(result.index).toBeNull();
    expect(result.stocks).toEqual([]);
  });

  it("maps LIVE backend state + trading hours to 'live'", () => {
    const result = deriveTickerDisplay(baseOverview(), MONDAY_TRADING_HOURS);
    expect(result.dataState).toBe("live");
    expect(result.index?.label).toBe("加權指數");
    expect(result.stocks).toHaveLength(2);
    expect(result.stocks[0].symbol).toBe("2330");
  });

  it("maps LIVE backend state outside trading hours to 'close' (honest, not fake-live)", () => {
    const result = deriveTickerDisplay(baseOverview(), SUNDAY);
    expect(result.dataState).toBe("close");
    expect(result.asOf).toBe("2026-07-10T05:00:00.000Z");
  });

  it("maps STALE backend state to 'delayed' with reason on a TRADING day (真的可能是資料同步延遲)", () => {
    const overview = baseOverview();
    overview.marketContext.state = "STALE";
    overview.marketContext.index!.reason = "3/8 檔尚未計價";
    const result = deriveTickerDisplay(overview, MONDAY_TRADING_HOURS);
    expect(result.dataState).toBe("delayed");
    expect(result.reason).toBe("3/8 檔尚未計價");
  });

  it("2026-07-19 側欄健康 widget 修復: STALE backend state on a NON-trading day (weekend) maps to 'close', never 'delayed' — 末交易日資料在架上是預期中的正常狀態", () => {
    const overview = baseOverview();
    overview.marketContext.state = "STALE";
    overview.marketContext.index!.reason = "official_daily_index";
    overview.marketContext.index!.timestamp = "2026-07-17T05:30:00.000Z";
    const result = deriveTickerDisplay(overview, SATURDAY_20260718);
    expect(result.dataState).toBe("close");
    expect(result.reason).toBeNull();
    expect(result.asOf).toBe("2026-07-17T05:30:00.000Z");
  });

  it("STALE + engineering-shaped reason id (e.g. official_daily_index) is humanized before reaching the display model on a trading day — never the raw dataset id", () => {
    const overview = baseOverview();
    overview.marketContext.state = "STALE";
    overview.marketContext.index!.reason = "official_daily_index";
    const result = deriveTickerDisplay(overview, MONDAY_TRADING_HOURS);
    expect(result.dataState).toBe("delayed");
    expect(result.reason).toBe("使用官方日線指數（非即時報價來源）");
    expect(result.reason).not.toContain("official_daily_index");
  });

  it("maps EMPTY backend state to 'empty' and still passes through nothing fake", () => {
    const overview = baseOverview();
    overview.marketContext.state = "EMPTY";
    overview.marketContext.index = null as never;
    overview.marketContext.heatmap = [];
    const result = deriveTickerDisplay(overview, MONDAY_TRADING_HOURS);
    expect(result.dataState).toBe("empty");
    expect(result.index).toBeNull();
    expect(result.stocks).toEqual([]);
  });

  it("maps BLOCKED backend state to 'empty'", () => {
    const overview = baseOverview();
    overview.marketContext.state = "BLOCKED";
    const result = deriveTickerDisplay(overview, MONDAY_TRADING_HOURS);
    expect(result.dataState).toBe("empty");
  });

  it("caps stock items and drops tiles without a symbol", () => {
    const overview = baseOverview();
    const manyTiles = Array.from({ length: 20 }, (_, i) => ({
      symbol: `S${i}`, market: "TW", name: `stock${i}`, source: "mis",
      last: 100, changePct: 1, volume: 1, timestamp: "t", weight: 1,
      readiness: "ready" as const, freshnessStatus: "fresh" as const,
    }));
    overview.marketContext.heatmap = [...manyTiles, { symbol: "", market: "TW", name: "", source: "mis", last: null, changePct: null, volume: null, timestamp: "t", weight: 0, readiness: "ready", freshnessStatus: "missing" }];
    const result = deriveTickerDisplay(overview, MONDAY_TRADING_HOURS);
    expect(result.stocks.length).toBeLessThanOrEqual(15);
    expect(result.stocks.every((s) => s.symbol.length > 0)).toBe(true);
  });
});

describe("formatTickerNumber", () => {
  it("formats finite numbers with fixed digits", () => {
    expect(formatTickerNumber(43225.5)).toBe("43,225.50");
    expect(formatTickerNumber(1105, 1)).toBe("1,105.0");
  });

  it("shows honest placeholder for missing/non-finite values", () => {
    expect(formatTickerNumber(null)).toBe("--");
    expect(formatTickerNumber(undefined)).toBe("--");
    expect(formatTickerNumber(NaN)).toBe("--");
  });
});

describe("formatTickerPct", () => {
  it("prefixes positive values with +", () => {
    expect(formatTickerPct(1.38)).toBe("+1.38%");
  });
  it("keeps native minus sign for negative values", () => {
    expect(formatTickerPct(-0.47)).toBe("-0.47%");
  });
  it("shows honest placeholder for missing values", () => {
    expect(formatTickerPct(null)).toBe("--");
  });
});

describe("tickerDirection", () => {
  it("classifies up/down/flat by Taiwan convention (caller applies red=up/green=down colors)", () => {
    expect(tickerDirection(1.5)).toBe("up");
    expect(tickerDirection(-1.5)).toBe("down");
    expect(tickerDirection(0)).toBe("flat");
    expect(tickerDirection(null)).toBe("flat");
  });
});

describe("shouldRenderTickerTape", () => {
  it("skips login/register/mobile-brief routes", () => {
    expect(shouldRenderTickerTape("/login")).toBe(false);
    expect(shouldRenderTickerTape("/register")).toBe(false);
    expect(shouldRenderTickerTape("/m")).toBe(false);
    expect(shouldRenderTickerTape("/m/kill")).toBe(false);
  });

  it("skips /forgot-password and /reset-password (楊董 2026-07-17 prod report: the empty-state 行情資料暫時無法讀取 banner was leaking onto these authv3 recovery pages, which were missed from the original login/register skip-list sweep)", () => {
    expect(shouldRenderTickerTape("/forgot-password")).toBe(false);
    expect(shouldRenderTickerTape("/reset-password")).toBe(false);
  });

  it("skips every /settings sub-page (2026-07-18 全產品走查: account/broker/subscription 內容跟行情無關, 冒出的 empty-state 錯誤字樣會讓使用者誤判設定頁壞掉)", () => {
    expect(shouldRenderTickerTape("/settings/account")).toBe(false);
    expect(shouldRenderTickerTape("/settings/broker")).toBe(false);
    expect(shouldRenderTickerTape("/settings/subscription")).toBe(false);
  });

  it("skips the homepage (already has its own real-data .tac-ticker)", () => {
    expect(shouldRenderTickerTape("/")).toBe(false);
  });

  it("skips FinalOnlyFrame full-bleed iframe wrapper pages (ticker would be covered/off-screen, Pete review 2026-07-10)", () => {
    expect(shouldRenderTickerTape("/portfolio")).toBe(false);
    expect(shouldRenderTickerTape("/market-intel")).toBe(false);
    expect(shouldRenderTickerTape("/final-v031/portfolio")).toBe(false);
    expect(shouldRenderTickerTape("/final-v031/portfolio/kline-frame")).toBe(false);
    expect(shouldRenderTickerTape("/final-v031/market-intel")).toBe(false);
    expect(shouldRenderTickerTape("/final-v031/ideas")).toBe(false);
  });

  it("skips /desk-exact (FinalOnlyFrame consumer added 2026-07-14, missed the original skip-list sweep — the extra 32px ticker pushed the order ticket's bottom rows below the fold, 楊董 2026-07-15 report)", () => {
    expect(shouldRenderTickerTape("/desk-exact")).toBe(false);
  });

  it("does NOT prefix-swallow /portfolio's real non-wrapper sibling route", () => {
    expect(shouldRenderTickerTape("/portfolio/snapshots")).toBe(true);
  });

  it("renders on regular product pages", () => {
    expect(shouldRenderTickerTape("/companies/2330")).toBe(true);
    expect(shouldRenderTickerTape("/track-record")).toBe(true);
    expect(shouldRenderTickerTape(null)).toBe(true);
  });
});
