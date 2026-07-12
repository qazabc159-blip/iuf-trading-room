/**
 * company-data-table-fit-labels.test.ts
 *
 * Follow-up fix (2026-07-12, discovered while doing #1232's diagnosed
 * follow-up on [07]/[08]/[09]/[10]): `.company-data-table-fit`'s mobile
 * card-conversion CSS used to hardcode SIX nth-child label rules assuming
 * every table sharing this class has the exact 財報 6-column shape
 * (期別/營收/毛利率/營益率/EPS/年增率). In reality 10 of the 11 tables that
 * share this class (5 of FinancialsPanel.tsx's 6 tabs + all 5 of
 * FullProfilePanels.tsx's [06]-[10] tables) have a different column count
 * and/or order, so their mobile card rows were silently mislabeled.
 *
 * Fixed by moving the label source into each <td>'s own `data-label`
 * attribute (`content: attr(data-label)` in globals.css) so labeling is
 * correct for any table shape without a bespoke nth-child rule set per
 * table. This test locks two things: (1) the CSS no longer hardcodes a
 * single 6-column label set, and (2) every <td> in every
 * .company-data-table-fit table carries a data-label that matches its own
 * column's <th> text — not another table's.
 *
 * Source-grep test (no jsdom/testing-library dependency in this repo — see
 * CompanyHeroBar.test.ts for the established convention).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const globalsCssPath = fileURLToPath(new URL("../../globals.css", import.meta.url));
const globalsCss = readFileSync(globalsCssPath, "utf8");

const financialsPanelPath = fileURLToPath(new URL("./FinancialsPanel.tsx", import.meta.url));
const financialsPanelSource = readFileSync(financialsPanelPath, "utf8");

const fullProfilePanelsPath = fileURLToPath(new URL("./FullProfilePanels.tsx", import.meta.url));
const fullProfilePanelsSource = readFileSync(fullProfilePanelsPath, "utf8");

describe(".company-data-table-fit mobile card labels", () => {
  it("no longer hardcodes a single 6-column nth-child label set", () => {
    expect(globalsCss).not.toMatch(/\.company-data-table-fit td:nth-child\(1\)::before \{ content: "期別"; \}/);
    expect(globalsCss).not.toMatch(/\.company-data-table-fit td:nth-child\(6\)::before \{ content: "年增率"; \}/);
  });

  it("reads the mobile card label from each cell's own data-label attribute", () => {
    expect(globalsCss).toMatch(/\.company-data-table-fit td::before \{[\s\S]*?content: attr\(data-label\);[\s\S]*?\}/);
  });

  // Extracts { headers: string[], rows: { tds: string[] } } for one function
  // body (a table-rendering component) so each row's per-column data-label
  // can be checked against that SAME table's own <th> text, not a different
  // table's label set.
  function extractTables(source: string, fnNames: string[]) {
    return fnNames.map((fnName) => {
      const start = source.indexOf(`function ${fnName}`);
      expect(start, `${fnName} not found in source`).toBeGreaterThan(-1);
      const nextFn = source.indexOf("\nfunction ", start + 1);
      const body = nextFn > -1 ? source.slice(start, nextFn) : source.slice(start);
      const headers = [...body.matchAll(/<th><span>([^<]+)<\/span><\/th>/g)].map((m) => m[1]);
      const dataLabels = [...body.matchAll(/data-label="([^"]+)"/g)].map((m) => m[1]);
      return { fnName, headers, dataLabels };
    });
  }

  it("FinancialsPanel.tsx: every table's <td data-label> set exactly matches that table's own <th> headers, in order", () => {
    const tables = extractTables(financialsPanelSource, [
      "FinancialTable",
      "RevenueTable",
      "SourceItemsTable",
      "DividendTable",
      "ValuationTable",
      "MarketValueTable",
    ]);
    for (const { fnName, headers, dataLabels } of tables) {
      expect(headers.length, `${fnName}: expected at least one <th>`).toBeGreaterThan(0);
      // dataLabels covers exactly one row's worth of <td>s (one map() body) — the
      // literal count in the row template must equal the header count.
      expect(dataLabels.slice(0, headers.length), `${fnName}: row data-label set must equal its own headers`).toEqual(headers);
    }
  });

  it("FullProfilePanels.tsx: [06]-[10] every table's <td data-label> set exactly matches that table's own <th> headers, in order", () => {
    const tables = extractTables(fullProfilePanelsSource, [
      "FinancialsSection",
      "RevenueSection",
      "InstitutionalSection",
      "MarginShortSection",
      "DividendSection",
    ]);
    for (const { fnName, headers, dataLabels } of tables) {
      expect(headers.length, `${fnName}: expected at least one <th>`).toBeGreaterThan(0);
      expect(dataLabels.slice(0, headers.length), `${fnName}: row data-label set must equal its own headers`).toEqual(headers);
    }
  });
});
