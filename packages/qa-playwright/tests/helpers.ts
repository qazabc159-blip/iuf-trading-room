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

export type HeatmapUpstreamCheck =
  | { verdict: "empty_confirmed"; detail: string }
  | { verdict: "no_positive_proof"; detail: string };

// Pete-11 round-2 fix (2026-07-24, PR #1361): a pure DOM-render timeout
// cannot tell "honest off-hours/warm-up degradation" apart from a real
// renderer/data-pipeline regression — both produce the identical
// `.heatmapgrid .tile` count of 0. Ask the upstream API directly instead of
// trusting the timeout alone. Skip is legal ONLY when this returns
// "empty_confirmed" — API reachable, well-formed `data.marketContext.heatmap`
// array, non-empty, AND every row is unusable per the same two flags
// industry-heatmap.tsx's isUsableTile() gates on beyond the coverage check
// (freshnessStatus/readiness) — i.e. positive proof the upstream itself has
// nothing renderable right now. Any other outcome (request failed, empty
// array, malformed shape, or rows present that isUsableTile() should have
// rendered) comes back "no_positive_proof" so the caller fails loud instead
// of silently skipping — this is what closes the CI blind spot Pete-11
// flagged (the old skip condition had zero non-skippable tile-render
// assertion left in the @smoke gate).
//
// validMove()/sourceState are additional client-side-derived filters inside
// isUsableTile() that are not present on the raw
// `/api/v1/market-data/overview` response (sourceState in particular is
// computed in apps/web/app/page.tsx from a KGI-tick merge, not returned by
// the API) — intentionally out of scope here. Checking only
// freshnessStatus/readiness is the SAFE direction: it can only make this
// check MORE likely to report "usable rows present" (and therefore fail
// loud) than the real page-side filter, never less likely — so it cannot
// reintroduce the flake this PR set out to fix.
export async function checkHeatmapUpstreamCoverage(request: APIRequestContext): Promise<HeatmapUpstreamCheck> {
  let response;
  try {
    response = await request.get(`${API_BASE_URL}/api/v1/market-data/overview`, {
      headers: { Accept: "application/json" }
    });
  } catch (err) {
    return { verdict: "no_positive_proof", detail: `request threw: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!response.ok()) {
    return { verdict: "no_positive_proof", detail: `/api/v1/market-data/overview returned HTTP ${response.status()}` };
  }
  let json: unknown;
  try {
    json = await response.json();
  } catch (err) {
    return { verdict: "no_positive_proof", detail: `response body was not valid JSON: ${err instanceof Error ? err.message : String(err)}` };
  }
  const rows = (json as { data?: { marketContext?: { heatmap?: unknown } } })?.data?.marketContext?.heatmap;
  if (!Array.isArray(rows)) {
    return { verdict: "no_positive_proof", detail: "data.marketContext.heatmap missing or not an array — malformed response shape" };
  }
  if (rows.length === 0) {
    return { verdict: "no_positive_proof", detail: "data.marketContext.heatmap returned 0 rows — empty array is not positive proof of an honest degraded state" };
  }
  const usableRows = (rows as Array<{ freshnessStatus?: string; readiness?: string }>).filter(
    (tile) => tile?.freshnessStatus !== "missing" && tile?.readiness !== "blocked"
  );
  if (usableRows.length === 0) {
    return {
      verdict: "empty_confirmed",
      detail: `upstream confirmed ${rows.length}/${rows.length} rows unusable (freshnessStatus="missing" or readiness="blocked")`
    };
  }
  return {
    verdict: "no_positive_proof",
    detail: `upstream has ${usableRows.length}/${rows.length} usable rows (freshnessStatus!=="missing" && readiness!=="blocked") — DOM should have rendered tiles`
  };
}
