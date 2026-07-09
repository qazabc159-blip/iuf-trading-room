import { expect, test, type Page } from "@playwright/test";
import { expectNoServerError, saveRouteScreenshot } from "./helpers";

/**
 * Mobile 390px anti-regression baseline — M1 (2026-07-05) + M2 (2026-07-06).
 *
 * M1 targeted the three highest-frequency READ paths: 首頁戰情台 (/), AI
 * 推薦 (/ai-recommendations), 警示 (/alerts). M2 adds 公司頁
 * (/companies/2330) — one of the highest-value pages (K線/五檔/AI分析/主題).
 * M3 adds the remaining read paths: 量化策略 (/quant-strategies + detail),
 * 績效記帳 (/track-record), 複盤 (/reviews), and the 3 /settings sub-pages
 * (account/broker/subscription) — /market-intel is intentionally excluded:
 * it is a full-bleed <iframe> wrapper (FinalOnlyFrame), so this parent-DOM
 * overflow/touch-target audit cannot see inside it.
 * Runs on the "mobile-iphone-13" Playwright project (390x844 viewport — see
 * playwright.config.ts), so no viewport override is needed here; the spec
 * skips itself on other projects so it stays a dedicated 390px gate rather
 * than a general one.
 *
 * Asserts, per route:
 *  1. No page-level horizontal overflow (scrollWidth <= clientWidth + 1px).
 *     Component-level horizontal-scroll containers are allowed and expected
 *     (e.g. the sidebar nav tab strip on home, the sub-score table on AI
 *     recommendation cards, the 財報/月營收 tab strip on the company page)
 *     — only the page BODY itself must never scroll sideways at this width.
 *  2. A route-specific key element is visible, proving the page rendered
 *     real content (not a blank/broken shell) at 390px.
 *
 * Later M3-M4 waves append more routes to ROUTES below — keep this one file
 * as the running mobile regression ledger rather than splitting per page.
 */

const MOBILE_PROJECT = "mobile-iphone-13";

type MobileRoute = {
  path: string;
  label: string;
  assertVisible: (page: Page) => Promise<void>;
};

const ROUTES: MobileRoute[] = [
  {
    path: "/",
    label: "首頁戰情台",
    assertVisible: async (page) => {
      await expect(page.locator(".tactical-dashboard")).toBeVisible();
      // NOTE: ".tac-sidebar" alone is ambiguous — both the app-level
      // Sidebar (.app-tactical-sidebar) and the page-level TacticalSidebar
      // carry the class. Assert the page content column instead.
      await expect(page.locator(".tac-content")).toBeVisible();
    },
  },
  {
    path: "/ai-recommendations",
    label: "AI 推薦",
    assertVisible: async (page) => {
      await expect(page.locator(".page-frame")).toBeVisible();
      await expect(page.getByText("今日 AI 推薦")).toBeVisible();
    },
  },
  {
    path: "/alerts",
    label: "警示",
    assertVisible: async (page) => {
      await expect(page.locator(".page-frame")).toBeVisible();
      await expect(page.locator("._alr-hero-row")).toBeVisible();
    },
  },
  {
    path: "/companies/2330",
    label: "公司頁",
    assertVisible: async (page) => {
      // .company-workbench-shell wraps the K-line chart (main visual);
      // .company-side-column wraps BidAsk/tick-stream/institutional panels.
      // Both render regardless of LIVE/BLOCKED/EMPTY data state.
      await expect(page.locator(".company-workbench-shell")).toBeVisible();
      await expect(page.locator(".company-side-column")).toBeVisible();
    },
  },
  {
    path: "/quant-strategies",
    label: "量化策略",
    assertVisible: async (page) => {
      await expect(page.locator(".page-frame")).toBeVisible();
      await expect(page.locator("._qnt-tabs")).toBeVisible();
    },
  },
  {
    path: "/quant-strategies/cont_liq_v36",
    label: "量化策略詳情",
    assertVisible: async (page) => {
      await expect(page.getByText("IUF QUANT STRATEGY")).toBeVisible();
    },
  },
  {
    path: "/track-record",
    label: "績效記帳",
    assertVisible: async (page) => {
      await expect(page.locator(".page-frame")).toBeVisible();
      await expect(page.getByText("公開績效記帳")).toBeVisible();
    },
  },
  {
    path: "/reviews",
    label: "複盤",
    assertVisible: async (page) => {
      await expect(page.locator(".page-frame")).toBeVisible();
      await expect(page.getByText("本週復盤")).toBeVisible();
    },
  },
  {
    path: "/settings",
    label: "設定中心",
    assertVisible: async (page) => {
      await expect(page.getByText("設定中心")).toBeVisible();
    },
  },
  {
    path: "/settings/account",
    label: "設定 / 帳號",
    assertVisible: async (page) => {
      await expect(page.getByText("帳號與安全")).toBeVisible();
      await expect(page.locator(".settings-back-link")).toBeVisible();
    },
  },
  {
    path: "/settings/broker",
    label: "設定 / 券商連線",
    assertVisible: async (page) => {
      await expect(page.getByText("券商連線與交易模式")).toBeVisible();
      await expect(page.locator(".broker-connections-panel")).toBeVisible();
    },
  },
  {
    path: "/settings/subscription",
    label: "設定 / 訂閱",
    assertVisible: async (page) => {
      await expect(page.getByText("訂閱與權限")).toBeVisible();
      await expect(page.locator(".settings-feature-table")).toBeVisible();
    },
  },
];

for (const route of ROUTES) {
  test(`mobile-390: ${route.label} (${route.path}) has no page-level horizontal overflow`, async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== MOBILE_PROJECT,
      `mobile-390 is the dedicated 390px baseline; runs only on the "${MOBILE_PROJECT}" project.`,
    );
    test.setTimeout(45_000);

    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    await page.goto(route.path, { waitUntil: "domcontentloaded" });
    await expectNoServerError(page);
    // Give client hydration + data fetches time to settle before measuring
    // layout (mirrors site-health.spec.ts's blank-shell guard timing).
    await page.waitForTimeout(3_000);

    await route.assertVisible(page);

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));

    await saveRouteScreenshot(page, testInfo, `mobile390_${route.path.replace(/\//g, "_") || "_home"}`);

    expect(
      overflow.scrollWidth,
      `${route.path} page body scrolled horizontally at 390px: scrollWidth=${overflow.scrollWidth} > clientWidth=${overflow.clientWidth}`,
    ).toBeLessThanOrEqual(overflow.clientWidth + 1);

    const blockingConsole = consoleErrors.filter((l) =>
      /401|403|500|Application error|server-side exception|TypeError|is not a function|Cannot read prop/i.test(l),
    );
    expect(
      blockingConsole,
      `${route.path} surfaced blocking console errors at 390px: ${blockingConsole.slice(0, 3).join(" | ")}`,
    ).toEqual([]);
  });
}
