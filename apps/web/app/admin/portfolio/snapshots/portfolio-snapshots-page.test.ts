import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

describe("Portfolio Snapshot admin page product truth", () => {
  it("auto-selects the first snapshot returned by the real API", () => {
    expect(source).toContain("setSelected(nextSnapshots[0] ?? null)");
    expect(source).toContain("/api/v1/portfolio/snapshots?limit=20");
  });

  it("can request a manual paper-only snapshot capture without broker writes", () => {
    expect(source).toContain("/api/v1/portfolio/snapshots/capture-paper");
    expect(source).toContain("擷取 paper snapshot");
    expect(source).toContain("不送 KGI、不送實單");
    expect(source).toContain("brokerWrite={String(captureResult.brokerWrite)}");
    expect(source).toContain("kgiWrite={String(captureResult.kgiWrite)}");
  });

  it("labels empty positions honestly instead of looking like fake data", () => {
    expect(source).toContain("目前 20 筆快照都是空持倉");
    expect(source).toContain("正式 API 回傳的空 positions");
    expect(source).toContain("不是前端假資料");
  });

  it("uses product Chinese labels for snapshot tables and diff", () => {
    expect(source).toContain("<th>股票</th>");
    expect(source).toContain("<th>股數</th>");
    expect(source).toContain("<th>均價</th>");
    expect(source).toContain("快照差異比對");
    expect(source).toContain("查詢 diff");
    expect(source).not.toContain("<th>ticker</th>");
    expect(source).not.toContain("<th>sector</th>");
  });
});
