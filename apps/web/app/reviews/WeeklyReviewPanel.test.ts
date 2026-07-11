import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const panelSource = readFileSync(new URL("./WeeklyReviewPanel.tsx", import.meta.url), "utf8");

// P1-7 (product critique 2026-07-10): F-AUTO 週表現卡 used to only mention
// "依稽核成交紀錄重建" in a quiet neutral-colored footnote — no P&L-adjacent
// disclaimer when the holdings behind it were never confirmed by a broker
// report. This must be an explicit badge next to the number, not just prose.
describe("WeeklyReviewPanel F-AUTO card broker-confirmation disclaimer", () => {
  it("gates the disclaimer badge on fAutoBrokerConfirmed, not always-on", () => {
    expect(panelSource).toContain("fAutoBrokerConfirmed(fAuto.data_source)");
    expect(panelSource).toContain("!brokerConfirmed && <span className=\"_wrv-unconfirmed-badge\">未經券商回報對帳</span>");
  });

  it("elevates the footnote tone and adds an explicit reconciliation sentence when unconfirmed", () => {
    expect(panelSource).toContain("_wrv-note-warn");
    expect(panelSource).toContain("上述損益依內部委託紀錄重建，尚未經券商回報對帳，數字可能與實際成交有落差。");
  });
});
