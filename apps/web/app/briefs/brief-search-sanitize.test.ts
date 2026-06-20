import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./BriefSearchPanel.tsx", import.meta.url), "utf8");

describe("brief search result copy", () => {
  it("sanitizes stored brief text before rendering search snippets", () => {
    expect(source).toContain('import { cleanExternalHeadline, cleanNarrativeText } from "@/lib/operator-copy";');
    expect(source).toContain("const heading = cleanExternalHeadline(section.heading);");
    expect(source).toContain("const body = cleanNarrativeText(section.body);");
  });
});
