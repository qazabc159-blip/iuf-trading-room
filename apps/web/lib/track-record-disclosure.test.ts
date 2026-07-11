import { describe, expect, it } from "vitest";

import { resolveTrackRecordDisclosure } from "./track-record-disclosure";

// P0-3 data-honesty fix (#1216, 2026-07-10): every lab strategy snapshot
// currently carries isLiveVerifiedTrackRecord=false (RESEARCH_FORWARD_OBSERVATION /
// BACKTESTED_RAW — none of cont_liq_v36 / strategy_002 / strategy_003 has ever
// been live-verified). This is the decision gate every headline-metric consumer
// (`TrackRecordDisclosure.tsx`) relies on: false must always surface a
// disclosure next to the number, true must render nothing.
describe("resolveTrackRecordDisclosure", () => {
  it("renders the disclosure with the backend-provided text when isLiveVerifiedTrackRecord is false", () => {
    const result = resolveTrackRecordDisclosure(
      false,
      "歷史回測（未經驗證），非策略現況，研究窗 2025-04-10 ~ 2026-03-06。歷史研究數字 — 不可外推為未來表現預期。",
    );

    expect(result.render).toBe(true);
    if (!result.render) throw new Error("expected render:true");
    expect(result.badgeLabel).toContain("研究回測");
    expect(result.badgeLabel).toContain("未經驗證");
    expect(result.text).toContain("2025-04-10");
    expect(result.text).toContain("2026-03-06");
  });

  it("falls back to a generic disclosure sentence when headlineDisclosureZh is missing/blank", () => {
    const missing = resolveTrackRecordDisclosure(false, undefined);
    expect(missing.render).toBe(true);
    if (!missing.render) throw new Error("expected render:true");
    expect(missing.text).toBe("歷史回測（未經驗證），非策略現況。");

    const blank = resolveTrackRecordDisclosure(false, "   ");
    expect(blank.render).toBe(true);
    if (!blank.render) throw new Error("expected render:true");
    expect(blank.text).toBe("歷史回測（未經驗證），非策略現況。");
  });

  it("renders nothing when isLiveVerifiedTrackRecord is true", () => {
    const result = resolveTrackRecordDisclosure(true, "irrelevant when verified");
    expect(result).toEqual({ render: false });
  });

  it("still renders the disclosure (fail-safe) when isLiveVerifiedTrackRecord is null/undefined", () => {
    // An unknown verification status must never be silently treated as verified.
    expect(resolveTrackRecordDisclosure(undefined, "x").render).toBe(true);
    expect(resolveTrackRecordDisclosure(null, "x").render).toBe(true);
  });
});
