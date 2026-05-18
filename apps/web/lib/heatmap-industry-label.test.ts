import { describe, expect, it } from "vitest";

import { heatmapIndustryLabel } from "./heatmap-industry-label";

describe("heatmapIndustryLabel", () => {
  it("normalizes common Yahoo/TWSE English sector buckets to Taiwan-market Chinese labels", () => {
    expect(heatmapIndustryLabel("Semiconductors")).toBe("半導體");
    expect(heatmapIndustryLabel("Computer Hardware")).toBe("電腦及週邊設備");
    expect(heatmapIndustryLabel("Banks")).toBe("金融保險");
    expect(heatmapIndustryLabel("Communication Equipment")).toBe("通信網路");
  });

  it("does not leak unknown ASCII sector dumps into the product UI", () => {
    expect(heatmapIndustryLabel("Special Purpose Acquisition Shell")).toBe("其他產業");
  });

  it("preserves already-localized Taiwan-market labels", () => {
    expect(heatmapIndustryLabel("航運業")).toBe("航運業");
  });
});
