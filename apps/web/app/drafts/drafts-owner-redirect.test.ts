import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

describe("drafts route owner boundary", () => {
  it("redirects legacy /drafts to the Owner-gated content drafts admin page", () => {
    expect(source).toContain('permanentRedirect("/admin/content-drafts")');
    expect(source).not.toContain("getContentDrafts");
    expect(source).not.toContain("href={`/admin/content-drafts/${draft.id}`}");
  });
});
