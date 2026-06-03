import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

describe("homepage P0 visual product copy", () => {
  it("keeps internal OpenAlice admin links out of the customer homepage", () => {
    expect(source).not.toContain("const adminNav: Array<");
    expect(source).not.toContain("const internalNav: Array<");
    for (const href of [
      "/admin/brain/llm",
      "/admin/events",
      "/admin/portfolio/snapshots",
      "/admin/tools",
      "/admin/uta/accounts",
      "/admin/strategies",
    ]) {
      expect(source).not.toContain(href);
    }
  });

  it("does not expose raw English daily-brief headings in the homepage brief preview", () => {
    expect(source).toContain('"market overview": "盤勢總覽"');
    expect(source).toContain('"theme summaries": "題材摘要"');
    expect(source).toContain('"company notes": "公司觀察"');
    expect(source).toContain("function polishedBriefText");
    expect(source).toContain("AI 簡報只整理盤勢、題材與公司觀察");
  });
});
