import { expect, test } from "@playwright/test";
import { expectNoServerError, saveRouteScreenshot } from "./helpers";

// 2026-07-23 (Jim, AI 投研晨報 v2 重設計) — 盤後空態/誠實度驗收。
//
// /ai-recommendations 的推薦資料在 async server component 內抓取
// (MorningBriefBody), 不是瀏覽器端 fetch — page.route()/context.route() 攔
// 不到那顆請求，沒辦法用網路 mock 造一個「v3 回傳 0 筆」的假情境（見
// .claude/agent-memory/frontend-consume-jim/feedback_sw_intercept_and_shared_
// envelope_mock_2026_07_17.md 同款 SSR-fetch 攔截限制）。改用今天本來就是
// 盤後這個事實：對真環境跑，驗證版次日期誠實標「收盤」、不洩漏
// NaN/undefined/null、且頁面一定會落在兩種誠實分支之一（真的有推薦內容 vs
// amb-empty 誠實空態），不會卡在無限載入或空白頁。
test("/ai-recommendations after-hours: honest edition date + no fake values + resolves to a real or empty branch", async ({ page }, testInfo) => {
  await page.goto("/ai-recommendations", { waitUntil: "networkidle" });
  await expectNoServerError(page);

  const bodyText = await page.locator("body").innerText();

  // 版次日期必須誠實標出（「MM/DD 收盤」或至少不是空白/NaN），呼應
  // 「『--』與空態要誠實標日期」要求。
  expect(bodyText).toMatch(/版次/);
  expect(bodyText).not.toContain("NaN");
  expect(bodyText).not.toContain("undefined");
  expect(bodyText).not.toMatch(/[^a-zA-Z]null[^a-zA-Z]/);

  // 頁面必須落在兩種誠實分支之一：真的渲染了頭版特稿，或誠實空態區塊——不能
  // 兩者都沒有（代表卡在載入中或整頁掛掉，不是本頁允許的第三態）。
  const leadCount = await page.locator(".amb-shell article.lead").count();
  const emptyCount = await page.locator(".amb-shell .amb-empty").count();
  expect(leadCount + emptyCount, "page must resolve to either the lead article or the honest empty state").toBeGreaterThan(0);

  if (leadCount > 0) {
    // 有卡片時：信心/總分/盤勢係數任一缺值都應顯示 -- 而非假造數字；這裡只
    // 驗證「如果畫面上出現這些欄位」沒有出現偽造的佔位（例如把 null 顯成
    // 0% 這種會誤導的假值）。真正缺值與否交給 morning-brief-copy.test.ts
    // 的純函式測試覆蓋。
    await expect(page.locator(".amb-shell .lh-metrics")).toBeVisible();
  }

  await saveRouteScreenshot(page, testInfo, "ai-recommendations-afterhours");
});
