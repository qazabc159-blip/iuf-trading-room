import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve("../..");
const outDir = path.join(repoRoot, "evidence/w7_paper_sprint");
const screenshotPath = path.join(outDir, "trading-room-kline-honesty-local-20260530.png");
const reportPath = path.join(outDir, "trading-room-kline-honesty-local-20260530.json");
const storageState = "C:/Users/User/Desktop/小楊機密/交易/IUF_TRADING_ROOM_APP/packages/qa-playwright/storageState.json";

const consoleEvents = [];
const requestFailures = [];
const ohlcvRequests = [];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext(fs.existsSync(storageState) ? { storageState } : {});
const page = await context.newPage();
page.on("console", (msg) => {
  if (["error", "warning"].includes(msg.type())) consoleEvents.push({ type: msg.type(), text: msg.text() });
});
page.on("requestfailed", (req) => requestFailures.push({ url: req.url(), failure: req.failure()?.errorText ?? "" }));
page.on("request", (req) => {
  const url = req.url();
  if (url.includes("/ohlcv") || url.includes("ohlcv%3Finterval")) ohlcvRequests.push(url);
});

await page.goto("http://127.0.0.1:3310/api/ui-final-v031/paper-trading-room?symbol=6202", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});

const frame = page.frames().find((candidate) => candidate.url().includes("/api/ui-final-v031/paper-trading-room"))
  ?? page.frames().find((candidate) => candidate.url().includes("/api/ui-final-v031/portfolio"))
  ?? page.frames().find((candidate) => candidate.url().includes("/final-v031/portfolio"))
  ?? page.mainFrame();

await frame.locator("#chart-state").waitFor({ timeout: 30000 });
const initialState = await frame.locator("#chart-state").innerText();
const initialCandles = await frame.locator("#candles > *").count();

await frame.locator('#tfseg button[data-tf="1m"]').click();
await page.waitForTimeout(400);
const oneMinuteState = await frame.locator("#chart-state").innerText();
const oneMinuteCandles = await frame.locator("#candles > *").count();

await frame.locator('#tfseg button[data-tf="5m"]').click();
await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(700);
const fiveMinuteState = await frame.locator("#chart-state").innerText();
const fiveMinuteCandles = await frame.locator("#candles > *").count();

await frame.locator('#tfseg button[data-tf="15m"]').click();
await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(700);
const fifteenMinuteState = await frame.locator("#chart-state").innerText();
const fifteenMinuteCandles = await frame.locator("#candles > *").count();

await frame.locator('#tfseg button[data-tf="1d"]').click();
await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(700);
const dailyState = await frame.locator("#chart-state").innerText();
const dailyCandles = await frame.locator("#candles > *").count();

await page.screenshot({ path: screenshotPath, fullPage: true });

const report = {
  url: page.url(),
  frameUrl: frame.url(),
  initialState,
  initialCandles,
  oneMinuteState,
  oneMinuteCandles,
  fiveMinuteState,
  fiveMinuteCandles,
  fifteenMinuteState,
  fifteenMinuteCandles,
  dailyState,
  dailyCandles,
  ohlcvRequests,
  consoleEvents,
  requestFailures,
};

fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
await browser.close();

if (!oneMinuteState.includes("NO_INTRADAY_DATA") || oneMinuteCandles !== 0) {
  throw new Error(`1m must clear chart and show NO_INTRADAY_DATA; got state=${oneMinuteState}, candles=${oneMinuteCandles}`);
}
if (ohlcvRequests.some((url) => /interval(?:%3D|=)1m/.test(url))) {
  throw new Error(`No timeframe should request interval=1m from trading-room controls: ${ohlcvRequests.join("\n")}`);
}
if (!dailyCandles && !dailyState.includes("NO_INTRADAY_DATA")) {
  throw new Error(`Daily chart must either render verified OHLCV bars or show an explicit no-data state; state=${dailyState}`);
}
