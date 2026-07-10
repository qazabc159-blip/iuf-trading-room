import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";

// Slice-1 verification: manifest reachable while logged out, icons all
// resolve, head metadata present. Run manually against a local `next start`
// pointed at prod API — not part of the CI P0 suite (no auth.setup needed,
// this is the pre-login surface by design).
const BASE = "http://localhost:3411";
const outDir = path.join(process.cwd(), "..", "..", "reports", "app_readiness_20260710", "slice1");

test("PWA slice1: manifest + icons + head metadata reachable while logged out", async ({ page }) => {
  mkdirSync(outDir, { recursive: true });
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });

  const head = await page.evaluate(() => ({
    manifestHref: document.querySelector('link[rel="manifest"]')?.getAttribute("href") ?? null,
    appleIconHref: document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute("href") ?? null,
    iconHref: document.querySelector('link[rel="icon"]')?.getAttribute("href") ?? null,
    themeColor: document.querySelector('meta[name="theme-color"]')?.getAttribute("content") ?? null,
    // Next 15 emits the non-prefixed "mobile-web-app-capable" for
    // appleWebApp.capable (current standard, superseding the old
    // apple-prefixed-only tag).
    appleCapable: document.querySelector('meta[name="mobile-web-app-capable"]')?.getAttribute("content") ?? null,
    appleTitle: document.querySelector('meta[name="apple-mobile-web-app-title"]')?.getAttribute("content") ?? null,
    appleStatusBar: document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.getAttribute("content") ?? null,
  }));

  expect(head.manifestHref).toBe("/manifest.webmanifest");
  expect(head.appleIconHref).toContain("apple-icon.png");
  expect(head.themeColor).toBe("#080b10");
  expect(head.appleCapable).toBe("yes");
  expect(head.appleTitle).toBe("IUF 戰情室");
  expect(head.appleStatusBar).toBe("black-translucent");

  const manifestResp = await page.request.get(`${BASE}/manifest.webmanifest`);
  expect(manifestResp.status()).toBe(200);
  const manifestJson = await manifestResp.json();
  expect(manifestJson.name).toBe("IUF 台股 AI 交易戰情室");
  expect(manifestJson.short_name).toBe("IUF 戰情室");
  expect(manifestJson.start_url).toBe("/m");
  expect(manifestJson.display).toBe("standalone");
  expect(manifestJson.theme_color).toBe("#080b10");
  expect(manifestJson.background_color).toBe("#080b10");
  expect(manifestJson.icons).toHaveLength(3);

  for (const icon of manifestJson.icons) {
    const r = await page.request.get(`${BASE}${icon.src}`);
    expect(r.status(), `${icon.src} should be 200 while logged out`).toBe(200);
    expect(r.headers()["content-type"]).toContain("image/png");
  }

  const faviconResp = await page.request.get(`${BASE}/favicon.ico`);
  expect(faviconResp.status()).toBe(200);

  // Note: this project runs against an authenticated storageState (see
  // auth.setup.ts), so it can't exercise the logged-out redirect path here.
  // That regression (protected route still 307s to /login with no session,
  // manifest/sw.js do NOT) is covered deterministically in
  // apps/web/middleware.test.ts instead.

  await page.screenshot({ path: path.join(outDir, "login_page_head_check.png") });
  console.log("HEAD_TAGS", JSON.stringify(head, null, 2));
  console.log("CONSOLE_ERRORS", JSON.stringify(consoleErrors));
});
