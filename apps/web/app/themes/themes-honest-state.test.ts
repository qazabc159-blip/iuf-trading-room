/**
 * P1-6 (reports/product_critique_20260710/PRODUCT_CRITIQUE_v1.md): the theme
 * board previously always showed a "P1 主題" (internal priority jargon) KPI
 * cell and, when every classification bucket (進攻/防守/優先追蹤/活躍) was 0
 * — the real current state, since all themes are still in research — printed
 * four separate "0" cells instead of an honest explanation. Cards also always
 * rendered a thesis line even when the underlying data had nothing real to
 * say, repeating a generic "說明待整理" placeholder on every card.
 *
 * Source-grep test (server component, no render harness in this repo — see
 * industry-heatmap-representatives.test.ts / signals-collapsed-surface-
 * guidance.test.ts for the established convention).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourcePath = fileURLToPath(new URL("./page.tsx", import.meta.url));
const source = readFileSync(sourcePath, "utf8");

describe("/themes honest classification state", () => {
  it("no longer prints the raw internal 'P1 主題' label", () => {
    expect(source).not.toContain("P1 主題");
  });

  it("uses a human-readable label for the priority-1 KPI cell", () => {
    expect(source).toContain("優先追蹤主題");
  });

  it("computes a single all-zero flag covering attack/defense/priority/active", () => {
    expect(source).toContain("allClassificationZero");
    expect(source).toMatch(/attackCount === 0 && defenseCount === 0 && priorityOneCount === 0 && activeCount === 0/);
  });

  it("collapses the classification cells into one honest sentence when all zero", () => {
    expect(source).toContain("主題分類建置中");
    expect(source).toContain("個主題皆在研究階段");
  });

  it("gates the 進攻/防守/優先追蹤/活躍 KPI cells behind !allClassificationZero", () => {
    const gateCount = (source.match(/!allClassificationZero/g) ?? []).length;
    expect(gateCount).toBe(3);
  });

  it("explains the page's relationship to 公司板 and AI 推薦 in the page note", () => {
    expect(source).toContain("個股詳細研究在公司板、進場想法在 AI 推薦");
  });

  it("only renders a card description when there is real content, not the generic fallback", () => {
    expect(source).toContain("function themeCardDescription");
    expect(source).toContain("text === THEME_THESIS_FALLBACK_TEXT ? null : text");
    expect(source).toContain("{description && <p className=\"_bty-card-thesis\">{description}</p>}");
  });
});
