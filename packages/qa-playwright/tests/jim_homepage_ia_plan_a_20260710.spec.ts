import { test } from "@playwright/test";
import path from "node:path";
import { expectNoServerError } from "./helpers";

/**
 * 首頁 IA 審計 A 案（2026-07-10）before/after 截圖工具。
 * 只在本機手動跑（IUF_QA_SCREENSHOT_LABEL 決定檔名前綴 before/after），
 * 用來對照 reports/homepage_ia_audit_20260710/HOMEPAGE_IA_AUDIT_v1.md 的
 * 改版前後首屏差異。不是常駐 CI gate。
 */
const LABEL = process.env.IUF_QA_SCREENSHOT_LABEL ?? "after";
const OUT_DIR = path.resolve(
  process.cwd(),
  "../../reports/homepage_ia_audit_20260710/plan_a",
);

test("homepage IA plan A — 1280px screenshot", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "只在 desktop-chromium project 跑");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expectNoServerError(page);
  await page.waitForTimeout(3_000);
  await page.screenshot({ path: path.join(OUT_DIR, `${LABEL}_1280_fullpage.png`), fullPage: true });
  await page.screenshot({ path: path.join(OUT_DIR, `${LABEL}_1280_firstview.png`), fullPage: false });
});

test("homepage IA plan A — 390px screenshot", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "只在 desktop-chromium project 跑（手動指定 390 視窗，不吃 mobile-iphone-13 project 預設值）");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expectNoServerError(page);
  await page.waitForTimeout(3_000);
  await page.screenshot({ path: path.join(OUT_DIR, `${LABEL}_390_fullpage.png`), fullPage: true });
  await page.screenshot({ path: path.join(OUT_DIR, `${LABEL}_390_firstview.png`), fullPage: false });
});
