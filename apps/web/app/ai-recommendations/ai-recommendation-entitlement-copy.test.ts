import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const apiServerSource = readFileSync(new URL("../../../api/src/server.ts", import.meta.url), "utf8");
const listPageSource = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const detailPageSource = readFileSync(new URL("./[id]/page.tsx", import.meta.url), "utf8");
const feedbackSource = readFileSync(new URL("./RecommendationFeedbackActions.tsx", import.meta.url), "utf8");

describe("AI recommendation customer entitlement boundary", () => {
  it("uses subscription entitlement instead of Owner-only role checks for customer recommendation reads", () => {
    const recommendationSection = apiServerSource.slice(
      apiServerSource.indexOf("Recommendation Orchestrator"),
      apiServerSource.indexOf("AI-RECOMMENDATIONS-V2")
    );
    expect(recommendationSection).toContain("recommendationEntitlementResponse");
    expect(recommendationSection).toContain("buildMyEntitlements(session.user)");
    expect(recommendationSection).toContain('feature.id === "ai_recommendations"');
    expect(recommendationSection).toContain("feature_not_included");
    expect(recommendationSection).not.toContain('session.user.role !== "Owner"');
  });

  it("does not tell paying customers they need an Owner session", () => {
    expect(listPageSource).not.toContain("需要 Owner 權限才能讀取正式推薦");
    expect(detailPageSource).not.toContain("Owner session 才能讀取 AI 推薦詳情");
    expect(feedbackSource).not.toContain("Owner session 已過期");
    expect(listPageSource).toContain("訂閱/權限頁");
    expect(detailPageSource).toContain("訂閱/權限頁");
    expect(feedbackSource).toContain("方案權限不足");
  });
});
