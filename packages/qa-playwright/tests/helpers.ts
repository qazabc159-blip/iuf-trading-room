import { expect, type APIRequestContext, type Page, type TestInfo } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { isUsableHeatmapTile, type HeatmapUsabilityTile } from "./heatmap-tile-usability-copy";

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
// array, non-empty, AND every row is unusable per the SAME predicate
// industry-heatmap.tsx gates render-inclusion on — i.e. positive proof the
// upstream itself has nothing renderable right now. Any other outcome
// (request failed, empty array, malformed shape, or rows present that the
// real predicate should have rendered) comes back "no_positive_proof" so the
// caller fails loud instead of silently skipping.
//
// 2026-07-24 (QA misc batch ticket #1, Pete-13 review 🟡#1): this used to be
// its own hand-maintained 2-flag subset (freshnessStatus/readiness only) —
// a THIRD independently-drifting copy of the same criteria, on top of the
// two apps/web already unified into `isUsableHeatmapTile()`
// (heatmap-tile-usability.ts, banner gate + tile-render gate). Now calls the
// same predicate via heatmap-tile-usability-copy.ts (a synced copy —
// qa-playwright cannot import apps/web across packages, see that file's doc
// comment; heatmap-usability-copy-drift.spec.ts keeps the two in sync).
//
// isUsableHeatmapTile() needs `close`/`pct` fields, but the RAW
// `/api/v1/market-data/overview` response uses different field names
// (`last`/`changePct` — see apps/api/src/market-data.ts's heatmap row
// builder). Feeding raw field names straight into isUsableHeatmapTile()
// without remapping would make deriveHeatmapMove() find no usable price on
// EVERY row regardless of real data quality (a false "empty_confirmed" on
// every call — silently reintroducing exactly the blind spot Pete-11 fixed).
// mapRawHeatmapRowToUsabilityTile() below applies the same field mapping
// apps/web/app/page.tsx's buildHeatmap() uses (pct: changePct, close: last)
// before calling the predicate.
//
// Two things stay deliberately out of scope, both in the SAFE direction —
// they can only make "usable" MORE likely (i.e. harder to reach
// "empty_confirmed", so more likely to fail loud), never less likely:
//   - sourceState: not present on the raw API response at all (computed
//     client-side in page.tsx from a KGI-tick merge) — always undefined
//     here, so isUsableHeatmapTile()'s `sourceState === "no_data"` check
//     never filters a row out that the real page might.
//   - page.tsx's saneStockPct() clamp (rejects |changePct| over the daily
//     ±10% limit as a data-glitch guard): not reproduced here, so a
//     raw glitch value this check treats as "usable" would make the real
//     page treat it as unusable (null pct) — conservative, not permissive.
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
  const usableRows = (rows as RawHeatmapRow[]).filter((row) => isUsableHeatmapTile(mapRawHeatmapRowToUsabilityTile(row)));
  if (usableRows.length === 0) {
    return {
      verdict: "empty_confirmed",
      detail: `upstream confirmed ${rows.length}/${rows.length} rows unusable per isUsableHeatmapTile() (heatmap-tile-usability-copy.ts)`
    };
  }
  return {
    verdict: "no_positive_proof",
    detail: `upstream has ${usableRows.length}/${rows.length} usable rows per isUsableHeatmapTile() — DOM should have rendered tiles`
  };
}

type RawHeatmapRow = {
  symbol?: unknown;
  name?: unknown;
  last?: unknown;
  prevClose?: unknown;
  change?: unknown;
  changePct?: unknown;
  readiness?: unknown;
  freshnessStatus?: unknown;
};

// Mirrors apps/web/app/page.tsx's buildHeatmap() field mapping (pct from
// changePct, close/price from last) — see the doc comment above
// checkHeatmapUpstreamCoverage() for why this mapping is required.
function mapRawHeatmapRowToUsabilityTile(row: RawHeatmapRow): HeatmapUsabilityTile {
  return {
    symbol: typeof row.symbol === "string" ? row.symbol : "",
    name: typeof row.name === "string" ? row.name : undefined,
    pct: typeof row.changePct === "number" ? row.changePct : null,
    close: typeof row.last === "number" ? row.last : null,
    prevClose: typeof row.prevClose === "number" ? row.prevClose : null,
    change: typeof row.change === "number" ? row.change : null,
    readiness: row.readiness as HeatmapUsabilityTile["readiness"],
    freshnessStatus: row.freshnessStatus as HeatmapUsabilityTile["freshnessStatus"],
  };
}
