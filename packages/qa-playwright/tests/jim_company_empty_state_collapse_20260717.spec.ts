import { expect, test, type BrowserContext, type Route } from "@playwright/test";
import { expectNoServerError } from "./helpers";

// Verification for the P1 empty-state collapse fix (2026-07-17, jim6).
// 楊董裁決 (feedback_login_company_redesign_rules_2026_07_16.md): 公司頁「抓不到的
// 資訊寧願沒有欄位」— 整個面板不渲染、版面自動補位，禁「本檔目前無資券餘額資料」
// 這類空白佔位卡。This spec mocks the client-side fetches (all routed through the
// same-origin `/api/ui-final-v031/backend?path=...` proxy — see
// apps/web/lib/api.ts `shouldUseSameOriginBackendProxy`) so the empty/partial/full
// cases are deterministic regardless of trading-hours wall clock.
//
// Covers:
// (1) fully-empty full-profile + coverage 404 → #sec-chips and #company-knowledge
//     pairrows collapse to zero panels (not a placeholder card), and the ChipsPanel
//     "外資持股與分佈" section (#sec-hold) does not render at all.
// (2) partial (one side empty) → the pairrow keeps exactly one panel and it
//     reflows to the container's full width (the `:only-child` CSS rule fired).
// (3) both sides live → no regression, pairrow still shows exactly 2 panels.

const FULL_PROFILE_PATH_FRAGMENT = "/full-profile";
const COVERAGE_PATH_FRAGMENT = "/coverage";
const SHAREHOLDING_PATH_FRAGMENT = "/shareholding";

// Full shape mirrors apps/web/lib/api.ts `FullProfileEnvelope` — FullProfilePanels.tsx
// (the [06]-[11] extended detail section, always rendered on the page) reads the
// SAME full-profile response as InstitutionalPanel/MarginShortPanel, so a mock that
// only fills in `tradingFlow.{institutional,marginShort}` crashes FullProfilePanels
// with "Cannot read properties of undefined (reading 'financialStatement')" — every
// section below must be present, even when empty.
function emptySection() {
  return {
    state: "EMPTY",
    latest: null,
    history: [],
    updatedAt: new Date().toISOString(),
    sourceTrail: { source: "finmind", datasetKey: "test", recordCount: 0, degradedReason: null },
  };
}

function baseFullProfileBody() {
  return {
    data: {
      company: { id: "test-id", ticker: "2330", name: "台積電", market: "TWSE", country: "TW" },
      fundamentals: {
        monthlyRevenue: emptySection(),
        financialStatement: emptySection(),
        cashFlow: emptySection(),
        balanceSheet: emptySection(),
      },
      tradingFlow: {
        institutional: emptySection(),
        marginShort: emptySection(),
        shareholding: emptySection(),
      },
      marketIntel: {
        dividend: emptySection(),
        marketValue: emptySection(),
        valuation: emptySection(),
        news: emptySection(),
      },
    },
  };
}

function emptyFullProfileBody() {
  return baseFullProfileBody();
}

function liveFullProfileBody(opts: { institutional: boolean; marginShort: boolean }) {
  const body = baseFullProfileBody();
  if (opts.institutional) {
    body.data.tradingFlow.institutional = {
      state: "LIVE",
      latest: { date: "2026-07-16", foreign: 1200, investmentTrust: 300, dealer: -50, totalNetBuy: 1450 },
      history: [],
      updatedAt: new Date().toISOString(),
      sourceTrail: { source: "finmind", datasetKey: "test", recordCount: 1, degradedReason: null },
    } as unknown as ReturnType<typeof emptySection>;
  }
  if (opts.marginShort) {
    body.data.tradingFlow.marginShort = {
      state: "LIVE",
      latest: { date: "2026-07-16", marginBalance: 33293, shortBalance: 4821, marginChange: 120, shortChange: -30 },
      history: [],
      updatedAt: new Date().toISOString(),
      sourceTrail: { source: "finmind", datasetKey: "test", recordCount: 1, degradedReason: null },
    } as unknown as ReturnType<typeof emptySection>;
  }
  return body;
}

