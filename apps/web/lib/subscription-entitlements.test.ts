import { describe, expect, it } from "vitest";

import {
  billingCycles,
  buildMyEntitlements,
  featureStatusLabel,
  isOwnerRole,
  subscriptionFeatures,
  subscriptionTiers,
  tierCanAccess,
  tierFeatureStatus,
  tierPriceLabel,
} from "./subscription-entitlements";

describe("subscription entitlements", () => {
  it("keeps internal admin controls out of customer subscription tiers", () => {
    for (const tier of subscriptionTiers) {
      expect(tier.features.owner_internal).toBe("not_included");
      expect(tierCanAccess(tier.id, "owner_internal")).toBe(false);
    }
  });

  it("models entry, mid, and high tiers without fake prices", () => {
    expect(subscriptionTiers.map((tier) => tier.name)).toEqual(["入門", "中級", "高級"]);
    expect(billingCycles).toEqual(["monthly", "yearly"]);

    for (const tier of subscriptionTiers) {
      expect(tierPriceLabel(tier, "monthly")).toBe("價格待設定");
      expect(tierPriceLabel(tier, "yearly")).toBe("價格待設定");
      expect(tier.usageLimits.length).toBeGreaterThanOrEqual(3);
      expect(tier.onboardingNote.length).toBeGreaterThan(0);
    }
  });

  it("gates broker functions to the high tier", () => {
    expect(tierFeatureStatus("starter", "kgi_sim")).toBe("not_included");
    expect(tierFeatureStatus("pro", "kgi_sim")).toBe("not_included");
    expect(tierFeatureStatus("premium", "kgi_sim")).toBe("included");
    expect(tierFeatureStatus("premium", "kgi_read_only")).toBe("included");
  });

  it("treats only the Owner role as owner-only", () => {
    expect(isOwnerRole("Owner")).toBe(true);
    expect(isOwnerRole("Admin")).toBe(false);
    expect(isOwnerRole("Viewer")).toBe(false);
    expect(isOwnerRole(null)).toBe(false);
  });

  it("builds owner internal visibility without granting it to customer tiers", () => {
    const owner = buildMyEntitlements({ id: "u1", email: "owner@example.com", role: "Owner" });
    const viewer = buildMyEntitlements({ id: "u2", email: "viewer@example.com", role: "Viewer" });

    expect(owner.ownerInternal.visible).toBe(true);
    expect(owner.features.find((feature) => feature.id === "owner_internal")?.access).toBe(true);
    expect(viewer.ownerInternal.visible).toBe(false);
    expect(viewer.features.find((feature) => feature.id === "owner_internal")?.access).toBe(false);
  });

  it("uses clean product labels instead of mojibake", () => {
    expect(featureStatusLabel("included")).toBe("已包含");
    expect(subscriptionFeatures.map((feature) => feature.label)).toContain("AI 推薦股票");
    expect(subscriptionFeatures.map((feature) => feature.label)).toContain("Owner 後台");
  });
});
