import { chromium } from "@playwright/test";

const BASE = "https://app.eycvector.com";

async function checkViewport(browser, viewport, label) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [];
  const pageErrors = [];
  page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
  page.on("pageerror", (err) => pageErrors.push(String(err)));

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.fill('input[type="email"]', "qazabc159@gmail.com");
  await page.fill('input[type="password"]', (process.env.IUF_QA_OWNER_PASSWORD ?? process.env.SEED_OWNER_PASSWORD));
  await Promise.all([
    page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 15000 }),
    page.click('button[type="submit"]'),
  ]);

  await page.goto(`${BASE}/ai-recommendations`, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(1500);

  const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
  const viewportWidth = viewport.width;
  const overflow = bodyWidth - viewportWidth;

  const cardGridCount = await page.locator('[class*="card-grid"], [class*="ai-rec-card"], [class*="stat-tile"], [class*="chip"]').count();
  const bodyText = await page.evaluate(() => document.body.innerText);
  const hasOldCardMarkers = /信心指數|評分卡/.test(bodyText);

  await page.screenshot({ path: `_bruce_1353_${label}.png`, fullPage: true });

  await context.close();
  return { label, bodyWidth, viewportWidth, overflow, cardGridCount, hasOldCardMarkers, consoleErrors: errors, pageErrors, bodyTextSample: bodyText.slice(0, 500) };
}

async function main() {
  const browser = await chromium.launch();
  const desktop = await checkViewport(browser, { width: 1440, height: 900 }, "desktop");
  const mobile = await checkViewport(browser, { width: 390, height: 844 }, "mobile390");
  console.log(JSON.stringify({ desktop, mobile }, null, 2));
  await browser.close();
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
