import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const brokerPageSource = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const headerDockSource = readFileSync(new URL("../../../components/header-dock.tsx", import.meta.url), "utf8");
const subscriptionPageSource = readFileSync(new URL("../subscription/page.tsx", import.meta.url), "utf8");
const apiClientSource = readFileSync(new URL("../../../lib/api.ts", import.meta.url), "utf8");

describe("broker settings boundary page", () => {
  it("surfaces broker connection from the customer account menu", () => {
    expect(headerDockSource).toContain('href="/settings/broker"');
  });

  it("does not collect broker credentials in the browser page", () => {
    expect(brokerPageSource).toContain("瀏覽器頁面不收集 KGI SIM 帳號或密碼");
    expect(brokerPageSource).toContain("不在網頁輸入");
    expect(brokerPageSource).not.toContain("/iuf/kgi/sim_person_id");
    expect(brokerPageSource).not.toContain("/iuf/kgi/sim_person_pwd");
    expect(brokerPageSource).not.toContain('type="password"');
    expect(brokerPageSource).not.toContain("localStorage.setItem");
    expect(brokerPageSource).not.toContain("localStorage.getItem");
  });

  it("reads current account entitlements before showing broker readiness", () => {
    expect(apiClientSource).toContain("getMyEntitlements");
    expect(brokerPageSource).toContain("await getMyEntitlements()");
    expect(brokerPageSource).toContain("目前帳號可用能力");
    expect(brokerPageSource).toContain("brokerFeatureIds");
    expect(brokerPageSource).toContain("kgi_read_only");
    expect(brokerPageSource).toContain("kgi_sim");
  });

  it("keeps real orders explicitly disabled", () => {
    expect(brokerPageSource).toContain("Real Order");
    expect(brokerPageSource).toContain("停用");
    expect(brokerPageSource).toContain("正式下單目前維持鎖定");
  });

  it("links subscription entitlements to broker connection readiness", () => {
    expect(subscriptionPageSource).toContain('href="/settings/broker"');
    expect(subscriptionPageSource).toContain("KGI 唯讀 / SIM 需要高級方案");
    expect(brokerPageSource).toContain("KGI 唯讀 / SIM 仍需要憑證");
  });

  it("uses clean customer-facing Chinese copy with no known mojibake markers", () => {
    expect(brokerPageSource).toContain("券商連線與交易模式");
    expect(brokerPageSource).toContain("憑證與下單安全");
    expect(brokerPageSource).not.toMatch(/[�]|嚙|踐|蝣|銝|摰|瘝|甇|閮/);
  });
});
