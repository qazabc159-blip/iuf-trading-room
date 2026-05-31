import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve("../..");
const outDir = path.join(repoRoot, "evidence/w7_paper_sprint");
fs.mkdirSync(outDir, { recursive: true });

const baseUrl = process.env.IUF_QA_BASE_URL ?? "http://127.0.0.1:3021";
const symbol = process.env.IUF_QA_SYMBOL ?? "2330";
const screenshotPath = path.join(outDir, "trading-room-perf-indicators-local-20260531.png");
const reportPath = path.join(outDir, "trading-room-perf-indicators-local-20260531.json");
const storageState = path.join(repoRoot, "packages/qa-playwright/storageState.json");
const consoleEvents = [];
const requestFailures = [];

function localCookieMirrors(cookies, url) {
  const host = new URL(url).hostname;
  if (!["127.0.0.1", "localhost"].includes(host)) return [];
  return cookies
    .filter((cookie) => cookie.name && cookie.value)
    .map((cookie) => ({
      name: cookie.name,
      value: cookie.value,
      domain: host,
      path: cookie.path || "/",
      httpOnly: cookie.httpOnly ?? true,
      secure: false,
      sameSite: cookie.sameSite ?? "Lax",
      expires: cookie.expires ?? -1,
    }));
}

const state = fs.existsSync(storageState)
  ? JSON.parse(fs.readFileSync(storageState, "utf8"))
  : { cookies: [], origins: [] };

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  storageState: fs.existsSync(storageState) ? storageState : undefined,
  viewport: { width: 1440, height: 900 },
});
const mirroredCookies = localCookieMirrors(state.cookies ?? [], baseUrl);
if (mirroredCookies.length > 0) await context.addCookies(mirroredCookies);

const page = await context.newPage();
page.on("console", (msg) => {
  if (["error", "warning"].includes(msg.type())) consoleEvents.push({ type: msg.type(), text: msg.text() });
});
page.on("requestfailed", (req) => requestFailures.push({ url: req.url(), failure: req.failure()?.errorText ?? "" }));

const startedAt = Date.now();
await page.goto(`${baseUrl}/api/ui-final-v031/paper-trading-room?symbol=${symbol}`, {
  waitUntil: "domcontentloaded",
  timeout: 60000,
});
const domContentLoadedMs = Date.now() - startedAt;

const iframe = page.locator("#real-kline-frame");
await iframe.waitFor({ timeout: 30000 });
const loadingOverlayVisibleAtStart = await page.locator("#real-kline-loading").isVisible().catch(() => false);
const klineFrame = await iframe.elementHandle().then((handle) => handle?.contentFrame());
if (!klineFrame) throw new Error("K-line iframe did not expose a content frame");

await klineFrame.locator(".kline-panel,.kline-frame-empty").first().waitFor({ timeout: 60000 });
await klineFrame.locator(".kline-chart-canvas canvas").first().waitFor({ timeout: 60000 });
const firstChartVisibleMs = Date.now() - startedAt;

const beforeSrc = await iframe.getAttribute("src");
await page.waitForTimeout(12000);
const afterSrc = await iframe.getAttribute("src");

const metrics = await klineFrame.evaluate(() => {
  const rect = (selector) => {
    const node = document.querySelector(selector);
    if (!node) return null;
    const r = node.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height, top: r.top, bottom: r.bottom };
  };
  return {
    toolbar: rect(".kline-toolbar"),
    signalStrip: rect("[data-testid='trading-room-kline-signal-strip']"),
    canvas: rect(".kline-chart-canvas"),
    readout: rect(".kline-readout-ribbon"),
    tabTexts: Array.from(document.querySelectorAll(".kline-tab")).map((node) => node.textContent?.trim() ?? ""),
    signalText: document.querySelector("[data-testid='trading-room-kline-signal-strip']")?.textContent ?? "",
    activeTab: document.querySelector(".kline-tab.is-active")?.textContent?.trim() ?? "",
  };
});

await klineFrame.locator(".kline-tab", { hasText: "5分" }).first().click();
await klineFrame.locator(".kline-tab.is-active", { hasText: "5分" }).first().waitFor({ timeout: 10000 });
const fiveMinuteText = await klineFrame.locator(".kline-meta-line,.kline-density-strip,.terminal-note").allInnerTexts().catch(() => []);

const canvasBox = await klineFrame.locator(".kline-chart-canvas").boundingBox();
if (canvasBox) {
  await page.mouse.move(canvasBox.x + canvasBox.width * 0.55, canvasBox.y + canvasBox.height * 0.45);
  await page.mouse.wheel(0, -420);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + canvasBox.width * 0.35, canvasBox.y + canvasBox.height * 0.45, { steps: 8 });
  await page.mouse.up();
}

await page.screenshot({ path: screenshotPath, fullPage: true });
const report = {
  url: page.url(),
  baseUrl,
  symbol,
  domContentLoadedMs,
  firstChartVisibleMs,
  loadingOverlayVisibleAtStart,
  beforeSrc,
  afterSrc,
  klineSrcStable: beforeSrc === afterSrc,
  metrics,
  fiveMinuteText,
  consoleEvents,
  requestFailures,
  mirroredCookieCount: mirroredCookies.length,
  screenshotPath,
};
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
await browser.close();

if (!report.klineSrcStable) throw new Error(`K-line iframe source changed during idle wait: ${beforeSrc} -> ${afterSrc}`);
if (!metrics.canvas || metrics.canvas.width < 700 || metrics.canvas.height < 280) throw new Error(`K-line canvas too small: ${JSON.stringify(metrics.canvas)}`);
if (!metrics.toolbar || !metrics.signalStrip || metrics.toolbar.bottom > metrics.canvas.top) throw new Error(`Toolbar/signal strip not above chart canvas: ${JSON.stringify(metrics)}`);
if (!metrics.signalText.includes("MA20") || !metrics.signalText.includes("VWAP") || !metrics.signalText.includes("RSI")) {
  throw new Error(`Data-driven indicator summary missing: ${metrics.signalText}`);
}
if (!fiveMinuteText.join(" ").match(/5|分|FinMind|K/)) throw new Error(`5-minute interaction did not expose a data state: ${fiveMinuteText.join(" | ")}`);
