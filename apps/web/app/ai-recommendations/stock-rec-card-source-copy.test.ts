import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./StockRecCard.tsx", import.meta.url), "utf8");

describe("StockRecCard source copy", () => {
  it("turns raw backend source trail into customer-facing evidence copy", () => {
    expect(source).toContain("export function displaySourceTrail");
    expect(source).toContain("推薦來源：AI 推薦引擎");
    expect(source).toContain("推薦批次：已讀取今日推薦結果");
    expect(source).toContain("官方公告：目前無可用新公告");
    expect(source).toContain("技術/量價：已納入報價與 K 線資料");
    expect(source).toContain("新聞/題材：已納入市場新聞資料");
    expect(source).toContain("uniqueParts(parts).join(\"；\")");
    expect(source).toContain("<b>資料依據</b>");
    expect(source).not.toContain("<b>資料路徑</b>");
  });
});
