import { describe, expect, it } from "vitest";
import {
  editionDateLabel,
  fmtConfidence,
  fmtMultiplier,
  fmtPrice,
  fmtRValue,
  fmtScore,
  generationStatusLabel,
  officialAnnouncementLabel,
  rankLabel,
  splitParagraphs,
} from "./morning-brief-copy";

describe("rankLabel", () => {
  it("maps index 0-4 to 序位第一/貳/叁/肆/伍", () => {
    expect(rankLabel(0)).toBe("序位第一");
    expect(rankLabel(1)).toBe("貳");
    expect(rankLabel(2)).toBe("叁");
    expect(rankLabel(3)).toBe("肆");
    expect(rankLabel(4)).toBe("伍");
  });

  it("falls back to a numbered label beyond the 5-card design", () => {
    expect(rankLabel(5)).toBe("第 6 名");
  });
});

describe("splitParagraphs", () => {
  it("splits on newline and drops empty lines", () => {
    expect(splitParagraphs("第一段\n\n第二段\n")).toEqual(["第一段", "第二段"]);
  });

  it("returns empty array for null/empty (honest empty, not a fake paragraph)", () => {
    expect(splitParagraphs(null)).toEqual([]);
    expect(splitParagraphs("")).toEqual([]);
  });
});

describe("editionDateLabel", () => {
  it("extracts the date segment and appends 收盤", () => {
    expect(editionDateLabel("07/22 08:33")).toBe("07/22 收盤");
  });

  it("returns -- when there is no usable date", () => {
    expect(editionDateLabel("-")).toBe("--");
    expect(editionDateLabel("")).toBe("--");
  });
});

describe("officialAnnouncementLabel", () => {
  it("maps every known sourceState to a human label", () => {
    expect(officialAnnouncementLabel("live")).toBe("已納入");
    expect(officialAnnouncementLabel("empty")).toBe("已檢查無公告");
    expect(officialAnnouncementLabel("degraded")).toBe("降級");
    expect(officialAnnouncementLabel("pending")).toBe("待接入");
    expect(officialAnnouncementLabel("unknown_state")).toBe("待確認");
  });
});

describe("generationStatusLabel", () => {
  it("only 'complete' renders as 完成", () => {
    expect(generationStatusLabel("complete")).toBe("完成");
    expect(generationStatusLabel("running")).toBe("需留意");
    expect(generationStatusLabel(null)).toBe("需留意");
    expect(generationStatusLabel(undefined)).toBe("需留意");
  });
});

describe("number formatters — null/undefined never render as fake 0 or blank", () => {
  it("fmtPrice", () => {
    expect(fmtPrice(445.5)).toBe("445.5");
    expect(fmtPrice(null)).toBe("--");
    expect(fmtPrice(undefined)).toBe("--");
  });

  it("fmtScore", () => {
    expect(fmtScore(10, 20)).toBe("10/20");
    expect(fmtScore(null, 20)).toBe("--");
  });

  it("fmtConfidence", () => {
    expect(fmtConfidence(0.74)).toBe("74%");
    expect(fmtConfidence(null)).toBe("--");
  });

  it("fmtRValue", () => {
    expect(fmtRValue(1.1)).toBe("1.10R");
    expect(fmtRValue(null)).toBe("--");
  });

  it("fmtMultiplier", () => {
    expect(fmtMultiplier(0.9)).toBe("0.9");
    expect(fmtMultiplier(null)).toBe("--");
  });
});
