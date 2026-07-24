import { describe, expect, it } from "vitest";
import {
  buildMarketRiskOffCopy,
  editionDateLabel,
  fmtConfidence,
  fmtMultiplier,
  fmtPrice,
  fmtRValue,
  fmtScore,
  generationStatusLabel,
  officialAnnouncementLabel,
  parseReportMarkdownLines,
  rankLabel,
  resolveLeadSummaryText,
  resolveMorningBriefBodyMode,
  resolveThemeContextDisplay,
  splitParagraphs,
} from "./morning-brief-copy";

describe("rankLabel", () => {
  it("maps index 0-4 to 序位第一/貳/叁/肆/伍", () => {
    expect(rankLabel(0)).toBe("序位第一");
    expect(rankLabel(1)).toBe("貳");
    expect(rankLabel(2)).toBe("叁");
    expect(rankLabel(3)).toBe("肆");
    expect(rankLabel(4)).toBe("伍");
  });

  it("falls back to a numbered label beyond the 5-card design", () => {
    expect(rankLabel(5)).toBe("第 6 名");
  });
});

describe("splitParagraphs", () => {
  it("splits on newline and drops empty lines", () => {
    expect(splitParagraphs("第一段\n\n第二段\n")).toEqual(["第一段", "第二段"]);
  });

  it("returns empty array for null/empty (honest empty, not a fake paragraph)", () => {
    expect(splitParagraphs(null)).toEqual([]);
    expect(splitParagraphs("")).toEqual([]);
  });
});

describe("editionDateLabel", () => {
  it("extracts the date segment and appends 收盤", () => {
    expect(editionDateLabel("07/22 08:33")).toBe("07/22 收盤");
  });

  it("returns -- when there is no usable date", () => {
    expect(editionDateLabel("-")).toBe("--");
    expect(editionDateLabel("")).toBe("--");
  });
});

describe("officialAnnouncementLabel", () => {
  it("maps every known sourceState to a human label", () => {
    expect(officialAnnouncementLabel("live")).toBe("已納入");
    expect(officialAnnouncementLabel("empty")).toBe("已檢查無公告");
    expect(officialAnnouncementLabel("degraded")).toBe("降級");
    expect(officialAnnouncementLabel("pending")).toBe("待接入");
    expect(officialAnnouncementLabel("unknown_state")).toBe("待確認");
  });
});

describe("generationStatusLabel", () => {
  it("only 'complete' renders as 完成", () => {
    expect(generationStatusLabel("complete")).toBe("完成");
    expect(generationStatusLabel("running")).toBe("需留意");
    expect(generationStatusLabel(null)).toBe("需留意");
    expect(generationStatusLabel(undefined)).toBe("需留意");
  });
});

describe("number formatters — null/undefined never render as fake 0 or blank", () => {
  it("fmtPrice", () => {
    expect(fmtPrice(445.5)).toBe("445.5");
    expect(fmtPrice(null)).toBe("--");
    expect(fmtPrice(undefined)).toBe("--");
  });

  it("fmtScore", () => {
    expect(fmtScore(10, 20)).toBe("10/20");
    expect(fmtScore(null, 20)).toBe("--");
  });

  it("fmtConfidence", () => {
    expect(fmtConfidence(0.74)).toBe("74%");
    expect(fmtConfidence(null)).toBe("--");
  });

  it("fmtRValue", () => {
    expect(fmtRValue(1.1)).toBe("1.10R");
    expect(fmtRValue(null)).toBe("--");
  });

  it("fmtMultiplier", () => {
    expect(fmtMultiplier(0.9)).toBe("0.9");
    expect(fmtMultiplier(null)).toBe("--");
  });
});

// Verbatim (whitespace-for-whitespace) reproduction of the real backend
// template in apps/api/src/ai-recommendation-v2/orchestrator-v3.ts
// (runAiRecommendationV3Body, market_risk_off short-circuit branch) with
// S3/S6 not triggered — those two template lines render as empty strings,
// which is exactly the case this fixture exercises (consecutive bullets with
// no separating blank-line artifact left behind).
const REAL_RISK_OFF_MARKDOWN = `## 市場 risk-off — 暫不推薦新倉（系統程式判斷）

系統計算 programmatic risk_off_score = 4/6，達到 ≥3 閘門。
依楊董 SOP，risk_off_score >= 3 時不開新 beta 倉，待事件過後重新評估。

觸發訊號（4/6）:
- S1: VIX > 25 ✓
- S2: VIX 5d 漲 > 30% ✓

- S4: 10Y 20d 漲 > 25bp ✓
- S5: WTI 10d 漲 > 10% ✓
`.trim();

describe("parseReportMarkdownLines", () => {
  it("parses the real backend risk-off report template into heading/bullet/text lines, stripping markdown syntax characters", () => {
    const lines = parseReportMarkdownLines(REAL_RISK_OFF_MARKDOWN);

    expect(lines[0]).toEqual({ kind: "heading", text: "市場 risk-off — 暫不推薦新倉（系統程式判斷）" });
    // "##"/"- " markdown syntax characters must not survive into any parsed text
    for (const line of lines) {
      expect(line.text.startsWith("#")).toBe(false);
      expect(line.text.startsWith("- ")).toBe(false);
    }
    const bullets = lines.filter((line) => line.kind === "bullet").map((line) => line.text);
    expect(bullets).toEqual([
      "S1: VIX > 25 ✓",
      "S2: VIX 5d 漲 > 30% ✓",
      "S4: 10Y 20d 漲 > 25bp ✓",
      "S5: WTI 10d 漲 > 10% ✓",
    ]);
  });

  it("returns an empty array for null/undefined/empty markdown (honest empty, not a fake report)", () => {
    expect(parseReportMarkdownLines(null)).toEqual([]);
    expect(parseReportMarkdownLines(undefined)).toEqual([]);
    expect(parseReportMarkdownLines("")).toEqual([]);
  });
});

