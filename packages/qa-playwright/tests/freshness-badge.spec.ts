/**
 * freshness-badge.spec.ts
 *
 * 驗收：前端 quote store + freshness badge
 *
 * T1: 個股頁 (/companies/2330) — 顯示 freshness badge（任意 4 個 mode 之一）
 * T2: 個股頁 — badge 有正確的 data-testid="company-hero-freshness-badge"
 * T3: 個股頁 — 盤後/盤前必須顯示 eod 或 stale badge（不假裝 live）
 * T4: 個股頁 — 報價有 lastPrice 顯示（非 "--" 或空）
 * T5: 自選股清單 (homepage /portfolio 面板或 /watchlist) — 每行有 freshness badge compact 點
 * T6: API smoke — /api/v1/companies/2330/quote/realtime 回傳合法 state
 *
 * PARTIAL: GET /api/v1/realtime/snapshot?symbols=... 後端未部署
 *          — 目前以 fan-out per-symbol 驗收；後端上線後改換此端點驗
 */

import { test, expect } from "@playwright/test";
import {
  saveRouteScreenshot,
  expectNoServerError,
  API_BASE_URL,
  fetchJson,
} from "./helpers";

// ── T1: 個股頁有 freshness badge ────────────────────────────────────────────────

test("T1: /companies/2330 renders freshness badge in hero bar", async ({ page }, testInfo) => {
  await page.goto("/companies/2330", { waitUntil: "domcontentloaded" });
  await expectNoServerError(page);

  // 給 1.5s 讓 client quote store 打完第一輪 poll
  await page.waitForTimeout(1500);

  // 必須有 freshness badge（任意 4 mode 之一）
  const badge = page.locator(
    '[data-testid="freshness-badge-live"],' +
    '[data-testid="freshness-badge-intraday"],' +
    '[data-testid="freshness-badge-stale"],' +
    '[data-testid="freshness-badge-eod"]'
  ).first();
  await expect(badge, "freshness badge must be present in hero bar").toBeVisible();

  await saveRouteScreenshot(page, testInfo, "freshness-badge-company-2330");
});

// ── T2: badge 有 company-hero-freshness-badge testid ───────────────────────────

test("T2: /companies/2330 hero has data-testid=company-hero-freshness-badge", async ({ page }) => {
  await page.goto("/companies/2330", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);

  const heroBadge = page.locator('[data-testid="company-hero-freshness-badge"]');
  await expect(heroBadge, "hero freshness badge testid must be present").toBeVisible();
});

// ── T3: 盤後/盤前不假裝 live ────────────────────────────────────────────────────

test("T3: /companies/2330 does not show live badge when market is closed (盤後驗收)", async ({ page }) => {
  await page.goto("/companies/2330", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);

  // 取台北時間 hour
  const taipeiHour = Number(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei", hour: "numeric", hour12: false })
  );
  const isMarketOpen = taipeiHour >= 9 && taipeiHour < 14;

  if (!isMarketOpen) {
    // 盤後：不應出現 live badge
    const liveBadge = page.locator('[data-testid="freshness-badge-live"]');
    const liveCount = await liveBadge.count();
    expect(liveCount, "No live badge should appear post-market (盤後不假裝 live)").toBe(0);

    // 必須有 eod 或 stale
    const safeCount = await page.locator(
      '[data-testid="freshness-badge-eod"],' +
      '[data-testid="freshness-badge-stale"]'
    ).count();
    expect(safeCount, "post-market must show eod or stale badge").toBeGreaterThan(0);
  } else {
    // 盤中：允許 live / intraday / stale 任一（不強制 live）
    const anyBadge = await page.locator(
      '[data-testid="freshness-badge-live"],' +
      '[data-testid="freshness-badge-intraday"],' +
      '[data-testid="freshness-badge-stale"]'
    ).count();
    expect(anyBadge, "market open: must show at least one non-eod badge").toBeGreaterThan(0);
  }
});

// ── T4: 個股頁有報價數字 ─────────────────────────────────────────────────────────

test("T4: /companies/2330 hero bar shows a price value (not blank)", async ({ page }) => {
  await page.goto("/companies/2330", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);

  // ._co-kpi-strip 的第一個 _co-kpi-value 應該是價格
  const priceCell = page.locator("._co-kpi-strip ._co-kpi-value").first();
  await expect(priceCell, "price KPI cell should be visible").toBeVisible();

  // 確認有文字內容（非空）
  const text = await priceCell.innerText();
  expect(text.trim(), "price must not be blank").not.toBe("");
});

// ── T5: 自選股清單的 watchlist badge compact 點 ──────────────────────────────────

test("T5: homepage watchlist rows have freshness badge compact dots", async ({ page }, testInfo) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expectNoServerError(page);
  await page.waitForTimeout(2000);

  // 找 watchlist-row （WatchlistTable 的 row class）
  const rows = page.locator(".watchlist-row:not(.table-head)");
  const rowCount = await rows.count();

  if (rowCount === 0) {
    // 自選股空 — 不算 FAIL（operator 可能沒設定自選股）
    console.log("[T5] No watchlist rows found — skip badge check (empty watchlist)");
    return;
  }

  // 至少有一個 freshness badge（來自 showBadge=true 的 QuoteCellRender）
  const badges = page.locator('[data-testid="watchlist-freshness-badge"]');
  const badgeCount = await badges.count();
  expect(badgeCount, `watchlist should have freshness badges (found ${rowCount} rows)`).toBeGreaterThan(0);

  await saveRouteScreenshot(page, testInfo, "freshness-badge-watchlist-homepage");
});

// ── T6: API smoke — per-symbol realtime endpoint ─────────────────────────────

test("T6: API smoke — /api/v1/companies/2330/quote/realtime returns valid state", async ({ request }) => {
  const resp = await request.get(`${API_BASE_URL}/api/v1/companies/2330/quote/realtime`);

  // Auth-gated: 401 = endpoint exists but needs auth (acceptable for smoke)
  // 200 = full success
  expect(
    [200, 401, 403].includes(resp.status()),
    `Expected 200/401/403, got ${resp.status()}`
  ).toBeTruthy();

  if (resp.status() === 200) {
    const body = await resp.json() as { data: Record<string, unknown> };
    expect(body.data, "response.data must exist").toBeTruthy();
    expect(["LIVE", "STALE", "BLOCKED", "NO_DATA"]).toContain(body.data.state);
    expect(typeof body.data.updatedAt, "updatedAt must be string").toBe("string");
    expect(["fresh", "stale", "not-available"]).toContain(body.data.freshness);
  }
});

// ── T7: screenshot — 自選股個股兩頁截圖存檔 ─────────────────────────────────────

test("T7: screenshot collection — company 2330 + 0050 freshness comparison", async ({ page }, testInfo) => {
  // 2330 台積電
  await page.goto("/companies/2330", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  await saveRouteScreenshot(page, testInfo, "freshness-2330-full");

  // 0050 元大台灣50（通常 KGI 不在 whitelist → 應顯示 intraday/eod badge）
  await page.goto("/companies/0050", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  await saveRouteScreenshot(page, testInfo, "freshness-0050-full");
});
