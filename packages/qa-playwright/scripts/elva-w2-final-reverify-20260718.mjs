// Elva final re-verify — post-#1302/#1303 prod evidence capture (w2 round close)
// 2026-07-18. Based on bruce-w2-reverify-20260718.mjs; adds /settings/account CTA check.
// Pure evidence gathering. Fresh login every run — never reuse any existing storageState.json.
import { chromium, request as pwRequest } from "@playwright/test";
import fs from "node:fs";

const WEB = "https://app.eycvector.com";
const API = "https://api.eycvector.com";
const OUT_DIR = "C:\\Users\\User\\AppData\\Local\\Temp\\claude\\C--Users-User\\1214a02e-ca58-4738-ae9f-f1d2c740413b\\scratchpad\\reverify";

const email = process.env.SEED_OWNER_EMAIL ?? "qazabc159@gmail.com";
const password = process.env.SEED_OWNER_PASSWORD ?? "qazabc159";

// ── Fresh Auth (no reuse of any prior storageState.json) ────────────────────
console.log(`[auth] fresh login as ${email} against ${API}/auth/login ...`);
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
if (!sess) {
  console.error("NO iuf_session COOKIE IN FRESH LOGIN RESPONSE");
  process.exit(1);
}
state.cookies.push({ ...sess, domain: "app.eycvector.com", secure: true });
await apiCtx.dispose();
console.log(`[auth] fresh session cookie obtained, expires=${new Date(sess.expires * 1000).toISOString()}`);

const browser = await chromium.launch({ headless: true });
const results = [];

async function captureRoute({ path, slug, viewport, extract }) {
  const ctx = await browser.newContext({ storageState: state, viewport });
  const page = await ctx.newPage();
  let httpStatus = null;
  page.on("response", (r) => {
    if (r.url() === `${WEB}${path}` && httpStatus === null) httpStatus = r.status();
  });
  let navErr = null;
  let resp = null;
  try {
    resp = await page.goto(`${WEB}${path}`, { waitUntil: "networkidle", timeout: 45000 });
  } catch (e) {
    navErr = String(e).slice(0, 300);
  }
  if (resp) httpStatus = resp.status();
  await page.waitForTimeout(3000);

  const shotPath = `${OUT_DIR}\\${slug}.png`;
  try {
    await page.screenshot({ path: shotPath, fullPage: true });
  } catch (e) {
    console.error(`screenshot failed for ${slug}:`, String(e).slice(0, 200));
  }

  let bodyText = "";
  try {
    bodyText = await page.locator("body").innerText({ timeout: 8000 });
  } catch (e) {
    bodyText = `ERROR_INNERTEXT: ${String(e).slice(0, 300)}`;
  }
  fs.writeFileSync(`${OUT_DIR}\\${slug}_bodytext.txt`, bodyText, "utf8");

  const extra = extract ? await extract(page, bodyText) : {};

  const record = { slug, path, httpStatus: httpStatus ?? navErr ?? "NULL", ...extra };
  results.push(record);
  console.log(`[capture] ${slug} path=${path} http=${record.httpStatus}`);
  console.log(JSON.stringify(record, null, 2));

  await page.close();
  await ctx.close();
}

// 1. /companies/2330 desktop — banner date + VWAP
await captureRoute({
  path: "/companies/2330",
  slug: "company2330_w2",
  viewport: { width: 1440, height: 900 },
  extract: async (page, bodyText) => {
    const bannerMatch = bodyText.match(/顯示\s*[^\n]{0,10}收盤資料[^\n]{0,20}/);
    const vwapMatch = bodyText.match(/VWAP[^\d\-]{0,30}([\d,]+\.?\d*)/);
    const vwapContextMatch = bodyText.match(/.{0,15}VWAP.{0,60}/);
    return {
      bannerFull: bannerMatch ? bannerMatch[0] : "(NOT FOUND)",
      vwapNumber: vwapMatch ? vwapMatch[1] : "(NOT FOUND)",
      vwapContext: vwapContextMatch ? vwapContextMatch[0].replace(/\n+/g, " / ") : "(NOT FOUND)",
    };
  },
});

// 2. /ai-recommendations desktop — banner date
await captureRoute({
  path: "/ai-recommendations",
  slug: "airec_w2",
  viewport: { width: 1440, height: 900 },
  extract: async (page, bodyText) => {
    const bannerMatch = bodyText.match(/顯示\s*[^\n]{0,10}收盤資料[^\n]{0,20}/);
    return {
      bannerFull: bannerMatch ? bannerMatch[0] : "(NOT FOUND)",
    };
  },
});

// 3. /market-intel mobile 390 — overflow + news card single-column
await captureRoute({
  path: "/market-intel",
  slug: "market_390_w2",
  viewport: { width: 390, height: 844 },
  extract: async (page) => {
    const bodyScrollW = await page.evaluate(() => document.body.scrollWidth);
    const docScrollW = await page.evaluate(() => document.documentElement.scrollWidth);
    let whyImportantWidths = [];
    try {
      const els = await page.locator("text=為什麼重要").all();
      for (const el of els.slice(0, 5)) {
        const box = await el.boundingBox().catch(() => null);
        if (box) whyImportantWidths.push(Math.round(box.width));
      }
    } catch {
      // ignore
    }
    return {
      bodyScrollWidth: bodyScrollW,
      docScrollWidth: docScrollW,
      viewportWidth: 390,
      whyImportantElementCount: whyImportantWidths.length,
      whyImportantWidthsPx: whyImportantWidths,
    };
  },
});

// 4. /companies/2330 mobile 390 — banner date
await captureRoute({
  path: "/companies/2330",
  slug: "company2330_390_w2",
  viewport: { width: 390, height: 844 },
  extract: async (page, bodyText) => {
    const bannerMatch = bodyText.match(/顯示\s*[^\n]{0,10}收盤資料[^\n]{0,20}/);
    return {
      bannerFull: bannerMatch ? bannerMatch[0] : "(NOT FOUND)",
    };
  },
});

// 5. /settings/account desktop — 更新密碼 CTA computed colors (#1302 gold CTA)
await captureRoute({
  path: "/settings/account",
  slug: "settings_account_w2",
  viewport: { width: 1440, height: 900 },
  extract: async (page) => {
    let ctaStyles = "(NOT FOUND)";
    try {
      const btn = page.locator("button, a", { hasText: "更新密碼" }).first();
      await btn.waitFor({ state: "visible", timeout: 8000 });
      ctaStyles = await btn.evaluate((el) => {
        const cs = getComputedStyle(el);
        return { background: cs.backgroundColor, color: cs.color, opacity: cs.opacity };
      });
    } catch (e) {
      ctaStyles = `ERROR: ${String(e).slice(0, 200)}`;
    }
    return { updatePasswordCta: ctaStyles };
  },
});

fs.writeFileSync(`${OUT_DIR}\\_w2_results.json`, JSON.stringify(results, null, 2), "utf8");
console.log("=== ALL RESULTS ===");
console.log(JSON.stringify(results, null, 2));

await browser.close();
