import { expect, test } from "@playwright/test";
import {
  API_BASE_URL,
  expectNoServerError,
  extractFrame,
  fetchJson,
  saveRouteScreenshot
} from "./helpers";

type LookupResponse = { items?: Array<{ ticker?: string; symbol?: string; name?: string }> };
type PreviewResponse = { data?: { blocked?: boolean; riskCheck?: { decision?: string }; quoteGate?: { decision?: string } } };

const SYMBOLS = ["2330", "2454", "2317", "1809", "1723"];

function isTradingRoomQuoteRead(url: string): boolean {
  if (url.includes("/api/v1/kgi/quote/")) return true;
  if (/\/api\/v1\/companies\/[^/]+\/quote\/realtime/.test(url)) return true;

  try {
    const parsed = new URL(url);
    const proxiedPath = parsed.searchParams.get("path") ?? "";
    return (
      proxiedPath.includes("/api/v1/kgi/quote/") ||
      /\/api\/v1\/companies\/[^/]+\/quote\/realtime/.test(proxiedPath)
    );
  } catch {
    return false;
  }
}

function isTradingRoomQuoteStream(url: string): boolean {
  return url.includes("/api/ui-final-v031/quote-stream");
}

test("/portfolio trading room keeps K-line stable while live quote stream/pulse reads real endpoints @smoke", async ({ page }, testInfo) => {
  test.setTimeout(90_000);

  const quoteReads: Array<{ url: string; status: number }> = [];
  const quoteStreams: Array<{ url: string; status: number }> = [];
  const consoleErrors: string[] = [];

  page.on("response", (response) => {
    const url = response.url();
    if (isTradingRoomQuoteRead(url)) {
      quoteReads.push({ url, status: response.status() });
    }
    if (isTradingRoomQuoteStream(url)) {
      quoteStreams.push({ url, status: response.status() });
    }
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });

  await page.goto("/api/ui-final-v031/paper-trading-room?symbol=2330&rev=qa-live-pulse-smoke", {
    waitUntil: "domcontentloaded",
  });
  await expectNoServerError(page);
  await expect(page.locator(".troom")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#real-kline-frame")).toBeVisible({ timeout: 30_000 });
  const realFrameHandle = await page.locator("#real-kline-frame").elementHandle();
  const realFrame = await realFrameHandle?.contentFrame();
  expect(realFrame, "direct trading room real K-line iframe must be inspectable").toBeTruthy();
  await realFrame!.waitForSelector(".trading-room-real-kline-frame", { state: "visible", timeout: 30_000 });
  const initialViewport = await page.evaluate(() => {
    const body = document.body;
    const room = document.querySelector<HTMLElement>(".troom");
    const rightPane = document.querySelector<HTMLElement>(".rpane");
    const form = document.querySelector<HTMLElement>(".tform");
    const frameShell = document.querySelector<HTMLElement>(".real-kline-frame-shell");
    const win = window as typeof window & { __IUF_REAL_KLINE_FRAME_RELOAD_COUNT__?: number };
    return {
      bodyOverflow: body.scrollWidth - body.clientWidth,
      bodyVerticalOverflow: body.scrollHeight - body.clientHeight,
      roomOverflow: room ? room.scrollWidth - room.clientWidth : 0,
      rightPaneOverflow: rightPane ? rightPane.scrollWidth - rightPane.clientWidth : 0,
      rightPaneVerticalOverflow: rightPane ? rightPane.scrollHeight - rightPane.clientHeight : 0,
      formOverflow: form ? form.scrollWidth - form.clientWidth : 0,
      formVerticalOverflow: form ? form.scrollHeight - form.clientHeight : 0,
      frameShellOverflow: frameShell ? frameShell.scrollWidth - frameShell.clientWidth : 0,
      frameShellVerticalOverflow: frameShell ? frameShell.scrollHeight - frameShell.clientHeight : 0,
      frameReloads: win.__IUF_REAL_KLINE_FRAME_RELOAD_COUNT__ ?? 0,
    };
  });
  const initialInnerViewport = await realFrame!.evaluate(() => {
    const body = document.body;
    const root = document.querySelector<HTMLElement>(".trading-room-real-kline-frame");
    const host = document.querySelector<HTMLElement>(".trading-room-kline-host");
    const bodyStyle = window.getComputedStyle(body);
    return {
      bodyOverflow: body.scrollWidth - body.clientWidth,
      bodyVerticalOverflow: body.scrollHeight - body.clientHeight,
      bodyOverflowX: bodyStyle.overflowX,
      bodyOverflowY: bodyStyle.overflowY,
      rootOverflow: root ? root.scrollWidth - root.clientWidth : 0,
      rootVerticalOverflow: root ? root.scrollHeight - root.clientHeight : 0,
      hostOverflow: host ? host.scrollWidth - host.clientWidth : 0,
      hostVerticalOverflow: host ? host.scrollHeight - host.clientHeight : 0,
    };
  });
  expect(initialViewport.bodyOverflow, "trading room body must not create horizontal scrollbar").toBeLessThanOrEqual(2);
  expect(initialViewport.bodyVerticalOverflow, "trading room body must not create vertical scrollbar").toBeLessThanOrEqual(2);
  expect(initialViewport.roomOverflow, "trading room grid must stay within viewport width").toBeLessThanOrEqual(2);
  expect(initialViewport.rightPaneOverflow, "right ticket pane must not overflow horizontally").toBeLessThanOrEqual(2);
  expect(initialViewport.rightPaneVerticalOverflow, "right ticket pane must fit the viewport without native vertical scrollbars").toBeLessThanOrEqual(2);
  expect(initialViewport.formOverflow, "order ticket form must not overflow horizontally").toBeLessThanOrEqual(2);
  expect(initialViewport.formVerticalOverflow, "order ticket form must not overflow vertically").toBeLessThanOrEqual(2);
  expect(initialViewport.frameShellOverflow, "real K-line iframe shell must not overflow horizontally").toBeLessThanOrEqual(2);
  expect(initialViewport.frameShellVerticalOverflow, "real K-line iframe shell must not overflow vertically").toBeLessThanOrEqual(2);
  expect(initialInnerViewport.bodyOverflow, "real K-line iframe body must not create a horizontal scrollbar").toBeLessThanOrEqual(2);
  expect(["hidden", "clip"], "real K-line iframe body must suppress native horizontal scrollbars").toContain(
    initialInnerViewport.bodyOverflowX,
  );
  expect(["hidden", "clip"], "real K-line iframe body must suppress native vertical scrollbars").toContain(
    initialInnerViewport.bodyOverflowY,
  );
  expect(initialInnerViewport.rootOverflow, "real K-line frame root must stay inside its viewport").toBeLessThanOrEqual(2);
  expect(initialInnerViewport.rootVerticalOverflow, "real K-line frame root must not overflow vertically").toBeLessThanOrEqual(2);
  expect(initialInnerViewport.hostOverflow, "real K-line host must stay inside its viewport").toBeLessThanOrEqual(2);
  expect(initialInnerViewport.hostVerticalOverflow, "real K-line host must not overflow vertically").toBeLessThanOrEqual(2);
  const quoteQualityBadge = page.locator("#quote-quality-badge");
  const hasQuoteQualityBadge = await quoteQualityBadge.count().then((count) => count > 0);
  if (hasQuoteQualityBadge) {
    await expect(quoteQualityBadge).toBeVisible({ timeout: 30_000 });
  }

  await page.waitForFunction(
    () => Boolean((window as { __IUF_FINAL_V031_QUOTE_PULSE_STARTED__?: boolean }).__IUF_FINAL_V031_QUOTE_PULSE_STARTED__),
    { timeout: 45_000 },
  );
  await expect
    .poll(
      () => (quoteStreams.length >= 1 || quoteReads.length >= 2 ? 1 : 0),
      {
        message: "live quote stream or fallback pulse must read real quote endpoints",
        timeout: 45_000,
      },
    )
    .toBe(1);
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const state = (window as typeof window & {
            __IUF_FINAL_V031_QUOTE_STREAM_STATE__?: { state?: string; lastMessageAt?: number | null };
          }).__IUF_FINAL_V031_QUOTE_STREAM_STATE__;
          return Boolean(state?.lastMessageAt || state?.state === "message" || state?.state === "ready");
        }),
      {
        message: "live quote stream should open or the fallback pulse should remain available",
      timeout: 45_000,
      },
    )
    .toBeTruthy();

  const before = await page.evaluate(() => {
    const frame = document.querySelector<HTMLIFrameElement>("#real-kline-frame");
    const iufWindow = window as typeof window & {
      __IUF_FINAL_V031_QUOTE_PULSE_STARTED__?: boolean;
      __IUF_FINAL_V031_LIVE_REFRESH_STARTED__?: boolean;
      __IUF_FINAL_V031_QUOTE_PULSE_ERROR__?: string | null;
      __IUF_FINAL_V031_QUOTE_STREAM_STATE__?: { state?: string; lastMessageAt?: number | null; degraded?: boolean | null };
      __IUF_FINAL_V031_LIVE__?: { selected?: { symbol?: string } };
    };
    return {
      frameSrc: frame?.getAttribute("src") ?? null,
      pulseStarted: Boolean(iufWindow.__IUF_FINAL_V031_QUOTE_PULSE_STARTED__),
      fullRefreshStarted: Boolean(iufWindow.__IUF_FINAL_V031_LIVE_REFRESH_STARTED__),
      pulseError: iufWindow.__IUF_FINAL_V031_QUOTE_PULSE_ERROR__ ?? null,
      streamState: iufWindow.__IUF_FINAL_V031_QUOTE_STREAM_STATE__ ?? null,
      symbol: iufWindow.__IUF_FINAL_V031_LIVE__?.selected?.symbol ?? null,
    };
  });

  await page.waitForTimeout(6_500);
  const afterFrameSrc = await page.evaluate(
    () => document.querySelector<HTMLIFrameElement>("#real-kline-frame")?.getAttribute("src") ?? null,
  );
  const afterFrameReloads = await page.evaluate(
    () => (window as typeof window & { __IUF_REAL_KLINE_FRAME_RELOAD_COUNT__?: number }).__IUF_REAL_KLINE_FRAME_RELOAD_COUNT__ ?? 0,
  );

  expect(before.symbol, "trading room should load the selected symbol").toBe("2330");
  expect(before.pulseStarted, "live quote pulse must start in the trading room").toBe(true);
  expect(before.fullRefreshStarted, "full live refresh guard must start once").toBe(true);
  expect(before.pulseError, "quote pulse should not throw client errors").toBeNull();
  expect(before.streamState?.state, "live quote SSE stream must expose browser-visible state").toBeTruthy();
  if (hasQuoteQualityBadge) {
    await expect(
      quoteQualityBadge,
      "visible quote quality badge must describe stream/fallback freshness",
    ).toContainText(/行情|輪詢|LIVE|退化|延遲/);
  }
  expect(afterFrameSrc, "quote pulse must not reload or change the real K-line iframe").toBe(before.frameSrc);
  expect(afterFrameReloads, "quote pulse/full refresh must not remount the real K-line iframe").toBe(initialViewport.frameReloads);

  expect(
    quoteStreams.length >= 1 || quoteReads.length >= 2,
    "live quote SSE stream or fallback pulse must read quote/bidask/ticks endpoints",
  ).toBe(true);
  expect(
    quoteStreams.filter((entry) => entry.status === 401 || entry.status === 403),
    "owner-session trading room quote stream must not be blocked by auth",
  ).toEqual([]);
  expect(
    quoteStreams.filter((entry) => entry.status >= 500 || entry.status === 404),
    "trading room quote stream must not hit missing or server-error endpoints",
  ).toEqual([]);
  expect(
    quoteReads.filter((entry) => entry.status === 401 || entry.status === 403),
    "owner-session trading room quote reads must not be blocked by auth",
  ).toEqual([]);
  expect(
    quoteReads.filter((entry) => entry.status >= 500 || entry.status === 404),
    "trading room quote reads must not hit missing or server-error endpoints",
  ).toEqual([]);
  expect(
    consoleErrors.filter((line) => /401|403|Application error|server-side exception/i.test(line)),
    "trading room must not surface auth/server console errors while reading live quotes",
  ).toEqual([]);

  await saveRouteScreenshot(page, testInfo, "portfolio-live-pulse");
});

