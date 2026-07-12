/**
 * subscription-copy-i18n.test.ts
 *
 * translateSubscriptionCopy()'s known-clause table (P2-7,
 * reports/product_critique_20260710/PRODUCT_CRITIQUE_v1.md: "訂閱頁 forward
 * observation/SIM-only/caveat 英文術語"). Also regression-tests against the
 * real `subscriptionFeatures` from contracts so a future edit to that array
 * (e.g. a contracts-lane fix landing the Chinese text directly) doesn't
 * silently leave stale/no-op replacement rules behind unnoticed.
 */
import { describe, expect, it } from "vitest";
import { subscriptionFeatures } from "@iuf-trading-room/contracts";

import { translateSubscriptionCopy } from "./subscription-copy-i18n";

describe("translateSubscriptionCopy — known clauses (regression)", () => {
  it("translates the strategy_observation clause (forward observation / SIM-only / caveat / snapshot)", () => {
    const raw = "查看策略研究、forward observation、SIM-only 狀態、風險 caveat 與最新 snapshot。";
    expect(translateSubscriptionCopy(raw)).toBe(
      "查看策略研究、前瞻觀察、僅限模擬狀態、風險注意事項與最新快照。",
    );
  });

  it("translates the automation clause (Daily smoke)", () => {
    const raw = "Daily smoke、資料新鮮度、策略排程與風控監控，讓產品每天自我檢查。";
    expect(translateSubscriptionCopy(raw)).toBe(
      "每日自動排查、資料新鮮度、策略排程與風控監控，讓產品每天自我檢查。",
    );
  });

  it("passes through plain Chinese copy unchanged", () => {
    const clean = "AI 精選市場新聞、重大公告、產業事件與來源狀態，協助使用者快速抓住今日重點。";
    expect(translateSubscriptionCopy(clean)).toBe(clean);
  });

  it("leaves established brand/product loanwords untouched (KGI, SIM, Paper)", () => {
    const raw = "透過安全憑證連到券商模擬環境，和 Paper 帳本、正式下單清楚分離。";
    expect(translateSubscriptionCopy(raw)).toBe(raw);
  });

  it("no raw English jargon clause survives across the live contracts customerCopy set", () => {
    const jargonPattern = /forward observation|SIM-only|風險\s*caveat|最新\s*snapshot|Daily smoke/;
    for (const feature of subscriptionFeatures) {
      const translated = translateSubscriptionCopy(feature.customerCopy);
      expect(translated).not.toMatch(jargonPattern);
    }
  });
});
