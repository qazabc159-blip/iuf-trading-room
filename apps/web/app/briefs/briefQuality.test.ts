import { describe, expect, it } from "vitest";

import { evaluateBriefQuality } from "./briefQuality";

describe("daily brief quality gate", () => {
  it("allows the fixed daily brief v2 contract", () => {
    const result = evaluateBriefQuality({
      sections: [
        { heading: "市場總覽", body: "今日市場整理與資料時間。" },
        { heading: "AI 精選重點", body: "AI 篩選後的重點，包含 why matters 與來源。" },
        { heading: "產業與主題", body: "產業與主題變化。" },
        { heading: "風險觀察", body: "資料風險與市場風險。" },
        { heading: "資料來源狀態", body: "LIVE / STALE / EMPTY / BLOCKED 狀態。" },
      ],
    });

    expect(result.displayable).toBe(true);
    expect(result.missingHeadings).toEqual([]);
  });

  it("blocks legacy English heading dumps", () => {
    const result = evaluateBriefQuality({
      sections: [
        { heading: "Market Overview", body: "Market State: Balanced Active Themes: AI servers" },
        { heading: "Theme Summaries", body: "Theme: 5G Lifecycle: Discovery Linked Companies: 169" },
        { heading: "Company Notes", body: "Notes" },
      ],
    });

    expect(result.displayable).toBe(false);
    expect(result.hasLegacyHeading).toBe(true);
    expect(result.hasRawDump).toBe(true);
    expect(result.missingHeadings).toContain("AI 精選重點");
  });
});
