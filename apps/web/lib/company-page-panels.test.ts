import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const announcementsPanelSource = readFileSync(
  new URL("../app/companies/[symbol]/AnnouncementsPanel.tsx", import.meta.url),
  "utf8",
);
const tickStreamPanelSource = readFileSync(
  new URL("../app/companies/[symbol]/TickStreamPanel.tsx", import.meta.url),
  "utf8",
);
const derivativesPanelSource = readFileSync(
  new URL("../app/companies/[symbol]/DerivativesPanel.tsx", import.meta.url),
  "utf8",
);
const bidAskPanelSource = readFileSync(
  new URL("../app/companies/[symbol]/BidAskPanel.tsx", import.meta.url),
  "utf8",
);
const liveTickStreamPanelSource = readFileSync(
  new URL("../app/companies/[symbol]/LiveTickStreamPanel.tsx", import.meta.url),
  "utf8",
);

const mojibakePattern = /撠|鈭|霈|蝯|鞈|銵|憪|甇||||�/;

describe("company page product data panels", () => {
  it("keeps announcement details expandable and source-backed", () => {
    expect(announcementsPanelSource).toContain("aria-expanded");
    expect(announcementsPanelSource).toContain("展開公告內容與來源");
    expect(announcementsPanelSource).toContain("開啟官方公告");
    expect(announcementsPanelSource).toContain("TWSE 公開資訊觀測站");
    expect(announcementsPanelSource).not.toMatch(mojibakePattern);
  });

  it("uses FinMind intraday bars as an honest recent-trade fallback instead of blank tick panels", () => {
    expect(tickStreamPanelSource).toContain("KGI 逐筆 / FinMind 分K");
    expect(tickStreamPanelSource).toContain("FinMind 分 K 轉成最近成交摘要");
    expect(tickStreamPanelSource).toContain("不補假 tick");
    expect(tickStreamPanelSource).not.toMatch(mojibakePattern);
  });

  it("labels unavailable derivatives as a real pending datasource instead of fake products", () => {
    expect(derivativesPanelSource).toContain("權證與選擇權");
    expect(derivativesPanelSource).toContain("不會用假資料冒充");
    expect(derivativesPanelSource).toContain("履約價");
    expect(derivativesPanelSource).toContain("隱含波動率");
    expect(derivativesPanelSource).not.toMatch(mojibakePattern);
  });

  it("keeps KGI quote side panels readable in closed, waiting, blocked, and live states", () => {
    expect(bidAskPanelSource).toContain("KGI 唯讀五檔目前尚未回傳有效委買委賣");
    expect(liveTickStreamPanelSource).toContain("KGI 唯讀逐筆目前尚未回傳有效成交明細");
    expect(bidAskPanelSource).toContain("這不是系統故障");
    expect(liveTickStreamPanelSource).toContain("這不是系統故障");
    expect(bidAskPanelSource).not.toMatch(mojibakePattern);
    expect(liveTickStreamPanelSource).not.toMatch(mojibakePattern);
  });
});
