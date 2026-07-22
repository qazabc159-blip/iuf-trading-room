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

  // 2026-07-22 Pete round-2 review 🔴（PR #1340）：這支測試原本掛 `@smoke`，
  // 在 CI 自己的 PR-preview 組合（本機 `next dev` on 127.0.0.1:3300 + 真
  // prod API api.eycvector.com，跨源）連 2 次（含 1 次 retry）都在等
  // `POST /api/v1/watchlist` response 逾時。已在完全相同組合下重現
  // （`IUF_QA_WEB_BASE_URL=http://127.0.0.1:3300` + `IUF_QA_API_BASE_URL=
  // https://api.eycvector.com`），並逐一排除 Pete 列的假設：
  //   (a) CORS — 用 curl 比對 `OPTIONS /api/v1/watchlist` 對兩個 Origin 的
  //       回應：`Origin: https://app.eycvector.com` 有
  //       `access-control-allow-origin: https://app.eycvector.com`；
  //       `Origin: http://127.0.0.1:3300` 完全沒有這個 header（curl 不受
  //       CORS 限制照樣拿到 204，但真瀏覽器會依這個缺席判斷 preflight 失敗、
  //       從不送出真正的 POST）——**確認為真**，後端 CORS_ORIGINS allowlist
  //       沒有把 127.0.0.1:3300 放行，這是既有、已在 `lib/api.ts`
  //       `SAME_ORIGIN_GET_PROXY_PATHS` comment 記載過的同一個結構性限制
  //       （當初 effective-quotes 就是因為同一原因才加了同源代理）。
  //   (b) 純延遲 — `curl -X POST` 直打同一支端點（帶 Origin header + 真
  //       session cookie）0.35s 內就拿到 200，非後端變慢。
  //   (c) 資料源空 — 不成立：CI log 顯示測試在等 `waitForResponse` 那行卡住
  //       （line 81），代表前面 `.rrow`/click 都已成功，卡點就是 POST 本身
  //       沒有發生，跟 (a) 一致。
  // 根因：**結構性跨源限制，非測試等待策略問題**——CI 的 PR-preview 架構
  // （web 跑本機、API 打真 prod）本來就沒有把 127.0.0.1:3300 放進後端 CORS
  // allowlist（合理：不該為了測試放行任意 localhost 來源到正式後端）。
  // `SAME_ORIGIN_GET_PROXY_PATHS`（`lib/api.ts`）目前只代理 GET，POST
  // /api/v1/watchlist 沒有同源代理可用。照 karpathy guideline #3（不做非
  // 必要的架構擴張）與本輪指示，這裡不新增後端 POST 代理路由，改為誠實
  // 降級：拿掉 `@smoke`（測試本身邏輯正確，對「同源部署」如 prod 仍會通過，
  // 只是不適合當 CI PR-preview 的 P0 gate），@smoke 代表測試換成下面純點擊
  // 導覽、不依賴跨源寫入的「量化策略迷你卡」測試。
  test("AI recommendation card CTAs: 看公司 navigates to /companies, 帶入模擬單 points to /desk-exact, 加觀察 posts real watchlist add", async ({ page }, testInfo) => {
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

  // 2026-07-22 Pete round-2：@smoke 代表測試從上面的 AI 推薦卡（跨源 POST
  // 結構性打不通，見上方註解）換成這支——QuantMiniCard 純靜態內容
  // （`QUANT_STRATEGIES_CONTENT` 硬編碼里程碑，見 v9.1 §2 授權邊界改版：
  // 首頁量化卡不再打任何策略績效 API），沒有外部資料相依、沒有跨源寫入，
  // 是這個檔案裡對 CI PR-preview 環境最穩定、風險最低的真互動導覽驗證。
  test("quant strategy mini card click navigates to /quant-strategies @smoke", async ({ page }, testInfo) => {
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