test("/portfolio supports 5-symbol handoff, visible ticket update, indicator toggles, and paper preview", async ({ page, request }, testInfo) => {
  test.setTimeout(120_000);

  for (const symbol of SYMBOLS) {
    const lookup = await fetchJson<LookupResponse>(request, `/api/v1/companies/lookup?q=${symbol}`);
    expect(JSON.stringify(lookup), `lookup must resolve ${symbol}`).toContain(symbol);

    await page.goto(`/portfolio?symbol=${symbol}`, { waitUntil: "domcontentloaded" });
    await expectNoServerError(page);
    await expect(page.locator(".header-dock"), "full trading room route must hide the floating app header dock").toBeHidden({
      timeout: 30_000,
    });
    await expect(page.locator("iframe")).toHaveCount(1);

    const frame = extractFrame(page);
    await expect(frame.locator(".symhead .sym"), `portfolio header must switch to selected symbol ${symbol}`).toContainText(symbol, {
      timeout: 30_000,
    });
    await expect(frame.locator("#t-sym"), `paper ticket must switch to selected symbol ${symbol}`).toHaveValue(new RegExp(symbol), {
      timeout: 30_000,
    });
    await expect(frame.locator("body")).toContainText(/委託|Paper|紙上|買進|LONG/i);

    const klineFrame = frame.frameLocator("#real-kline-frame");
    await expect(frame.locator("#real-kline-frame"), "real K-line frame must be mounted").toBeVisible({ timeout: 30_000 });
    const outerFit = await page.evaluate(() => {
      const body = document.body;
      const shell = document.querySelector<HTMLElement>(".iuf-final-content-frame");
      return {
        bodyOverflow: body.scrollWidth - body.clientWidth,
        bodyVerticalOverflow: body.scrollHeight - body.clientHeight,
        shellOverflow: shell ? shell.scrollWidth - shell.clientWidth : 0,
        shellVerticalOverflow: shell ? shell.scrollHeight - shell.clientHeight : 0,
      };
    });
    expect(outerFit.bodyOverflow, "/portfolio app shell must not create a horizontal scrollbar").toBeLessThanOrEqual(2);
    expect(outerFit.bodyVerticalOverflow, "/portfolio app shell must not create a vertical scrollbar").toBeLessThanOrEqual(2);
    expect(outerFit.shellOverflow, "FinalOnlyFrame shell must stay inside viewport width").toBeLessThanOrEqual(2);
    expect(outerFit.shellVerticalOverflow, "FinalOnlyFrame shell must stay inside viewport height").toBeLessThanOrEqual(2);
    const nestedFrameHandle = await frame.locator("#real-kline-frame").elementHandle();
    const nestedFrame = await nestedFrameHandle?.contentFrame();
    expect(nestedFrame, "real K-line iframe should be inspectable from portfolio route").toBeTruthy();
    await nestedFrame!.waitForSelector(".trading-room-real-kline-frame", { state: "visible", timeout: 30_000 });
    const innerFit = await nestedFrame!.evaluate(() => {
      const body = document.body;
      const root = document.querySelector<HTMLElement>(".trading-room-real-kline-frame");
      const bodyStyle = window.getComputedStyle(body);
      return {
        bodyOverflow: body.scrollWidth - body.clientWidth,
        bodyVerticalOverflow: body.scrollHeight - body.clientHeight,
        bodyOverflowX: bodyStyle.overflowX,
        bodyOverflowY: bodyStyle.overflowY,
        rootOverflow: root ? root.scrollWidth - root.clientWidth : 0,
        rootVerticalOverflow: root ? root.scrollHeight - root.clientHeight : 0,
      };
    });
    expect(innerFit.bodyOverflow, "nested K-line iframe body must not create horizontal scrollbars").toBeLessThanOrEqual(2);
    expect(["hidden", "clip"], "nested K-line iframe body must suppress native horizontal scrollbars").toContain(
      innerFit.bodyOverflowX,
    );
    expect(["hidden", "clip"], "nested K-line iframe body must suppress native vertical scrollbars").toContain(
      innerFit.bodyOverflowY,
    );
    expect(innerFit.rootOverflow, "nested K-line root must stay inside viewport width").toBeLessThanOrEqual(2);
    expect(innerFit.rootVerticalOverflow, "nested K-line root must stay inside viewport height").toBeLessThanOrEqual(2);

    const viewportTools = klineFrame.getByTestId("kline-viewport-tools");
    await expect(viewportTools, "real K-line viewport controls must be visible in the trading room").toBeVisible({
      timeout: 30_000,
    });
    await expect(
      viewportTools.locator(".count"),
      "real K-line viewport controls must expose visible/total bar count",
    ).toContainText(/顯示\s+[\d,]+\s*\/\s*[\d,]+\s+根/);

    if (symbol === SYMBOLS[0]) {
      const frameSrcBefore = await frame.locator("#real-kline-frame").getAttribute("src");
      for (const label of ["放大", "縮小", "回最新", "全覽"]) {
        await viewportTools.getByRole("button", { name: label }).click();
      }
      await expect(
        frame.locator("#real-kline-frame"),
        "K-line viewport controls must not remount or navigate the embedded real chart",
      ).toHaveAttribute("src", frameSrcBefore ?? "");
    }

    for (const selector of ["button._ind-toggle-btn._ma20", "button._ind-toggle-btn._vwap"]) {
      const toggle = klineFrame.locator(selector).first();
      await expect(toggle, `${selector} must be a visible real chart toggle`).toBeVisible({ timeout: 30_000 });
      const before = await toggle.getAttribute("aria-pressed");
      expect(before, `${selector} must expose pressed state`).toMatch(/^(true|false)$/);
      await toggle.click();
      await expect(toggle, `${selector} must change state after click`).toHaveAttribute(
        "aria-pressed",
        before === "true" ? "false" : "true",
      );
      await toggle.click();
      await expect(toggle, `${selector} must restore state after second click`).toHaveAttribute("aria-pressed", before ?? "true");
    }
  }

  const preview = await request.post(`${API_BASE_URL}/api/v1/paper/preview`, {
    data: {
      idempotencyKey: `qa-preview-${Date.now()}`,
      symbol: "2330",
      side: "buy",
      orderType: "limit",
      qty: 1,
      quantity_unit: "SHARE",
      price: 2240
    }
  });
  expect(preview.ok(), `paper preview must return 2xx, got ${preview.status()}`).toBeTruthy();
  const previewJson = (await preview.json()) as PreviewResponse;
  expect(previewJson.data?.riskCheck?.decision, "paper preview must run real risk check").toBeTruthy();

  await saveRouteScreenshot(page, testInfo, "portfolio");
});
