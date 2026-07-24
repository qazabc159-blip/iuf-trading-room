import { chromium } from "@playwright/test";

const BASE = "https://app.eycvector.com";
const pages = ["/", "/market-intel", "/ai-recommendations", "/desk-exact", "/companies/2330"];

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  // login
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.fill('input[type="email"]', "qazabc159@gmail.com");
  await page.fill('input[type="password"]', (process.env.IUF_QA_OWNER_PASSWORD ?? process.env.SEED_OWNER_PASSWORD));
  await Promise.all([
    page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 15000 }),
    page.click('button[type="submit"]'),
  ]);

  const results = {};
  for (const p of pages) {
    const errors = [];
    const pageErrors = [];
    const onConsole = (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    };
    const onPageError = (err) => pageErrors.push(String(err));
    page.on("console", onConsole);
    page.on("pageerror", onPageError);
    const resp = await page.goto(`${BASE}${p}`, { waitUntil: "networkidle", timeout: 30000 }).catch((e) => ({ status: () => "NAV_ERR:" + e.message }));
    await page.waitForTimeout(1500);
    results[p] = {
      status: typeof resp.status === "function" ? resp.status() : resp,
      consoleErrors: errors,
      pageErrors,
    };
    page.off("console", onConsole);
    page.off("pageerror", onPageError);
  }

  console.log(JSON.stringify(results, null, 2));
  await browser.close();
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
