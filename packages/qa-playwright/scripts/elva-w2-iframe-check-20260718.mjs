// Elva follow-up — measure INSIDE the market-intel iframe at 390px (post-#1302/#1303)
import { chromium, request as pwRequest } from "@playwright/test";

const WEB = "https://app.eycvector.com";
const API = "https://api.eycvector.com";

const email = process.env.SEED_OWNER_EMAIL ?? "qazabc159@gmail.com";
const password = process.env.SEED_OWNER_PASSWORD ?? "qazabc159";

const apiCtx = await pwRequest.newContext({ baseURL: API, storageState: { cookies: [], origins: [] } });
const loginResp = await apiCtx.post("/auth/login", { data: { email, password }, headers: { "Content-Type": "application/json" } });
if (!loginResp.ok()) { console.error("LOGIN FAILED", loginResp.status()); process.exit(1); }
const state = await apiCtx.storageState();
const sess = state.cookies.find((c) => c.name === "iuf_session");
state.cookies.push({ ...sess, domain: "app.eycvector.com", secure: true });
await apiCtx.dispose();

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ storageState: state, viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
await page.goto(`${WEB}/market-intel`, { waitUntil: "networkidle", timeout: 45000 });
await page.waitForTimeout(5000);

const frames = page.frames().map((f) => f.url());
console.log("frames:", JSON.stringify(frames, null, 2));

const inner = page.frames().find((f) => f.url().includes("ui-final"));
if (!inner) { console.error("NO MARKET-INTEL IFRAME FOUND"); await browser.close(); process.exit(1); }

const m = await inner.evaluate(() => {
  const row2 = document.querySelector(".row2");
  const feedrow = document.querySelector(".feedrow");
  const why = document.body.innerText.match(/為什麼重要/g);
  return {
    innerBodyScrollWidth: document.body.scrollWidth,
    innerDocScrollWidth: document.documentElement.scrollWidth,
    innerViewportWidth: window.innerWidth,
    row2GridColumns: row2 ? getComputedStyle(row2).gridTemplateColumns : "(no .row2)",
    feedrowGridColumns: feedrow ? getComputedStyle(feedrow).gridTemplateColumns : "(no .feedrow)",
    feedrowCount: document.querySelectorAll(".feedrow").length,
    whyImportantCount: why ? why.length : 0,
    bodyTextHead: document.body.innerText.slice(0, 400),
  };
});
console.log(JSON.stringify(m, null, 2));

await page.screenshot({ path: "C:\\Users\\User\\AppData\\Local\\Temp\\claude\\C--Users-User\\1214a02e-ca58-4738-ae9f-f1d2c740413b\\scratchpad\\reverify\\market_390_iframe.png", fullPage: true });
await browser.close();
