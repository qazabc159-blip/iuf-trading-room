import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

describe("portfolio snapshots public route alias", () => {
  it("redirects the product route to the real snapshot page", () => {
    expect(source).toContain('permanentRedirect("/admin/portfolio/snapshots")');
  });
});
