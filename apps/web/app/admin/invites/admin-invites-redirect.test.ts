import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

describe("legacy /admin/invites route converge (P1-2, 2026-07-05)", () => {
  it("redirects the retired invite_codes issuer page to /admin/team", () => {
    expect(source).toContain('permanentRedirect("/admin/team")');
    expect(source).not.toContain("InviteIssuer");
    expect(source).not.toContain("apiIssueInvite");
  });
});
