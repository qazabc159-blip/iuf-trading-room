import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const strategySource = readFileSync(new URL("./strategy-data.ts", import.meta.url), "utf8");

describe("quant strategies S1-only product surface", () => {
  it("surfaces S1 as the only formal quant strategy", () => {
    expect(pageSource).toContain("S1 F-AUTO");
    expect(pageSource).toContain("目前正式產品只開 S1");
    expect(pageSource).toContain("資金會由後端 S1 runner 讀取");
    expect(pageSource).toContain("loadQuantStrategies");
    expect(strategySource).toContain('id: "cont_liq_v36"');
    expect(strategySource).not.toContain("class5_revenue_momentum");
    expect(strategySource).not.toContain("family_c_sbl_overlay");
  });

  it("keeps the page honest about SIM-only execution", () => {
    // P1-1 (product critique 2026-07-10): "SIM-only guard" was a raw
    // engineering label leaked straight into the UI — translated to Chinese.
    expect(pageSource).toContain("僅模擬資金防呆");
    expect(pageSource).not.toContain("SIM-only guard");
    expect(pageSource).not.toContain("SIM-only / real order disabled");
    expect(pageSource).toContain("不會開啟真實委託");
    expect(pageSource).toContain("開啟 F-AUTO 持倉與損益");
    expect(pageSource).toContain('href="/ops/f-auto"');
    expect(pageSource).not.toContain("LAB SANCTIONED SNAPSHOT");
    expect(pageSource).not.toContain("MAIN execution rank buffer");
    expect(pageSource).not.toContain("Continuous liquidity RS");
  });

  it("translates the dataState readiness enum instead of rendering it raw (P1-1)", () => {
    expect(pageSource).toContain("dataStateLabel(strategy.current.dataState)");
    expect(pageSource).not.toContain("{strategy.current.dataState}");
  });

  it("does not ship hardcoded performance or placeholder holdings", () => {
    expect(strategySource).not.toContain("netReturnPct: 400.89");
    expect(strategySource).not.toContain('symbol: "2330"');
    expect(strategySource).not.toContain("示意：實際 basket");
    expect(strategySource).toContain("hydrateQuantStrategy");
  });

  // P0-3 data-honesty fix (#1216, 2026-07-10) frontend follow-up: headline
  // backtest numbers (命中率/最大回撤 on this list card) must not render
  // without the TrackRecordDisclosure gate, and the page must not use any
  // of the site's banned overclaim vocabulary.
  it("gates the backtest headline numbers behind TrackRecordDisclosure", () => {
    expect(pageSource).toContain("TrackRecordDisclosure");
    expect(pageSource).toContain("trackRecord.isLiveVerifiedTrackRecord");
    expect(pageSource).toContain("trackRecord.headlineDisclosureZh");
    expect(pageSource).toContain("實盤模擬");
  });

  it("never renders banned overclaim vocabulary", () => {
    for (const source of [pageSource, strategySource]) {
      expect(source).not.toMatch(/approved/i);
      expect(source).not.toMatch(/alpha confirmed/i);
      expect(source).not.toMatch(/live-ready/i);
      expect(source).not.toContain("可以跟單");
      expect(source).not.toContain("保證獲利");
    }
  });
});
