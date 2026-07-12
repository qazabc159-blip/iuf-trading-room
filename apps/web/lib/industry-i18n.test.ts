import { describe, expect, it } from "vitest";
import { industryLabel } from "./industry-i18n";

describe("industryLabel", () => {
  it("translates GICS-style broad sector values (D8 fix, 2026-07-12 diagnosis)", () => {
    // Reproduction case: 2634 (漢翔) coverage sector="Industrials" rendered
    // untranslated English enum in 知識圖譜「板塊：」— violates the repo's
    // "UI 禁工程語意" rule (no raw English enum values in user-facing copy).
    expect(industryLabel("Industrials")).toBe("工業");
  });

  it("still translates existing industry-level values", () => {
    expect(industryLabel("Aerospace & Defense")).toBe("航太國防");
    expect(industryLabel("Semiconductors")).toBe("半導體");
  });

  it("falls back to raw value for unmapped input (safe fallback, not blank)", () => {
    expect(industryLabel("Some Unmapped Sector")).toBe("Some Unmapped Sector");
  });

  it("returns 未分類 for empty/null/undefined", () => {
    expect(industryLabel(null)).toBe("未分類");
    expect(industryLabel(undefined)).toBe("未分類");
    expect(industryLabel("")).toBe("未分類");
  });
});
