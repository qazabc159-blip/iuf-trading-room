/**
 * ui-vocab.test.ts
 *
 * translateNarrativeJargon()'s known-token table (P1-1,
 * reports/product_critique_20260710/PRODUCT_CRITIQUE_v1.md) plus the
 * catch-all fallback added 2026-07-12 (Pete #1226 review 🟡: "漏網 token
 * 裸英文"). The catch-all matches the general SHAPE of a leaked code
 * identifier (camelCase / snake_case / SCREAMING_SNAKE_CASE / key=value)
 * rather than a fixed vocabulary, so an unlisted future token still gets
 * swapped for an honest generic placeholder instead of printing raw.
 */
import { describe, expect, it } from "vitest";

import { humanizeEndpointLabel, MISSING_COMPANY_NAME_LABEL, translateNarrativeJargon } from "./ui-vocab";

describe("translateNarrativeJargon — known tokens (regression)", () => {
  it("translates dataAvailable=false/true", () => {
    expect(translateNarrativeJargon("company_graph_db 顯示 dataAvailable=false")).toBe("產業鏈定位資料庫 顯示 尚未回傳");
    expect(translateNarrativeJargon("dataAvailable=true")).toBe("已回傳");
  });

  it("translates itemCount=N with the captured count preserved", () => {
    expect(translateNarrativeJargon("get_company_news itemCount=0")).toBe("個股新聞來源 查無新項目");
    expect(translateNarrativeJargon("itemCount=5")).toBe("共 5 筆");
  });

  it("translates revenueYoyTrend with and without a trend qualifier", () => {
    expect(translateNarrativeJargon("revenueYoyTrend為accelerating")).toBe("營收年增趨勢轉強");
    expect(translateNarrativeJargon("revenueYoyTrend為decelerating")).toBe("營收年增趨勢轉弱");
    expect(translateNarrativeJargon("revenueYoyTrend 持平")).toBe("營收年增趨勢 持平");
  });

  it("translates bare trace/institutional/themes without touching trace=... clauses", () => {
    expect(translateNarrativeJargon("法人買超張數 trace 未提供，institutional 維持預設 8")).toBe("法人買超張數 資料軌跡 未提供，法人資料 維持預設 8");
    expect(translateNarrativeJargon("themes 尚無資料")).toBe("主題 尚無資料");
  });

  it("passes through plain Chinese narrative text unchanged", () => {
    const clean = "本檔近期外資買超明顯，法人籌碼轉強，建議留意量能變化。";
    expect(translateNarrativeJargon(clean)).toBe(clean);
  });
});

describe("translateNarrativeJargon — catch-all fallback (2026-07-12)", () => {
  it("replaces an unlisted lowerCamelCase identifier with an honest generic placeholder", () => {
    expect(translateNarrativeJargon("epsGrowthRate 顯示轉強訊號")).toBe("系統欄位 顯示轉強訊號");
  });

  it("replaces an unlisted snake_case identifier", () => {
    expect(translateNarrativeJargon("net_buy_amount 較上週放大")).toBe("系統欄位 較上週放大");
  });

  it("replaces an unlisted SCREAMING_SNAKE_CASE constant/error code", () => {
    expect(translateNarrativeJargon("後端回傳 QUANTITY_UNIT_REQUIRED 錯誤")).toBe("後端回傳 系統代碼 錯誤");
  });

  it("replaces an unlisted key=value clause as a whole (not just the key)", () => {
    expect(translateNarrativeJargon("volatilityFlag=true 觸發警示")).toBe("系統參數已處理 觸發警示");
  });

  it("does NOT touch legitimate bare acronyms/loanwords (no camelCase/snake_case/underscore shape)", () => {
    expect(translateNarrativeJargon("AI 認為 TAIEX 短線偏多，KGI 帳戶尚未同步")).toBe("AI 認為 TAIEX 短線偏多，KGI 帳戶尚未同步");
  });

  it("does NOT touch a single all-lowercase English word with no case/underscore split", () => {
    expect(translateNarrativeJargon("目前處於 portfolio 檢視模式")).toBe("目前處於 portfolio 檢視模式");
  });

  it("still prefers the specific, meaning-preserving translation over the catch-all for known tokens", () => {
    // volumeRatio20d is a known specific entry; the catch-all camelCase rule
    // would ALSO structurally match it, but the specific rule runs first and
    // consumes the token, so the catch-all never sees it.
    expect(translateNarrativeJargon("volumeRatio20d 明顯放大")).toBe("20日均量比 明顯放大");
  });

  it("catches an unlisted token even mid-sentence surrounded by other already-known tokens", () => {
    expect(translateNarrativeJargon("company_graph_db 顯示 unseenNewField=true，institutional 維持預設")).toBe(
      "產業鏈定位資料庫 顯示 系統參數已處理，法人資料 維持預設"
    );
  });
});

describe("humanizeEndpointLabel", () => {
  it("maps known endpoints to human labels", () => {
    expect(humanizeEndpointLabel("GET /api/v1/recommendations/today")).toBe("AI 推薦來源");
  });

  it("ignores query strings for lookup", () => {
    expect(humanizeEndpointLabel("GET /api/v1/market-intel/news-top10?limit=10")).toBe("AI 新聞精選來源");
  });

  it("never prints an unknown raw route", () => {
    expect(humanizeEndpointLabel("GET /api/v1/some/new/route")).toBe("資料來源");
  });

  it("handles null/undefined", () => {
    expect(humanizeEndpointLabel(null)).toBe("資料來源");
    expect(humanizeEndpointLabel(undefined)).toBe("資料來源");
  });
});

describe("MISSING_COMPANY_NAME_LABEL", () => {
  it("is a non-empty honest placeholder, not the ticker repeated as a fake name", () => {
    expect(MISSING_COMPANY_NAME_LABEL).toBe("名稱待補");
  });
});
