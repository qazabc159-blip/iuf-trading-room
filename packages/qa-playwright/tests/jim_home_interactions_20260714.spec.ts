import { expect, test } from "@playwright/test";
import { saveRouteScreenshot } from "./helpers";

// 首頁互動全接驗收（2026-07-14，Jim；2026-07-22 修活）：AI 推薦卡三顆鈕 / 熱力圖磚 /
// 新聞紙帶連結 / 排行列 / 簡報展開收合 / 量化策略迷你卡跳轉 / 文字密度截斷。
//
// 2026-07-22 更正：本檔案原本假設首頁仍是 iframe 包裹（`extractFrame()` =
// `page.frameLocator("iframe")`），並依賴 `data-slot="..."` 屬性與
// `target="_top"`。但 2026-07-14 稍晚楊董終令首頁改回原封 React server
// component（不再走 iframe/inline script，見 jim_home_ledger_rsc_20260714.spec.ts
// 檔頭記載），現行首頁 DOM 完全沒有 iframe、也沒有任何 `data-slot`/`target`
// 屬性——這支測試檔從那之後就對著一個不存在的 DOM 结構等待，逢跑必逾時躺平
// （在 CI 裡從未真的通過過）。這裡把選擇器全部對齊 `apps/web/app/page.tsx`
// 現行真實 markup（`.recwrap`/`.rkwrap`/`.heatzone`/`.tape`/`.qmini-wrap`），
// 拿掉不再存在的 iframe/data-slot/target 斷言，換成同等或更嚴格的真實互動
// 斷言（實際點擊＋等待真導覽、真 POST）。本機以 `https://app.eycvector.com`
// 驗證 6/6 綠（本機 `next dev` 直連真後端 API 在這台機器有已知的 Windows
// fetch 延遲假影，會讓這些 Suspense 區塊落入空狀態——非本檔選擇器問題，
// 見 per-agent memory `feedback_local_windows_fetch_latency_home_specs`）。
test.describe("/ home-exact interactions", () => {
  test("brief expand/collapse toggles real text (not CSS clamp)", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 1400 });
    await page.goto("/", { waitUntil: "domcontentloaded" });

    await page.locator(".briefcol .seg").first().waitFor({ state: "attached", timeout: 15000 });
    await page.waitForTimeout(1000);

    const before = await page.locator(".briefcol .seg .sx").first().textContent();
    const toggleLabelBefore = await page.locator(".brief-toggle-btn").first().textContent();
    testInfo.annotations.push({ type: "brief-preview-text", description: String(before) });
    testInfo.annotations.push({ type: "toggle-label-before", description: String(toggleLabelBefore) });

    await saveRouteScreenshot(page, testInfo, "brief-before-expand");

    await page.locator(".brief-toggle-btn").first().click();
    await page.waitForTimeout(300);

    const after = await page.locator(".briefcol .seg .sx").first().textContent();
    const toggleLabelAfter = await page.locator(".brief-toggle-btn").first().textContent();
    testInfo.annotations.push({ type: "brief-full-text", description: String(after) });
    testInfo.annotations.push({ type: "toggle-label-after", description: String(toggleLabelAfter) });

    await saveRouteScreenshot(page, testInfo, "brief-after-expand");

    expect(after, "expand should reveal a longer/different string, not a no-op CSS clamp toggle").not.toBe(before);
    // real client toggle, not a navigation
    expect(page.url()).not.toContain("?");
  });

  test("AI recommendation card CTAs: 看公司 navigates to /companies, 帶入模擬單 points to /desk-exact, 加觀察 posts real watchlist add @smoke", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 1400 });
    await page.goto("/", { waitUntil: "domcontentloaded" });

    await page.locator(".recwrap .rec .rrow").first().waitFor({ state: "attached", timeout: 15000 });
    await page.waitForTimeout(500);

    const firstRow = page.locator(".recwrap .rec .rrow").first();
    const companyLink = firstRow.locator("a._src-cta-btn").first();
    const deskLink = firstRow.locator("a._src-cta-btn").last();
    // Watch control is the only <button> among the three CTAs (the other two
    // are <a> nav links) — a stable structural selector, independent of its
    // own label text which changes after click ("加觀察" → "加入中…" → "已加入").
    const watchButton = firstRow.locator("button._src-cta-btn").first();

    const companyHref = await companyLink.getAttribute("href");
    const deskHref = await deskLink.getAttribute("href");
    testInfo.annotations.push({ type: "company-href", description: String(companyHref) });
    testInfo.annotations.push({ type: "desk-href", description: String(deskHref) });

    expect(companyHref).toMatch(/^\/companies\//);
    expect(deskHref).toMatch(/^\/desk-exact\?symbol=.+&side=buy$/);

    // rationale should be a short truncated sentence, not a wall of text
    const rationaleText = await firstRow.locator(".rs").first().textContent();
    testInfo.annotations.push({ type: "rationale-text", description: String(rationaleText) });
    expect((rationaleText || "").length, "rationale should be truncated to a short sentence").toBeLessThanOrEqual(45);

    // 加觀察 — real POST direct to the backend API (not the same-origin GET
    // proxy — POST /api/v1/watchlist is a genuine cross-origin browser fetch,
    // see lib/api.ts SAME_ORIGIN_GET_PROXY_PATHS which only covers GET).
    const watchlistResponsePromise = page.waitForResponse(
      (res) => res.url().includes("/api/v1/watchlist") && res.request().method() === "POST",
      { timeout: 10000 },
    );
    await watchButton.click();
    const watchlistResponse = await watchlistResponsePromise;
    testInfo.annotations.push({ type: "watchlist-response-status", description: String(watchlistResponse.status()) });
    expect(watchlistResponse.ok(), "watchlist POST should succeed").toBeTruthy();

    await page.waitForTimeout(300);
    const watchLabelAfter = await watchButton.textContent();
    testInfo.annotations.push({ type: "watch-label-after", description: String(watchLabelAfter) });
    expect(watchLabelAfter).toContain("已加入");

    // now actually click 看公司 and verify real navigation happens
    await companyLink.click();
    await page.waitForURL(/\/companies\//, { timeout: 10000 });
    testInfo.annotations.push({ type: "url-after-click", description: page.url() });
    expect(page.url()).toContain("/companies/");
  });

  test("heatmap tile click navigates to /companies/<symbol>, hover shows aria-label with name+pct", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 1400 });
    await page.goto("/", { waitUntil: "domcontentloaded" });

    await page.locator(".heatzone .heatmapgrid a.tile").first().waitFor({ state: "attached", timeout: 15000 });
    await page.waitForTimeout(500);

    const firstTile = page.locator(".heatzone .heatmapgrid a.tile").first();
    const href = await firstTile.getAttribute("href");
    const symbol = href?.replace(/^\/companies\//, "") ?? null;
    const ariaLabel = await firstTile.getAttribute("aria-label");
    testInfo.annotations.push({ type: "tile-symbol", description: String(symbol) });
    testInfo.annotations.push({ type: "tile-aria-label", description: String(ariaLabel) });
    expect(symbol, "tile href must resolve to a /companies/<symbol> link").toBeTruthy();
    expect(ariaLabel, "tile should have an aria-label with name+pct for hover/screen-reader").toBeTruthy();

    await firstTile.click();
    await page.waitForURL(/\/companies\//, { timeout: 10000 });
    testInfo.annotations.push({ type: "url-after-tile-click", description: page.url() });
    expect(page.url()).toContain(`/companies/${symbol}`);
  });

  test("rank row click navigates to /companies/<symbol>", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 1400 });
    await page.goto("/", { waitUntil: "domcontentloaded" });

    await page.locator(".rkwrap .rk a.r").first().waitFor({ state: "attached", timeout: 15000 });
    await page.waitForTimeout(500);

    const firstRow = page.locator(".rkwrap .rk a.r").first();
    const href = await firstRow.getAttribute("href");
    const symbol = href?.replace(/^\/companies\//, "") ?? null;
    testInfo.annotations.push({ type: "rank-symbol", description: String(symbol) });
    expect(symbol, "rank row href must resolve to a /companies/<symbol> link").toBeTruthy();

    await firstRow.click();
    await page.waitForURL(/\/companies\//, { timeout: 10000 });
    testInfo.annotations.push({ type: "url-after-rank-click", description: page.url() });
    expect(page.url()).toContain(`/companies/${symbol}`);
  });

  test("quant strategy mini card click navigates to /quant-strategies", async ({ page }, testInfo) => {
    // v9.1（2026-07-19）renamed this wrapper class away from the old S1
    // internal codename — see quant_v91_factsheet_content_pivot memory.
    await page.setViewportSize({ width: 1280, height: 1400 });
    await page.goto("/", { waitUntil: "domcontentloaded" });

    await page.locator(".qmini-wrap").first().waitFor({ state: "attached", timeout: 15000 });
    await page.waitForTimeout(500);

    await page.locator(".qmini-wrap").first().click();
    await page.waitForURL(/\/quant-strategies/, { timeout: 10000 });
    testInfo.annotations.push({ type: "url-after-quant-mini-click", description: page.url() });
    expect(page.url()).toContain("/quant-strategies");
  });

  test("news tape: featured item is a real navigable link (internal /companies or external article), headline truncated", async ({ page }, testInfo) => {
    // 2026-07-22 更正：舊斷言要求 target="_blank" rel="noopener" —— 這在首頁
    // 還是 iframe 包裹的年代合理（要跳出 iframe 開新分頁），但現行 NewsTape
    // 用 next/link 直接渲染在頂層頁面，沒有 iframe 邊界要跳出，設計上不再
    // 開新分頁（見 apps/web/app/page.tsx NewsTape() `itemHref()`／
    // `<Link href={itemHref(featured)} className="feat">`，同一分頁導覽）。
    // 這裡改成驗證真實可導覽（href 為 /companies/<symbol> 或外部文章 URL）。
    await page.setViewportSize({ width: 1280, height: 1400 });
    await page.goto("/", { waitUntil: "domcontentloaded" });

    await page.locator(".tape .tape-head").first().waitFor({ state: "attached", timeout: 15000 });
    await page.waitForTimeout(500);

    const featEl = page.locator(".tape a.feat").first();
    const featCount = await featEl.count();
    testInfo.annotations.push({ type: "feat-count", description: String(featCount) });
    if (featCount === 0) {
      testInfo.annotations.push({ type: "feat-skip", description: "no featured item in current feed — nothing to assert" });
      return;
    }

    const featHref = await featEl.getAttribute("href");
    const featTitle = await featEl.locator("h3").textContent();
    testInfo.annotations.push({ type: "feat-href", description: String(featHref) });
    testInfo.annotations.push({ type: "feat-title", description: String(featTitle) });
    testInfo.annotations.push({ type: "feat-title-length", description: String((featTitle || "").length) });

    expect(featHref, "featured item must have a real href").toMatch(/^(\/companies\/|\/market-intel$|https?:\/\/)/);
    expect((featTitle || "").length, "feat headline should be truncated to ~2-3 lines worth").toBeLessThanOrEqual(40);

    // Only click-through when the link is internal — an external article URL
    // would navigate this Playwright tab away from app.eycvector.com entirely.
    if (featHref && featHref.startsWith("/")) {
      await featEl.click();
      await page.waitForURL(/\/companies\/|\/market-intel/, { timeout: 10000 });
      testInfo.annotations.push({ type: "url-after-feat-click", description: page.url() });
    }
  });
});
