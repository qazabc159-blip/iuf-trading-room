import { describe, expect, it } from "vitest";

import { humanizeDataReason } from "./data-reason-copy";

describe("humanizeDataReason", () => {
  it("humanizes the exact dataset id 楊董 caught in prod (side-panel widget)", () => {
    expect(humanizeDataReason("official_daily_index")).toBe("使用官方日線指數（非即時報價來源）");
  });

  it("humanizes every other known engineering token that can flow through marketContext.index.reason", () => {
    expect(humanizeDataReason("market_index_daily_missing")).toBe("官方日線指數尚未提供今日資料");
    expect(humanizeDataReason("market_index_quote_missing")).toBe("即時報價來源目前沒有指數資料");
    expect(humanizeDataReason("missing_quote")).toBe("目前沒有可用報價");
    expect(humanizeDataReason("synthetic_source")).toBe("來源為推算值，非即時報價");
    expect(humanizeDataReason("non_live_source")).toBe("來源非即時報價管道");
    expect(humanizeDataReason("provider_disconnected")).toBe("報價來源暫時斷線");
  });

  it("humanizes fallback:/stale: prefixed dynamic tokens (QuoteResolutionFallbackReason / QuoteResolutionStaleReason enum members)", () => {
    expect(humanizeDataReason("fallback:higher_priority_stale")).toBe("優先來源資料已過期");
    expect(humanizeDataReason("fallback:no_fresh_quote")).toBe("沒有最新報價可用");
    expect(humanizeDataReason("stale:age_exceeded")).toBe("資料已超過新鮮度上限");
    expect(humanizeDataReason("stale:provider_unavailable")).toBe("報價來源暫時無法使用");
  });

  // 2026-07-19 #1309 Pete review 🔴: /quote 頁 reasonLabel() 完全沒對到
  // buildEffectiveQuoteReasons() 實際吐出的字串，這裡直接鎖住 Pete report 點名
  // 的那組真實 reasons[] 內容（每個都是 apps/web/app/quote/page.tsx 逐一 map
  // 的單一 token，非 comma-joined 字串，但 humanizeDataReason 對單一 token 一樣
  // 適用）。
  it("humanizes every literal token PR #1309's Pete review flagged as leaking raw on /quote (single-token form, as page.tsx consumes them)", () => {
    expect(humanizeDataReason("fallback:no_fresh_quote")).toBe("沒有最新報價可用");
    expect(humanizeDataReason("stale:age_exceeded")).toBe("資料已超過新鮮度上限");
    expect(humanizeDataReason("non_live_source")).toBe("來源非即時報價管道");
    expect(humanizeDataReason("provider_disconnected")).toBe("報價來源暫時斷線");
    expect(humanizeDataReason("missing_quote")).toBe("目前沒有可用報價");
  });

  it("humanizes the official_close fallback-tier's own reason tokens (round 2, 2026-07-19)", () => {
    expect(humanizeDataReason("official_close_snapshot")).toBe("非交易時段，顯示最近收盤價");
    expect(humanizeDataReason("official_close_stale_intraday_fallback")).toBe(
      "盤中即時報價中斷，暫以最近收盤價顯示",
    );
  });

  it("humanizes comma-joined multi-token reasons (indexRow.item.reasons.join(', ')) and de-dupes repeated labels", () => {
    expect(humanizeDataReason("missing_quote, fallback:no_fresh_quote")).toBe(
      "目前沒有可用報價、沒有最新報價可用",
    );
  });

  it("falls back to an honest generic phrase for an unknown/unmapped engineering-shaped token — never prints the raw id", () => {
    const result = humanizeDataReason("some_future_backend_reason_code");
    expect(result).toBe("資料延遲原因暫未提供");
    expect(result).not.toContain("some_future_backend_reason_code");
  });

  it("falls back honestly when only SOME tokens in a joined list are unknown", () => {
    expect(humanizeDataReason("missing_quote, a_brand_new_code")).toBe(
      "目前沒有可用報價、資料延遲原因暫未提供",
    );
  });

  it("passes through already-human reason strings unmodified (caller-owned copy, not this layer's job)", () => {
    expect(humanizeDataReason("3/8 檔尚未計價")).toBe("3/8 檔尚未計價");
    expect(humanizeDataReason("非交易時段")).toBe("非交易時段");
  });

  it("passes through null/undefined/empty unchanged", () => {
    expect(humanizeDataReason(null)).toBeNull();
    expect(humanizeDataReason(undefined)).toBeNull();
    expect(humanizeDataReason("")).toBe("");
  });
});
