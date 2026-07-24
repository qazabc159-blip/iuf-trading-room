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

  // 2026-07-24: found via real prod verification of #1362 leadSummary/
  // themeContext consumption — the field-name translations above
  // (chainPosition/beneficiaryTier) fire, but the raw ENUM VALUE the system
  // prompt templates right after it (受惠層級=[beneficiaryTier], lifecycle=
  // [lifecycle]) used to survive untouched because neither the specific
  // rules above nor the catch-all's key=value alternation (only true/false/
  // number/quoted-string) match a bare identifier value like "Observation".
  it("translates the closed beneficiaryTier/lifecycle enum values, not just their field names — exact real prod leak text", () => {
    const real = "供應鏈定位Computer Hardware，受惠層級=Observation，主題含NVIDIA與5G通訊且lifecycle=Discovery";
    const out = translateNarrativeJargon(real);
    expect(out).toBe("供應鏈定位Computer Hardware，受惠層級=觀察名單，主題含NVIDIA與5G通訊且lifecycle=探索期");
    expect(out).not.toMatch(/\bObservation\b|\bDiscovery\b/);
  });

  // 2026-07-24 Pete-15 review: the 9 entries are ALSO ordinary English finance
  // vocabulary (Core Holding / Price Discovery / Crowded Trade / dividend
  // Distribution), so they only fire when directly adjacent to the `=`/`：`/`:`
  // character the real backend leak always has right before them — a bare
  // word with no such prefix is left untouched instead of being
  // mistranslated.
  it("translates all 4 beneficiaryTier values and all 5 theme lifecycle values ONLY when adjacent to = / ： / :", () => {
    expect(translateNarrativeJargon("受惠層級=Core")).toBe("受惠層級=核心受惠");
    expect(translateNarrativeJargon("beneficiaryTier=Direct")).toBe("受惠層級=直接受惠");
    expect(translateNarrativeJargon("beneficiaryTier=Indirect")).toBe("受惠層級=間接受惠");
    expect(translateNarrativeJargon("beneficiaryTier=Observation")).toBe("受惠層級=觀察名單");
    expect(translateNarrativeJargon("lifecycle=Discovery")).toBe("lifecycle=探索期");
    expect(translateNarrativeJargon("lifecycle=Validation")).toBe("lifecycle=驗證期");
    expect(translateNarrativeJargon("lifecycle=Expansion")).toBe("lifecycle=擴張期");
    expect(translateNarrativeJargon("lifecycle=Crowded")).toBe("lifecycle=擁擠期");
    expect(translateNarrativeJargon("lifecycle=Distribution")).toBe("lifecycle=出貨期");
    expect(translateNarrativeJargon("狀態：Observation")).toBe("狀態：觀察名單");
  });

  it("does NOT mistranslate the same 9 words when they appear as ordinary standalone English finance vocabulary (no = / ： / : adjacency)", () => {
    expect(translateNarrativeJargon("外資將此列為 Core Holding")).toBe("外資將此列為 Core Holding");
    expect(translateNarrativeJargon("市場正處於 Price Discovery 階段")).toBe("市場正處於 Price Discovery 階段");
    expect(translateNarrativeJargon("籌碼面出現 Crowded Trade 訊號需留意")).toBe("籌碼面出現 Crowded Trade 訊號需留意");
    expect(translateNarrativeJargon("本季配息 Distribution 金額提高")).toBe("本季配息 Distribution 金額提高");
    expect(translateNarrativeJargon("主題含NVIDIA與5G通訊，Discovery 型標的")).toBe("主題含NVIDIA與5G通訊，Discovery 型標的");
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
