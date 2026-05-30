import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve("../..");
const outDir = path.join(repoRoot, "evidence/w7_paper_sprint");
fs.mkdirSync(outDir, { recursive: true });

const screenshotPath = path.join(outDir, "trading-room-real-chart-local-20260531.png");
const reportPath = path.join(outDir, "trading-room-real-chart-local-20260531.json");
const baseUrl = process.env.IUF_QA_BASE_URL ?? "http://127.0.0.1:3311";
const initialSymbol = process.env.IUF_QA_SYMBOL ?? "2330";
const requireCanvas = process.env.IUF_QA_REQUIRE_CANVAS === "1";
const cookieFile = process.env.IUF_PLAYWRIGHT_COOKIE_FILE;
const storageStateCandidates = [
  process.env.IUF_PLAYWRIGHT_STORAGE_STATE,
  path.join(repoRoot, "packages/qa-playwright/storageState.json"),
  path.resolve(repoRoot, "../IUF_TRADING_ROOM_APP/packages/qa-playwright/storageState.json"),
].filter(Boolean);
const storageState = storageStateCandidates.find((candidate) => fs.existsSync(candidate));

const consoleEvents = [];
const requestFailures = [];

function readNetscapeCookies(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  return lines.flatMap((line) => {
    const trimmed = line.trim();
    if (!trimmed || (trimmed.startsWith("#") && !trimmed.startsWith("#HttpOnly_"))) return [];
    const parts = line.split("\t");
    if (parts.length < 7) return [];
    const [domain, , cookiePath, secure, expires, name, value] = parts;
    return [
      {
        name,
        value,
        domain: domain.replace(/^#HttpOnly_/, ""),
        path: cookiePath || "/",
        secure: String(secure).toUpperCase() === "TRUE",
        expires: Number(expires) || -1,
      },
    ];
  });
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext(
  storageState ? { storageState, viewport: { width: 1440, height: 900 } } : { viewport: { width: 1440, height: 900 } },
);
const cookies = readNetscapeCookies(cookieFile);
if (cookies.length > 0) await context.addCookies(cookies);
const page = await context.newPage();
page.on("console", (msg) => {
  if (["error", "warning"].includes(msg.type())) consoleEvents.push({ type: msg.type(), text: msg.text() });
});
page.on("requestfailed", (req) => requestFailures.push({ url: req.url(), failure: req.failure()?.errorText ?? "" }));

await page.goto(`${baseUrl}/api/ui-final-v031/paper-trading-room?symbol=${initialSymbol}`, {
  waitUntil: "domcontentloaded",
  timeout: 60000,
});
await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});

const hostFrame = page.mainFrame();
const iframe = hostFrame.locator("#real-kline-frame");
await iframe.waitFor({ timeout: 30000 });
const frameSrc = await iframe.getAttribute("src");
const klineFrame = await iframe.elementHandle().then((handle) => handle?.contentFrame());
if (!klineFrame) throw new Error("real kline iframe did not expose a content frame");

await klineFrame.locator(".kline-panel,.kline-frame-empty").first().waitFor({ timeout: 30000 });
const tabTexts = await klineFrame.locator(".kline-tab").allInnerTexts();
const canvasCount = await klineFrame.locator(".kline-chart-canvas").count();
const lightweightCanvas = await klineFrame.locator(".kline-chart-canvas canvas").count();
const canvasRects = await klineFrame.locator("canvas").evaluateAll((nodes) =>
  nodes.map((node) => {
    const rect = node.getBoundingClientRect();
    return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
  }),
);
const emptyState = await klineFrame.locator(".kline-insufficient,.kline-frame-empty,.terminal-note").count();
const note = await klineFrame.locator(".kline-frame-note").innerText().catch(() => "");
const emptyText = await klineFrame.locator(".kline-frame-empty,.terminal-note").first().innerText().catch(() => "");

const tsmcRow = hostFrame.locator(".wrow[data-sym='2330']");
if (await tsmcRow.count()) {
  await tsmcRow.first().click();
} else {
  await page.evaluate(() => window.updateRealChartFrame?.("2330"));
}
await page.waitForTimeout(900);
const updatedFrameSrc = await iframe.getAttribute("src");

await page.screenshot({ path: screenshotPath, fullPage: true });

const report = {
  url: page.url(),
  frameSrc,
  updatedFrameSrc,
  tabTexts,
  canvasCount,
  lightweightCanvas,
  canvasRects,
  emptyState,
  note,
  emptyText,
  consoleEvents,
  requestFailures,
  storageState,
  cookieFile: cookieFile ? "[provided]" : null,
  cookieCount: cookies.length,
  baseUrl,
  initialSymbol,
  requireCanvas,
};
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

await browser.close();

if (!String(frameSrc || "").includes("/final-v031/portfolio/kline-frame")) {
  throw new Error(`trading room did not mount real chart frame: ${frameSrc}`);
}
if (!String(updatedFrameSrc || "").includes("symbol=2330")) {
  throw new Error(`symbol switch did not refresh real chart frame: ${updatedFrameSrc}`);
}
if (canvasCount === 0 && emptyState === 0) {
  throw new Error("real chart frame neither rendered chart canvas nor an explicit empty state");
}
const firstReadableCanvas = canvasRects.find((rect) => rect.width >= 300 && rect.height >= 250);
if (requireCanvas && !firstReadableCanvas) {
  throw new Error(`real chart canvas is required but not visible; emptyState=${emptyState}`);
}
if (firstReadableCanvas && firstReadableCanvas.top > 260) {
  throw new Error(`real chart canvas is mounted too low for the trading room first view: top=${firstReadableCanvas.top}`);
}
if (emptyState === 0 && !tabTexts.some((text) => text.includes("MA") || text.includes("1"))) {
  throw new Error(`real chart controls not found: ${tabTexts.join(" | ")}`);
}
