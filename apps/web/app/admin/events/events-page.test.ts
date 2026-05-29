import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

describe("EventLog admin page product truth", () => {
  it("auto-selects the first real stream instead of opening on an empty-looking detail panel", () => {
    expect(source).toContain("visibleStreams[0]");
    expect(source).toContain("setSelectedStream(nextStream)");
    expect(source).toContain("loadEvents(nextStream)");
  });

  it("uses product Chinese labels for event table fields and stream types", () => {
    expect(source).toContain("委託事件");
    expect(source).toContain("系統事件");
    expect(source).toContain("<th>事件類型</th>");
    expect(source).toContain("<th>發生時間</th>");
    expect(source).toContain("<th>資料預覽</th>");
    expect(source).not.toContain("<th>event_type</th>");
    expect(source).not.toContain("<th>occurred_at</th>");
    expect(source).not.toContain("<th>payload 預覽</th>");
  });

  it("summarizes order payloads instead of dumping raw JSON as the primary preview", () => {
    expect(source).toContain("formatPayloadPreview(ev.payload)");
    expect(source).toContain("標的 ${symbol}");
    expect(source).not.toContain("JSON.stringify(ev.payload)");
  });
});
