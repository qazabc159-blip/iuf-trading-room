import { expect, test } from "@playwright/test";
import { extractFrame, saveRouteScreenshot } from "./helpers";

// 交易台下單票空間分配修復驗收（2026-07-15，Jim，楊董點名：「不要還要我滑動
// 才能看到 ROD IOC FOK 那些」）。
//
// 根因（非 /desk-exact/index.html 本身的 CSS 問題）：apps/web/lib/ticker-tape.ts
// 的 EXACT_SKIP_ROUTES 在 2026-07-10（Pete review, PR #1208）就已經記錄
// 「任何用 <FinalOnlyFrame/> 強制 height:100dvh 的頁面都必須把全站 TickerTape
// 跳過，否則 32px（--ticker-tape-height）會把整頁往下推出視窗」，但 /desk-exact
// 是 2026-07-14 才新增的 FinalOnlyFrame 消費者，當時漏掉沒加進這個清單——於是
// 頁面總高度 = 32px 跑馬燈 + 100dvh 下單台，永遠比視窗高 32px，下單票最下面幾列
// （風控預覽／送出鈕，原稿沒有 TIF 選擇器，只有「限價」單一 option 固定 ROD，
// 見 index.html 內 1576-1577 行註解）就被推出視窗外，需要捲動才看得到。
// 修法：把 "/desk-exact" 加進 EXACT_SKIP_ROUTES（見 apps/web/lib/ticker-tape.ts），
// 跟 /portfolio、/market-intel 用同一套既有機制，不動 index.html 本身的排版。
test.describe("/desk-exact ticket panel fits one screen (no scroll)", () => {
  for (const size of [
    { width: 1920, height: 1080, label: "1920x1080" },
    { width: 1366, height: 768, label: "1366x768" }
  ]) {
    test(`desktop ${size.label}: submit button + risk preview visible without page scroll`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto("/desk-exact", { waitUntil: "domcontentloaded" });
      const frame = extractFrame(page);
      await frame.locator('[data-slot="sym-price"]').first().waitFor({ state: "attached", timeout: 15000 });
      await page.waitForTimeout(6000);

      // No page-level (outer app shell) vertical overflow — this is what the
      // ticker-tape skip-list fix removes. Without the fix this is +32px.
      const outerScroll = await page.evaluate(() => ({
        scrollHeight: document.documentElement.scrollHeight,
        clientHeight: document.documentElement.clientHeight
      }));
      testInfo.annotations.push({ type: `outer-scroll-${size.label}`, description: JSON.stringify(outerScroll) });
      expect(outerScroll.scrollHeight, `no outer page scroll at ${size.label} (ticker-tape must be skipped on /desk-exact)`).toBeLessThanOrEqual(
        outerScroll.clientHeight + 1
      );

      // Submit button and risk-preview panel — the bottom-most ticket
      // controls — must be within the viewport without scrolling. (The
      // artifact's ticket has no separate TIF row — 委託類型 is a single
      // fixed 限價/ROD option by design, see index.html comment; these are
      // the actual bottom-most controls that stand in for it.)
      const submitBox = await frame.locator("button.submit").first().boundingBox();
      const riskBox = await frame.locator(".panel.risk").first().boundingBox();
      expect(submitBox, "submit button must be measurable").not.toBeNull();
      expect(riskBox, "risk preview panel must be measurable").not.toBeNull();
      if (submitBox) {
        testInfo.annotations.push({ type: `submit-bottom-${size.label}`, description: String(submitBox.y + submitBox.height) });
        expect(submitBox.y + submitBox.height, `submit button bottom must be within ${size.height}px viewport`).toBeLessThanOrEqual(size.height);
      }
      if (riskBox) {
        testInfo.annotations.push({ type: `risk-bottom-${size.label}`, description: String(riskBox.y + riskBox.height) });
        expect(riskBox.y + riskBox.height, `risk preview panel bottom must be within ${size.height}px viewport`).toBeLessThanOrEqual(size.height);
      }

      await saveRouteScreenshot(page, testInfo, `desk-exact-ticket-no-scroll-${size.label}`);
    });
  }
});
