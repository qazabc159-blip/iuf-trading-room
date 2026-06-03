import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const apiClientSource = readFileSync(new URL("../../../lib/api.ts", import.meta.url), "utf8");
const apiServerSource = readFileSync(new URL("../../../../api/src/server.ts", import.meta.url), "utf8");
const contractSource = readFileSync(new URL("../../../../../packages/contracts/src/entitlements.ts", import.meta.url), "utf8");

describe("subscription entitlement wiring", () => {
  it("reads the current account entitlement from the production API surface", () => {
    expect(apiServerSource).toContain('app.get("/api/v1/entitlements/me"');
    expect(apiServerSource).toContain("buildMyEntitlements(session.user)");
    expect(apiClientSource).toContain("getMyEntitlements");
    expect(apiClientSource).toContain('"/api/v1/entitlements/me"');
    expect(pageSource).toContain("await getMyEntitlements()");
  });

  it("keeps customer tiers separate from owner-only admin visibility", () => {
    expect(contractSource).toContain('owner_internal: "not_included"');
    expect(contractSource).toContain("source: owner ? \"owner_override\" : \"role_default\"");
    expect(pageSource).toContain("不顯示給一般客戶");
  });
});
