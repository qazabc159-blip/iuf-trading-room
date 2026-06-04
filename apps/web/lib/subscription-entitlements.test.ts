import { describe, expect, it } from "vitest";

import {
  billingCycles,
  isOwnerRole,
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
      expect(tierPriceLabel(tier, "monthly")).toBe("價格待定");
      expect(tierPriceLabel(tier, "yearly")).toBe("價格待定");
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
});
