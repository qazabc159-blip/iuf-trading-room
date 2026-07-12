// apps/web/lib/institutional-lots-format.ts — B1 fix (2026-07-12 company page diagnosis).
//
// `full-profile` returns 三大法人買賣超 in raw net SHARES（股）, not 張（1 張 = 1000 股）.
// InstitutionalPanel.tsx / FullProfilePanels.tsx were formatting the raw share number
// and labeling it "張" unconverted — a 1000x unit error (e.g. -12,748,541 股 displayed
// as "-1274.9萬 張" when the real value is "-1.27萬 張"). Mirrors the backend fix already
// shipped in apps/api/src/openalice-pipeline.ts formatInstitutionalNetLotsZh() (P0-6,
// 2026-07-10) — same ÷1000 conversion + 萬/億 magnitude formatting, frontend side.

export function formatInstitutionalNetLotsZh(netShares: number): string {
  if (!Number.isFinite(netShares)) return "--";
  const netLots = netShares / 1000;
  const sign = netLots > 0 ? "+" : netLots < 0 ? "-" : "+";
  const absLots = Math.abs(netLots);
  if (absLots >= 1_0000_0000) {
    return `${sign}${(absLots / 1_0000_0000).toFixed(2)}億張`;
  }
  if (absLots >= 10_000) {
    return `${sign}${(absLots / 10_000).toFixed(2)}萬張`;
  }
  return `${sign}${Math.round(absLots).toLocaleString("zh-TW")}張`;
}
