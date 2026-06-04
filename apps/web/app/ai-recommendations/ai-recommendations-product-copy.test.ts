import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

describe("AI recommendations product copy", () => {
  it("does not render raw strategy/debug labels in customer recommendation cards", () => {
    expect(source).toContain("function cleanRecommendationText");
    expect(source).toContain("function formatGateStatus");
    expect(source).toContain("function formatStrategySource");
    expect(source).toContain("{formatGateStatus(rec.quant.gateStatus)}");
    expect(source).toContain("量化分數 {rec.quant.score}");
    expect(source).toContain("{formatStrategySource(rec.quant.strategySource)}");
    expect(source).toContain("{cleanRecommendationText(source.source, \"來源待確認\")}");

    expect(source).not.toContain("{rec.quant.gateStatus}</span>");
    expect(source).not.toContain("Quant {rec.quant.score}");
    expect(source).not.toContain("{rec.quant.strategySource}</small>");
    expect(source).not.toContain(">{source.source}");
  });
});
