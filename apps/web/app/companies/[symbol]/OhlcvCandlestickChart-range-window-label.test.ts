/**
 * P1-10 (reports/product_critique_20260710/PRODUCT_CRITIQUE_v1.md): the
 * "區間高低" (high/low) stat used to label itself only with the K-line
 * interval ("日K 顯示範圍"), never the active RANGE window (3月/6月/1年/2年/
 * 全部) that actually determines highInView/lowInView. With "全部" selected
 * this covers ~10 years of history, which read as contradicting the separate
 * "52週高/52週低" HUD stat above it — two unlabeled "低點" numbers side by
 * side. Source-grep test (no chart-library render harness in this repo — see
 * industry-heatmap-representatives.test.ts for the established convention).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourcePath = fileURLToPath(new URL("./OhlcvCandlestickChart.tsx", import.meta.url));
const source = readFileSync(sourcePath, "utf8");

describe("company K-line 區間高低 range-window label", () => {
  it("labels the stat with the active RANGE selection, not just the interval", () => {
    expect(source).toContain("activeRangeWindowLabel");
    expect(source).toContain("{activeRangeWindowLabel} 視窗最高／最低");
    expect(source).not.toContain('{activeMeta?.label ?? "K 線"} 顯示範圍');
  });

  it("derives the range label from the same RANGE_OPTIONS/INTRADAY_RANGE_OPTIONS the toolbar buttons use", () => {
    expect(source).toContain("RANGE_OPTIONS.find((item) => item.value === range)?.label");
    expect(source).toContain("INTRADAY_RANGE_OPTIONS.find((item) => item.value === intradayRange)?.label");
  });
});
