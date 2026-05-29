import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

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

  it("does not render missing representative quotes as gray tiles", () => {
    expect(source).toContain('if (tile.sourceState === "no_data") return false;');
    expect(source).not.toContain("representativeNoDataTile");
    expect(source).not.toContain("固定代表股池；此檔暫無可驗證行情");
    expect(source).toContain("未渲染為灰塊");
  });
});
