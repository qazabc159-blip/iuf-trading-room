import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const authClientSource = readFileSync(new URL("../../../lib/auth-client.ts", import.meta.url), "utf8");

describe("account settings page", () => {
  it("keeps the change password API wiring", () => {
    expect(authClientSource).toContain("apiChangePassword");
    expect(authClientSource).toContain("/auth/change-password");
    expect(pageSource).toContain("apiChangePassword(current, next)");
    expect(pageSource).toContain("apiLogout()");
    expect(pageSource).toContain('router.push("/login")');
  });

  it("uses clean customer-facing Chinese copy", () => {
    expect(pageSource).toContain("帳號與安全");
    expect(pageSource).toContain("目前密碼");
    expect(pageSource).toContain("新密碼");
    expect(pageSource).toContain("再次輸入新密碼");
    expect(pageSource).toContain("密碼已更新");
    expect(pageSource).toContain("券商 SIM 憑證不會在瀏覽器頁面輸入或保存");
    expect(pageSource).not.toMatch(/[�]|嚙|踐|蝣|銝|摰|瘝|甇|閮/);
  });

  it("keeps safe password UX without exposing values", () => {
    expect(pageSource).toContain('autoComplete="current-password"');
    expect(pageSource).toContain('autoComplete="new-password"');
    expect(pageSource).toContain("顯示密碼");
    expect(pageSource).toContain("隱藏密碼");
    expect(pageSource).not.toContain("localStorage");
  });
});
