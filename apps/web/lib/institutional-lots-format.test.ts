import { describe, expect, it } from "vitest";
import { formatInstitutionalNetLotsZh } from "./institutional-lots-format";

describe("formatInstitutionalNetLotsZh", () => {
  it("converts raw net shares to 張 (÷1000), not raw shares mislabeled as 張", () => {
    // B1 regression: this exact value was the diagnosis reproduction case —
    // real API returned -12,748,541 股 for 2330 外資, previously rendered as
    // "-1274.9萬 張" (1000x too large); correct is "-1.27萬張".
    expect(formatInstitutionalNetLotsZh(-12_748_541)).toBe("-1.27萬張");
  });

  it("formats 億 magnitude", () => {
    expect(formatInstitutionalNetLotsZh(-150_000_000_000)).toBe("-1.50億張");
  });

  it("formats 萬 magnitude", () => {
    expect(formatInstitutionalNetLotsZh(-178_651_175)).toBe("-17.87萬張");
  });

  it("formats plain 張 below 萬 threshold", () => {
    expect(formatInstitutionalNetLotsZh(1_500_000)).toBe("+1,500張");
  });

  it("formats zero as +0張", () => {
    expect(formatInstitutionalNetLotsZh(0)).toBe("+0張");
  });

  it("returns -- for non-finite input", () => {
    expect(formatInstitutionalNetLotsZh(NaN)).toBe("--");
  });
});
