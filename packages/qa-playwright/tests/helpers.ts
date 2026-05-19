import { expect, type APIRequestContext, type Page, type TestInfo } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

export const WEB_BASE_URL = process.env.IUF_QA_WEB_BASE_URL ?? "https://app.eycvector.com";
export const API_BASE_URL = process.env.IUF_QA_API_BASE_URL ?? "https://api.eycvector.com";
export const STORAGE_STATE = process.env.IUF_QA_STORAGE_STATE ?? "storageState.json";

const RUN_ID =
  process.env.IUF_QA_RUN_ID ??
  new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "_");

export const REPORT_DIR =
  process.env.IUF_QA_REPORT_DIR ??
  path.resolve(process.cwd(), "../../reports", `qa_playwright_${RUN_ID}`);

export async function ensureReportDir() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
}

export async function saveRouteScreenshot(page: Page, testInfo: TestInfo, routeName: string) {
  await ensureReportDir();
  const safeProject = testInfo.project.name.replace(/[^a-z0-9_-]+/gi, "_");
  const filePath = path.join(REPORT_DIR, `${routeName}_${safeProject}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  await testInfo.attach(`${routeName} screenshot`, {
    path: filePath,
    contentType: "image/png"
  });
  return filePath;
}

export async function expectNoServerError(page: Page) {
  await expect(page.getByText(/Application error|server-side exception/i)).toHaveCount(0);
  await expect(page.getByText(/This page could not be found|404:/i)).toHaveCount(0);
}

export async function fetchJson<T>(request: APIRequestContext, apiPath: string): Promise<T> {
  const response = await request.get(`${API_BASE_URL}${apiPath}`, {
    headers: { Accept: "application/json" }
  });
  expect(response.ok(), `${apiPath} returned HTTP ${response.status()}`).toBeTruthy();
  return (await response.json()) as T;
}

export function requireText(value: unknown, field: string) {
  expect(value, `${field} must be present`).toBeTruthy();
}

export function requireNumber(value: unknown, field: string) {
  expect(typeof value, `${field} must be numeric`).toBe("number");
}

export function extractFrame(page: Page) {
  return page.frameLocator("iframe").first();
}
