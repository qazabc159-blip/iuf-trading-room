// Bruce #1348 frontend intraday check — fresh login, market-intel page institutional panel
import { chromium, request as pwRequest } from "@playwright/test";

const WEB = "https://app.eycvector.com";
const API = "https://api.eycvector.com";
const email = "qazabc159@gmail.com";
const password = "qazabc159";

const apiCtx = await pwRequest.newContext({ baseURL: API, storageState: { cookies: [], origins: [] } });
const loginResp = await apiCtx.post("/auth/login", {
  data: { email, password },
  headers: { "Content-Type": "application/json" },
});
console.log(`[auth] login HTTP ${loginResp.status()}`);
if (!loginResp.ok()) {
  console.error("LOGIN FAILED", loginResp.status(), await loginResp.text());
  process.exit(1);
}
const state = await apiCtx.storageState();
const sess = state.cookies.find((c) => c.name === "iuf_session");
state.cookies.push({ ...sess, domain: "app.eycvector.com", secure: true });
await apiCtx.dispose();

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ storageState: state, viewport: { width: 1366, height: 900 } });
const page = await ctx.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 200)));

let resp = null;
try {
  resp = await page.goto(`${WEB}/market-intel`, { waitUntil: "networkidle", timeout: 45000 });
} catch (e) {
  console.error("NAV ERROR", String(e).slice(0, 300));
}
console.log(`[nav] HTTP ${resp ? resp.status() : "N/A"} finalURL=${page.url()}`);
await page.waitForTimeout(2000);

const panelText = await page.evaluate(() => {
  const panel = document.querySelector("._mi-instpanel");
  return panel ? panel.innerText : "PANEL_NOT_FOUND";
});
console.log("=== INSTITUTIONAL PANEL TEXT ===");
console.log(panelText);

const dashCount = (panelText.match(/--/g) || []).length;
console.log(`\n[check] '--' occurrences in panel: ${dashCount}`);
console.log(`[check] pageErrors: ${JSON.stringify(pageErrors)}`);

await page.screenshot({ path: "C:\\Users\\User\\AppData\\Local\\Temp\\claude\\C--Users-User\\87b68ef2-b09d-4f9a-a232-0b0a22165cfd\\scratchpad\\market_intel_institutional_20260724.png", fullPage: true });

await browser.close();
