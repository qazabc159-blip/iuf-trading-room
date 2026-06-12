import { describe, it, expect } from "vitest";
import {
  shiftWeekAnchor,
  formatMonthDay,
  formatTwdSigned,
  formatTwdPlain,
  formatSignedPct2,
  formatPct2,
  formatFractionPct,
  formatSignedFractionPct,
  signTone,
  fAutoDataSourceLabel,
  briefDeliverySummary,
} from "./weekly-review-format";

describe("shiftWeekAnchor", () => {
  it("shifts forward 7 days", () => {
    expect(shiftWeekAnchor("2026-06-08", 1)).toBe("2026-06-15");
  });
  it("shifts backward 7 days", () => {
    expect(shiftWeekAnchor("2026-06-08", -1)).toBe("2026-06-01");
  });
  it("handles month boundary", () => {
    expect(shiftWeekAnchor("2026-05-26", 1)).toBe("2026-06-02");
  });
});

describe("formatMonthDay", () => {
  it("formats YYYY-MM-DD to MM/DD", () => {
    expect(formatMonthDay("2026-06-12")).toBe("06/12");
  });
  it("returns input unchanged if not matching", () => {
    expect(formatMonthDay("bad-date")).toBe("bad-date");
  });
});

describe("formatTwdSigned", () => {
  it("formats positive with +", () => {
    expect(formatTwdSigned(12345)).toBe("+12,345");
  });
  it("formats negative with minus sign", () => {
    expect(formatTwdSigned(-215840)).toBe("−215,840");
  });
  it("formats zero with no sign", () => {
    expect(formatTwdSigned(0)).toBe("0");
  });
  it("returns placeholder for null", () => {
    expect(formatTwdSigned(null)).toBe("--");
  });
});

describe("formatTwdPlain", () => {
  it("formats with thousands separator", () => {
    expect(formatTwdPlain(10000000)).toBe("10,000,000");
  });
  it("returns placeholder for null", () => {
    expect(formatTwdPlain(null)).toBe("--");
  });
});

describe("formatSignedPct2", () => {
  it("formats positive with +", () => {
    expect(formatSignedPct2(1.5)).toBe("+1.50%");
  });
  it("formats negative", () => {
    expect(formatSignedPct2(-2)).toBe("-2.00%");
  });
  it("returns placeholder for null", () => {
    expect(formatSignedPct2(null)).toBe("--");
  });
});

describe("formatPct2", () => {
  it("formats without sign", () => {
    expect(formatPct2(-2)).toBe("-2.00%");
    expect(formatPct2(2)).toBe("2.00%");
  });
});

describe("formatFractionPct", () => {
  it("converts 0-1 fraction to percent", () => {
    expect(formatFractionPct(0.593)).toBe("59.3%");
  });
  it("returns placeholder for null", () => {
    expect(formatFractionPct(null)).toBe("--");
  });
});

describe("formatSignedFractionPct", () => {
  it("formats negative excess", () => {
    expect(formatSignedFractionPct(-0.0089)).toBe("-0.89%");
  });
  it("formats positive excess with +", () => {
    expect(formatSignedFractionPct(0.01)).toBe("+1.00%");
  });
});

describe("signTone", () => {
  it("positive -> ok", () => {
    expect(signTone(5)).toBe("ok");
  });
  it("negative -> bad", () => {
    expect(signTone(-5)).toBe("bad");
  });
  it("zero/null -> dim", () => {
    expect(signTone(0)).toBe("dim");
    expect(signTone(null)).toBe("dim");
  });
});

describe("fAutoDataSourceLabel", () => {
  it("translates kgi_gateway", () => {
    expect(fAutoDataSourceLabel("kgi_gateway")).toBe("即時讀取");
  });
  it("translates audit_log_rebuild", () => {
    expect(fAutoDataSourceLabel("audit_log_rebuild")).toBe("依成交紀錄重建");
  });
  it("falls back for unknown/null", () => {
    expect(fAutoDataSourceLabel(null)).toBe("資料來源待確認");
    expect(fAutoDataSourceLabel("something_else")).toBe("資料來源待確認");
  });
});

describe("briefDeliverySummary", () => {
  it("formats N/M", () => {
    expect(briefDeliverySummary(3, 5)).toBe("3/5 個交易日");
  });
});