async function installMocks(
  context: BrowserContext,
  opts: { fullProfile: unknown; coverage404: boolean; shareholdingEmpty: boolean }
) {
  // Registered on the BrowserContext (not the Page) — the PWA service worker
  // (public/sw.js) re-issues all /api/** requests from its own execution
  // context (`event.respondWith(fetch(request, {cache:"no-store"}))`), and
  // only context-level routing reliably intercepts those service-worker-owned
  // fetches; page-level `page.route()` does not see them.
  await context.route("**/api/ui-final-v031/backend**", async (route: Route) => {
    const url = new URL(route.request().url());
    const innerPath = url.searchParams.get("path") ?? "";

    if (innerPath.includes(FULL_PROFILE_PATH_FRAGMENT)) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(opts.fullProfile) });
    }
    if (innerPath.includes(COVERAGE_PATH_FRAGMENT)) {
      if (opts.coverage404) {
        return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "not found" }) });
      }
      return route.continue();
    }
    if (innerPath.includes(SHAREHOLDING_PATH_FRAGMENT)) {
      if (opts.shareholdingEmpty) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ data: { latest: null, holdingLevels: [], latestLevelDate: null, source: "finmind" } }),
        });
      }
      return route.continue();
    }
    // kgi bidask/ticks and everything else — let the real request through
    // (off-hours these already collapse to null naturally; this spec does not
    // depend on wall-clock trading hours for its assertions).
    return route.continue();
  });
}

test.describe("company page empty-state collapse 2026-07-17", () => {
  test.describe.configure({ retries: 1 });

  // Local `next dev` compiles the huge /companies/[symbol] component tree
  // on-demand on first hit — warm it up once so the per-test navigation below
  // isn't racing a cold webpack compile on top of real backend round-trips.
  test.beforeAll(async ({ browser }) => {
    const warmPage = await browser.newPage();
    await warmPage.goto("/companies/2330", { waitUntil: "domcontentloaded", timeout: 120_000 }).catch(() => {});
    await warmPage.close();
  });

  test("3661-style: all pairrow data empty → panels do not render, no placeholder cards", async ({ page, context }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await installMocks(context, {
      fullProfile: emptyFullProfileBody(),
      coverage404: true,
      shareholdingEmpty: true,
    });

    await page.goto("/companies/2330", { waitUntil: "domcontentloaded" });
    await expectNoServerError(page);
    await page.waitForTimeout(3000);

    const chipsRow = page.locator("#sec-chips");
    await expect(chipsRow.locator(".panel")).toHaveCount(0);
    await expect(chipsRow).toBeHidden();

    const knowledgeRow = page.locator("#company-knowledge");
    await expect(knowledgeRow.locator(".panel")).toHaveCount(0);
    await expect(knowledgeRow).toBeHidden();

    // ChipsPanel ("外資持股與分佈") must not render at all — not a "本檔目前無
    // 資券餘額資料" placeholder card.
    await expect(page.locator("#sec-hold")).toHaveCount(0);
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toMatch(/近 30 日暫無融資融券資料|近 30 日暫無法人買賣超資料|本檔.*coverage 待補/);

    // Adjacent full-width sections must still render normally (no broken layout,
    // no giant blank gap left behind by the collapsed pairrows).
    await expect(page.locator("#sec-fin")).toBeVisible();
    await expect(page.locator("#sec-detail")).toBeVisible();
  });

  test("partial: only 融資融券 empty → 三大法人 panel alone reflows to full pairrow width", async ({ page, context }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await installMocks(context, {
      fullProfile: liveFullProfileBody({ institutional: true, marginShort: false }),
      coverage404: false,
      shareholdingEmpty: true,
    });

    await page.goto("/companies/2330", { waitUntil: "domcontentloaded" });
    await expectNoServerError(page);
    await page.waitForTimeout(3000);

    const chipsRow = page.locator("#sec-chips");
    await expect(chipsRow).toBeVisible();
    await expect(chipsRow.locator(".panel")).toHaveCount(1);

    const rowBox = await chipsRow.boundingBox();
    const panelBox = await chipsRow.locator(".panel").boundingBox();
    expect(rowBox).not.toBeNull();
    expect(panelBox).not.toBeNull();
    // :only-child grid-column:1/-1 should make the solo panel span (close to)
    // the full pairrow width, not half of it.
    expect((panelBox!.width) / (rowBox!.width)).toBeGreaterThan(0.9);
  });

  test("no regression: both 三大法人 and 融資融券 live → pairrow still shows 2 panels", async ({ page, context }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await installMocks(context, {
      fullProfile: liveFullProfileBody({ institutional: true, marginShort: true }),
      coverage404: false,
      shareholdingEmpty: false,
    });

    await page.goto("/companies/2330", { waitUntil: "domcontentloaded" });
    await expectNoServerError(page);
    await page.waitForTimeout(3000);

    const chipsRow = page.locator("#sec-chips");
    await expect(chipsRow).toBeVisible();
    await expect(chipsRow.locator(".panel")).toHaveCount(2);
  });
});
