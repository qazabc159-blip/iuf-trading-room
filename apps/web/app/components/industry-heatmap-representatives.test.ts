import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { formatSectorChipCount } from "./industry-heatmap-chip";

const sourcePath = fileURLToPath(new URL("./industry-heatmap.tsx", import.meta.url));
const source = readFileSync(sourcePath, "utf8");

function listLength(name: string) {
  const match = source.match(new RegExp(`${name}[^=]*= \\[(?<body>[\\s\\S]*?)\\];`));
  const body = match?.groups?.body ?? "";
  return Array.from(body.matchAll(/"(\d{4})"/g)).length;
}

function groupLength(group: string) {
  const match = source.match(new RegExp(`${group}: \\[(?<body>[^\\]]+)\\]`));
  const body = match?.groups?.body ?? "";
  return Array.from(body.matchAll(/"(\d{4})"/g)).length;
}

describe("industry heatmap representative pool source gate", () => {
  it("keeps the core pool at 40 fixed Taiwan tickers", () => {
    expect(listLength("CORE_REPRESENTATIVES")).toBe(40);
    expect(source).toContain('"2330", "2317", "2454"');
  });

  it("keeps every visible sector at 10-15 representative tickers", () => {
    for (const group of ["semiconductor", "components", "computer", "communication", "finance", "steel", "shipping"]) {
      expect(groupLength(group), group).toBeGreaterThanOrEqual(10);
      expect(groupLength(group), group).toBeLessThanOrEqual(15);
    }
  });

  it("pins every sector pool to 15 tickers so no-data filtering still leaves a full heatmap", () => {
    for (const group of ["semiconductor", "components", "computer", "communication", "finance", "steel", "shipping"]) {
      expect(groupLength(group), group).toBe(15);
    }
    expect(source).toContain("const MAX_TILES_PER_SECTOR = 15;");
    expect(source).toContain('shipping: ["2603", "2609", "2615", "2636", "2605", "2606", "2610", "2618", "2646", "6757", "2607", "5608", "2608", "2617", "2637"]');
  });

  it("ships Chinese company labels for the tickers shown in the user screenshots", () => {
    for (const pair of ['"2330": "台積電"', '"2454": "聯發科"', '"2317": "鴻海"', '"2412": "中華電"', '"2881": "富邦金"']) {
      expect(source).toContain(pair);
    }
  });

  it("falls back to fixed representative labels when feed names contain replacement characters", () => {
    expect(source).toContain('!normalized.includes("�")');
    for (const pair of ['"6285": "啟碁"', '"5608": "四維航"', '"6416": "瑞祺電通"']) {
      expect(source).toContain(pair);
    }
  });

  it("does not render missing representative quotes as gray tiles", () => {
    expect(source).toContain('if (tile.sourceState === "no_data") return false;');
    expect(source).not.toContain("representativeNoDataTile");
    expect(source).not.toContain("固定代表股池；此檔暫無可驗證行情");
    expect(source).toContain("未渲染為灰塊");
  });
  it("keeps every tile readable with both ticker and company name (2026-07-14 discrete artifact-grid tiles: name is always in markup, only CSS container-query hides it on the tiniest cells)", () => {
    expect(source).toContain('<span className="nm">{tile.name}</span>');
    expect(source).not.toContain("tile.labelMode");
  });

  // P1-3 (reports/product_critique_20260710/PRODUCT_CRITIQUE_v1.md): each sector
  // tab's chip used to show a bare count (e.g. "半導體業 13 檔") drawn from that
  // tab's own independent 15-symbol representative pool, while "全部" showed a
  // count from a completely different 40-symbol pool. Summing the per-sector
  // numbers never equals the "全部" total by design, which read as a fake/
  // inconsistent count. Fix: show "available/pool-size" so the denominator is
  // explicit and the numbers are honest without claiming to be a partition.
  it("formats sector chip counts as available/pool-size, not a bare number", () => {
    expect(formatSectorChipCount(13, 15)).toBe("13/15 檔");
    expect(formatSectorChipCount(38, 40)).toBe("38/40 檔");
    expect(formatSectorChipCount(0, 15)).toBe("0/15 檔");
    expect(formatSectorChipCount(5, 0)).toBe("5 檔");
  });

  it("wires the sector tab chip label through formatSectorChipCount, not a bare option.count", () => {
    expect(source).toContain("formatSectorChipCount(option.availableCount, option.target)");
    expect(source).not.toContain("<span>{option.count} 檔</span>");
  });
});
