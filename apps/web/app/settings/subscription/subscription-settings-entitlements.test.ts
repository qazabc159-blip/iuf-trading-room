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
    expect(contractSource).toContain('source: owner ? "owner_override" : "role_default"');
    expect(contractSource).toContain("內部治理頁不屬於客戶訂閱功能。");
    expect(pageSource).toContain("Owner 後台不是客戶訂閱方案");
    expect(pageSource).toContain("一般客戶不會因為升級方案看到這些後台");
  });

  it("shows concrete tier boundaries before payment wiring exists", () => {
    expect(contractSource).toContain("usageLimits");
    expect(contractSource).toContain("onboardingNote");
    expect(contractSource).toContain("價格待設定");
    expect(pageSource).toContain("方案邊界");
    expect(pageSource).toContain("tier.usageLimits.map");
    expect(pageSource).toContain("tier.onboardingNote");
    expect(pageSource).toContain("月費 / 年費付款尚未正式接線");
  });

  it("uses clean customer-facing Chinese copy with no known mojibake markers", () => {
    expect(contractSource).toContain("入門");
    expect(contractSource).toContain("中級");
    expect(contractSource).toContain("高級");
    expect(pageSource).toContain("方案與權限");
    expect(pageSource).toContain("目前帳號狀態");
    expect(pageSource).not.toMatch(/[�]/);
  });
});
