import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const brokerPageSource = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const headerDockSource = readFileSync(new URL("../../../components/header-dock.tsx", import.meta.url), "utf8");
const subscriptionPageSource = readFileSync(new URL("../subscription/page.tsx", import.meta.url), "utf8");

describe("broker settings boundary page", () => {
  it("surfaces broker connection from the customer account menu", () => {
    expect(headerDockSource).toContain('href="/settings/broker"');
    expect(headerDockSource).toContain("券商連線");
  });

  it("does not collect broker credentials in the browser page", () => {
    expect(brokerPageSource).toContain("不要把券商密碼貼在聊天");
    expect(brokerPageSource).toContain("/iuf/kgi/sim_person_id");
    expect(brokerPageSource).toContain("/iuf/kgi/sim_person_pwd");
    expect(brokerPageSource).not.toContain('type="password"');
    expect(brokerPageSource).not.toContain("localStorage.setItem");
    expect(brokerPageSource).not.toContain("localStorage.getItem");
  });

  it("keeps real orders explicitly disabled", () => {
    expect(brokerPageSource).toContain("Real Order");
    expect(brokerPageSource).toContain("正式封鎖");
    expect(brokerPageSource).toContain("真實券商寫入不屬於目前客戶方案");
  });

  it("links subscription entitlements to broker connection readiness", () => {
    expect(subscriptionPageSource).toContain('href="/settings/broker"');
    expect(subscriptionPageSource).toContain("KGI read-only / SIM 即使在高級方案");
  });
});
