import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const brokerPageSource = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const brokerConnectionsSource = readFileSync(new URL("./broker-connections.tsx", import.meta.url), "utf8");
const headerDockSource = readFileSync(new URL("../../../components/header-dock.tsx", import.meta.url), "utf8");
const subscriptionPageSource = readFileSync(new URL("../subscription/page.tsx", import.meta.url), "utf8");
const apiClientSource = readFileSync(new URL("../../../lib/api.ts", import.meta.url), "utf8");
const brokerSurfaceSource = `${brokerPageSource}\n${brokerConnectionsSource}`;

describe("broker settings boundary page", () => {
  it("surfaces broker connection from the customer account menu", () => {
    expect(headerDockSource).toContain('href="/settings/broker"');
  });

  it("does not collect broker credentials in the browser page", () => {
    expect(brokerSurfaceSource).toContain("憑證只存在您自己的電腦，永不上傳伺服器");
    expect(brokerSurfaceSource).toContain("瀏覽器頁面不收集 KGI SIM 帳號或密碼");
    expect(brokerSurfaceSource).toContain("不在網頁輸入");
    expect(brokerSurfaceSource).not.toContain("/iuf/kgi/sim_person_id");
    expect(brokerSurfaceSource).not.toContain("/iuf/kgi/sim_person_pwd");
    expect(brokerSurfaceSource).not.toContain('type="password"');
    expect(brokerSurfaceSource).not.toContain("localStorage.setItem");
    expect(brokerSurfaceSource).not.toContain("localStorage.getItem");
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
    expect(brokerConnectionsSource).not.toContain("/api/v1/uta/orders");
    expect(brokerConnectionsSource).not.toContain("submitOrder");
  });

  it("links subscription entitlements to broker connection readiness", () => {
    expect(subscriptionPageSource).toContain('href="/settings/broker"');
    expect(subscriptionPageSource).toContain("KGI 唯讀 / SIM 需要高級方案");
    expect(brokerPageSource).toContain("KGI 唯讀 / SIM 仍需要憑證");
  });

  it("adds gateway pairing UX without exposing backend-only token material", () => {
    expect(brokerConnectionsSource).toContain("/api/v1/uta/accounts");
    expect(brokerConnectionsSource).toContain("gateway/pair-token");
    expect(brokerConnectionsSource).toContain("gateway/revoke");
    expect(brokerConnectionsSource).toContain("產生配對碼");
    expect(brokerConnectionsSource).toContain("一次性配對碼");
    expect(brokerConnectionsSource).toContain("此碼只顯示一次，關閉後無法再查看");
    expect(brokerConnectionsSource).toContain("撤銷配對");
    expect(brokerConnectionsSource).toContain("等待配對");
    expect(brokerConnectionsSource).toContain("已連線");
    expect(brokerConnectionsSource).not.toContain("pairing_token_hash");
    expect(brokerConnectionsSource).not.toContain("gateway_token_hash");
  });

  it("uses clean customer-facing Chinese copy with no known mojibake markers", () => {
    expect(brokerPageSource).toContain("券商連線與交易模式");
    expect(brokerPageSource).toContain("憑證與下單安全");
    expect(brokerSurfaceSource).toContain("本機連線程式");
    expect(brokerSurfaceSource).not.toMatch(/[�]|嚙|踐|蝣|銝|摰|瘝|甇|閮/);
  });

  // P1-13 (product critique 2026-07-10): a "gateway-lifecycle-test" test
  // account was found sitting alongside real broker connections on this
  // customer-facing page. Display-layer filter only; prod row cleanup is a
  // separate follow-up flagged for Elva, not done here.
  it("filters obviously-test-named accounts out of the display layer", () => {
    expect(brokerConnectionsSource).toContain("isTestBrokerAccount");
    expect(brokerConnectionsSource).toContain("lifecycle-test");
    expect(brokerConnectionsSource).toContain("visibleConns");
    expect(brokerConnectionsSource).toContain("conns?.filter((c) => !isTestBrokerAccount(c))");
    // Conservative: real accounts (no test marker) must still render.
    expect(brokerConnectionsSource).not.toContain("conns.map((c) =>");
  });
});