describe("buildMarketRiskOffCopy — 產品鐵律：不准把內部狀態字串秀給使用者", () => {
  it("includes the real score number when marketRiskOffScore is present", () => {
    const copy = buildMarketRiskOffCopy(4);
    expect(copy.subtitle).toContain("4/6");
    expect(copy.title).not.toMatch(/market_risk_off/i);
    expect(copy.subtitle).not.toMatch(/market_risk_off/i);
  });

  it("falls back to an honest score-less sentence when marketRiskOffScore is null (e.g. DB-reconstructed run)", () => {
    const copy = buildMarketRiskOffCopy(null);
    expect(copy.subtitle).not.toContain("/6");
    expect(copy.title).not.toMatch(/market_risk_off/i);
    expect(copy.subtitle).not.toMatch(/market_risk_off/i);
  });
});

describe("resolveMorningBriefBodyMode", () => {
  it("prioritizes risk_off even when cardCount is 0 and there is no error — must NOT fall into the generic 'engine hasn't returned data' empty branch", () => {
    expect(
      resolveMorningBriefBodyMode({ status: "market_risk_off", error: null, cardCount: 0 }),
    ).toBe("risk_off");
  });

  it("prioritizes risk_off even if (hypothetically) cardCount were non-zero", () => {
    expect(
      resolveMorningBriefBodyMode({ status: "market_risk_off", error: null, cardCount: 3 }),
    ).toBe("risk_off");
  });

  it("falls back to empty when cardCount is 0 and status is a normal (non risk-off) status", () => {
    expect(
      resolveMorningBriefBodyMode({ status: "complete", error: null, cardCount: 0 }),
    ).toBe("empty");
  });

  it("falls back to empty when there is a fetch error, regardless of status", () => {
    expect(
      resolveMorningBriefBodyMode({ status: "complete", error: "401 unauthenticated", cardCount: 5 }),
    ).toBe("empty");
  });

  it("returns cards for the normal happy path", () => {
    expect(
      resolveMorningBriefBodyMode({ status: "complete", error: null, cardCount: 5 }),
    ).toBe("cards");
  });
});

// #1362 backend fields: leadSummary (頭版摘要句) + themeContext (主題/供應鏈脈絡)
describe("resolveLeadSummaryText — 頭版 deck", () => {
  it("renders the real backend value verbatim when present", () => {
    expect(resolveLeadSummaryText("月營收YoY+22%連加速+外資買超+技術面突破月線"))
      .toBe("月營收YoY+22%連加速+外資買超+技術面突破月線");
  });

  it("falls back to an honest sentence (not an empty gap) when null — deterministic fallback items have no LLM one-liner", () => {
    expect(resolveLeadSummaryText(null)).toBe("AI 尚未為此檔產出頭版摘要句。");
    expect(resolveLeadSummaryText(undefined)).toBe("AI 尚未為此檔產出頭版摘要句。");
  });

  it("treats a blank/whitespace-only string the same as null (no invisible deck line)", () => {
    expect(resolveLeadSummaryText("   ")).toBe("AI 尚未為此檔產出頭版摘要句。");
  });
});

describe("resolveThemeContextDisplay — 主題/供應鏈脈絡", () => {
  it("returns null (caller must not render the block) when themeContext itself is null — tool never called for this ticker", () => {
    expect(resolveThemeContextDisplay(null)).toBeNull();
    expect(resolveThemeContextDisplay(undefined)).toBeNull();
  });

  it("returns null when dataAvailable is false — tool was called but company_graph_db has no row; must NOT render a fixed gapnote sentence (Pete-12 review)", () => {
    expect(
      resolveThemeContextDisplay({
        dataAvailable: false,
        chainPosition: null,
        beneficiaryTier: null,
        themes: [],
      }),
    ).toBeNull();
  });

  it("renders human-Chinese labels for the closed beneficiaryTier/lifecycle enums, and passes chainPosition through verbatim (free-text field, not an enum)", () => {
    const display = resolveThemeContextDisplay({
      dataAvailable: true,
      chainPosition: "CoAP_Chip",
      beneficiaryTier: "Core",
      themes: [{ name: "AI 伺服器", lifecycle: "Expansion" }],
    });

    expect(display?.positionLine).toBe("CoAP_Chip．核心受惠");
    expect(display?.themesLine).toBe("相關主題：AI 伺服器（擴張期）");
    // beneficiaryTier/lifecycle raw enum codes must never leak into the rendered line
    expect(`${display?.positionLine}${display?.themesLine}`).not.toMatch(/\bCore\b|\bExpansion\b/);
  });

  it("omits individual lines honestly when a sub-field is empty, instead of fabricating filler text", () => {
    const display = resolveThemeContextDisplay({
      dataAvailable: true,
      chainPosition: null,
      beneficiaryTier: null,
      themes: [{ name: "電動車", lifecycle: "Validation" }],
    });

    expect(display?.positionLine).toBeNull();
    expect(display?.themesLine).toBe("相關主題：電動車（驗證期）");
  });

  it("returns null (no empty-header box) when dataAvailable is true but every sub-field is empty", () => {
    expect(
      resolveThemeContextDisplay({
        dataAvailable: true,
        chainPosition: null,
        beneficiaryTier: null,
        themes: [],
      }),
    ).toBeNull();
  });
});
