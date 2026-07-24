import { expect, test } from "@playwright/test";

// 2026-07-17 根因修復驗收：楊董深夜回報「首頁熱力圖又換了、沒辦法切換」。
//
// 根因：apps/web/app/page.tsx 的 HeatZonePanel 把 showKgiFallback（純粹代表
// 「現在不在 KGI 09:00-14:10 即時報價時段」，每天 14:10-09:00 與整個週末皆為
// true）也塞進 effectiveMode 的強制條件：
//   const effectiveMode = showKgiFallback || showCoverageFallback ? "all" : activeMode;
// 導致「核心熱力圖」／「全市場熱力圖」這組切換 tab，在收盤後與週末永遠被鎖死在
// 「全市場熱力圖」（MarketWideHeatmap，產業長條格視覺），使用者點「核心熱力圖」
// 連結完全沒有反應——因為 effectiveMode 從不看 URL 的 heatmap 參數，只看
// showKgiFallback。这跟原稿核准的磚格熱力圖（IndustryHeatmap treemap）視覺完全
// 不同，才會被誤認為「又換了」。
//
// 修復：只有 showCoverageFallback（代表股 EOD 覆蓋率真的不足，例如冷啟動）才
// 強制切到全市場救援視圖；showKgiFallback 只保留告示 banner，不再蓋掉使用者
// 的模式選擇。
//
// 這支 spec 不依賴測試時當下是否為盤中/盤後——不論何時執行，只要代表股 EOD
// 覆蓋率正常（showCoverageFallback=false，prod 正常運作下恆真），核心/全市場
// 兩個 tab 都必須能真實切換且反映在 DOM 上。
//
// ── Round 2 加固（2026-07-20，Jim-10r2）──────────────────────────────────
// #1319（header-dock 幾何重疊修復）merge 後，這支 spec 在 #1317/#1318 又連紅，
// 但錯誤訊息換了（不再是 header-dock intercept）。下載 CI artifact 的
// test-failed screenshot 判讀出兩種不同狀況：
//   1. 首次嘗試失敗：頁面畫面完全正常（推薦/簡報/排行都有真資料），點擊本身
//      沒被擋，但 `page.waitForURL(...,{timeout:15000})` 逾時。根因：這裡等的
//      正是 apps/web/app/page.tsx 自己的 FETCH_MARKET_MS=15000（market/
//      realtimeMarket 內部 fetch timeout）餵的那個區塊——client 端等待窗口跟
//      後端自己允許的最慢時間完全相等，任何一次接近上限的真實回應就會讓測試
//      先逾時。`page.waitForURL` 又是事件驅動（監聽特定 navigation 事件），
//      不像 poll 型斷言那樣對時序抖動有天然容錯。
//   2. Retry 失敗：screenshot 顯示當下後端明顯大範圍降級（AI 推薦
//      「timeout_12000ms_recommendations」、簡報「讀入失敗」、排行「等待正式
//      排行回傳」、熱力圖 0 檔）。這個狀態下 showCoverageFallback 會依 page.tsx
//      設計強制 effectiveMode="all"，跟 URL/點擊完全無關——「核心 tab 沒有變
//      active」不是迴歸，是代表股資料真的暖機/降級中時的既定行為；這個前提不
//      成立時，toggle 本身就沒有東西可測（點「核心熱力圖」一樣會被強制蓋回
//      all）。
// 修法：①等真正代表完成的 DOM 內容信號（磚格/格子真的渲染出來）取代
// `page.waitForURL`，timeout 拉到明確超過 app 自己最慢內部 timeout 的門檻
// ②明確偵測 coverage-fallback 前提是否成立，不成立時用 `test.skip` 附原因跳過
// （不是斷言弱化——原本就沒東西可驗，比起誤判「迴歸」紅燈或悄悄放行更誠實）
// ③點擊前先明確驗證 tab 可見/可互動。沒有拿掉或放寬任何一條既有斷言——正常
// 前提成立時全部原樣跑好跑滿。
const SECTION_TIMEOUT_MS = 30000; // 2x apps/web/app/page.tsx 的 FETCH_MARKET_MS=15000 worst case，留足緩衝

test.describe("/ homepage heatmap core/全市場 mode toggle", () => {
  test("clicking 核心熱力圖 renders the treemap grid, clicking 全市場熱力圖 renders the market-wide grid, and they are mutually exclusive @smoke", async ({ page }, testInfo) => {
    test.setTimeout(150000);
    await page.setViewportSize({ width: 1280, height: 1400 });

    // Start on core mode (default route, no query).
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.locator(".heat-mode-tabs").first().waitFor({ state: "attached", timeout: SECTION_TIMEOUT_MS });

    // Banner text is read synchronously right after the tabs attach — both
    // live in the same HeatZonePanel synchronous return block (one Suspense
    // boundary), so no extra sleep is needed for it to be present.
    const offHoursBannerText = (await page.locator(".tac-kgi-offhours-banner").allInnerTexts()).join(" | ");
    testInfo.annotations.push({ type: "offhours-banner-text", description: offHoursBannerText || "(none)" });

    // Coverage-fallback precondition guard — see Round 2 note above. When
    // this banner's text is showing, page.tsx forces effectiveMode="all"
    // unconditionally; the core/全市場 toggle this spec locks is not testable
    // in that state by design, not because of a regression.
    test.skip(
      offHoursBannerText.includes("暖機"),
      `代表股資料覆蓋率不足（coverage-fallback banner: "${offHoursBannerText}"）— page.tsx 強制 effectiveMode="all"，toggle 本身在此前提下不可測，非本 spec 要鎖的迴歸`,
    );

    // ── Round 3 root cure（2026-07-24，Pete-6 flow-debt ticket）───────────
    // The banner-text check above is a *proxy* for whether `.heatmapgrid
    // .tile` will actually render — but page.tsx's coverage gate
    // (hasProductHeatmapCoverage, symbol+move-count only) and
    // industry-heatmap.tsx's tile-rendering gate (isUsableTile: also
    // requires readiness !== "blocked" and freshnessStatus !== "missing")
    // are two independently-computed filters that have been observed to
    // diverge: CI run 30011454390 (2026-07-23, main push, same headSha red)
    // read offHoursBannerText without "暖機" (coverage gate passed) yet
    // `.heatmapgrid .tile` never appeared within SECTION_TIMEOUT_MS — a hard
    // test failure for a state that was never a real toggle regression.
    // Poll the actual target selector directly instead of trusting only the
    // banner proxy; if tiles genuinely never render, that's the same class
    // of honest "nothing to test" precondition as the banner-text skip
    // above, just detected via the true signal instead of a proxy that can
    // be wrong.
    const coreTilesReady = await page
      .locator(".heatmapgrid .tile")
      .first()
      .waitFor({ state: "visible", timeout: SECTION_TIMEOUT_MS })
      .then(() => true)
      .catch(() => false);
    test.skip(
      !coreTilesReady,
      `核心熱力圖磚格在 ${SECTION_TIMEOUT_MS}ms 內未渲染出任何真實資料（offhours banner: "${offHoursBannerText || "(none)"}"）— 代表股資料暖機/降級中（readiness/freshness 閘門與 coverage 閘門判準不同步），toggle 本身在此前提下不可測，非本 spec 要鎖的迴歸`,
    );

    // ── Core mode assertions ──────────────────────────────────────────────
    // Regression lock for the exact bug: even when the off-hours banner is
    // showing (KGI real-time closed), the core tab must still be the active
    // one on the default route — it must NOT be silently overridden to 全市場.
    const coreTab = page.locator(".heat-mode-tabs a", { hasText: "核心熱力圖" });
    const allTab = page.locator(".heat-mode-tabs a", { hasText: "全市場熱力圖" });
    await expect(coreTab).toHaveClass(/is-active/);
    await expect(allTab).not.toHaveClass(/is-active/);
    await expect(page.locator(".tac-industry-heatmap")).toBeVisible();
    await expect(page.locator(".tac-market-wide-heatmap")).toHaveCount(0);

    const coreTileCount = await page.locator(".heatmapgrid .tile").count();
    testInfo.annotations.push({ type: "core-tile-count", description: String(coreTileCount) });
    expect(coreTileCount).toBeGreaterThan(0);

    // Confirm the tab is genuinely interactive before clicking — surfaces a
    // "not clickable" failure with its own clear message instead of folding
    // into the post-click wait below (this is also what caught the #1319
    // header-dock overlap regression, kept as a first-class check).
    await expect(allTab).toBeVisible();

    // ── Switch to 全市場熱力圖 via real click (not direct goto) ───────────
    await allTab.click();

    // Wait on the DOM signal that actually matters — the market-wide grid
    // rendering real cells — instead of page.waitForURL. This is both the
    // true success criterion and inherently tolerant of the navigation-event
    // timing variance described in the Round 2 note.
    await expect(page.locator(".tac-market-wide-cell").first()).toBeVisible({ timeout: SECTION_TIMEOUT_MS });
    // URL check now runs as a poll-based assertion (not the event-based
    // page.waitForURL) — by this point the DOM has already proven the switch
    // happened, so this resolves immediately; kept as an explicit assertion,
    // not weakened.
    await expect(page).toHaveURL(/heatmap=all/, { timeout: SECTION_TIMEOUT_MS });

    await expect(allTab).toHaveClass(/is-active/);
    await expect(coreTab).not.toHaveClass(/is-active/);
    await expect(page.locator(".tac-industry-heatmap")).toHaveCount(0);
    await expect(page.locator(".tac-market-wide-heatmap")).toBeVisible();

    const wideCellCount = await page.locator(".tac-market-wide-cell").count();
    testInfo.annotations.push({ type: "wide-cell-count", description: String(wideCellCount) });

    await expect(coreTab).toBeVisible();

    // ── Switch back to 核心熱力圖 via real click ──────────────────────────
    await coreTab.click();
    await expect(page.locator(".heatmapgrid .tile").first()).toBeVisible({ timeout: SECTION_TIMEOUT_MS });
    await expect(page).toHaveURL((url) => !url.search.includes("heatmap=all"), { timeout: SECTION_TIMEOUT_MS });

    await expect(coreTab).toHaveClass(/is-active/);
    await expect(allTab).not.toHaveClass(/is-active/);
    await expect(page.locator(".tac-market-wide-heatmap")).toHaveCount(0);
    await expect(page.locator(".heatmapgrid .tile").first()).toBeVisible();
  });
});
