/**
 * Mock data — placeholders matching src/lib/types.ts.
 * Replace with real backend by setting NEXT_PUBLIC_API_BASE in .env.
 * Numbers are illustrative, not real signals.
 */
import type {
  Theme, Company, Idea, Run, Signal, Quote, Position,
  RiskLimit, SessionMeta, OrderTicket, OrderPreview, OrderAck,
  ExecutionEvent, StrategyRiskLimit, SymbolRiskLimit, GuardResult,
  OpsSystem, ActivityEvent, AuditEvent, AuditSummary,
  BriefBundle, ReviewBundle, WeeklyPlan,
} from "./radar-types";

export const sessionMeta: SessionMeta = {
  operator: "IUF·01",
  sessionDate: "2026-04-25",
  weekNo: "W17",
  marketState: "POST-CLOSE",
  killMode: "ARMED",
  runId: "RUN·2026-W17·218",
};

export const themes: Theme[] = [
  { rank: 1, code: "AI-PWR",  name: "AI 算力供應鏈",     short: "ai-power",       heat: 94, dHeat: 6,  members: 12, momentum: "ACCEL",  lockState: "LOCKED", pulse: [62,71,68,75,82,88,94] },
  { rank: 2, code: "HBM-TW",  name: "HBM·先進封裝",      short: "hbm-advpkg",     heat: 91, dHeat: 9,  members: 8,  momentum: "ACCEL",  lockState: "TRACK",  pulse: [54,58,66,71,80,86,91] },
  { rank: 3, code: "ROBOT",   name: "人形機器人",        short: "humanoid",       heat: 82, dHeat: 12, members: 14, momentum: "ACCEL",  lockState: "TRACK",  pulse: [40,48,55,62,68,75,82] },
  { rank: 4, code: "SLCN-PV", name: "矽光子 / CPO",      short: "silicon-photon", heat: 76, dHeat: 3,  members: 9,  momentum: "STEADY", lockState: "WATCH",  pulse: [70,72,71,73,74,75,76] },
  { rank: 5, code: "PWR-GRD", name: "電網重建·儲能",     short: "grid-storage",   heat: 71, dHeat: -2, members: 11, momentum: "STEADY", lockState: "WATCH",  pulse: [73,74,72,71,71,70,71] },
  { rank: 6, code: "BIO-WT",  name: "生技·減重",         short: "bio-weight",     heat: 68, dHeat: 5,  members: 7,  momentum: "ACCEL",  lockState: "WATCH",  pulse: [58,60,62,64,65,66,68] },
  { rank: 7, code: "DDR5",    name: "記憶體·DDR5",       short: "memory",         heat: 64, dHeat: -8, members: 10, momentum: "DECEL",  lockState: "STALE",  pulse: [78,76,73,70,68,66,64] },
  { rank: 8, code: "AUTO-EV", name: "電動車·智駕",       short: "auto-ev",        heat: 58, dHeat: -1, members: 13, momentum: "STEADY", lockState: "STALE",  pulse: [60,59,59,58,58,58,58] },
  { rank: 9, code: "DEFENSE", name: "國防·無人機",       short: "defense",        heat: 54, dHeat: 4,  members: 6,  momentum: "ACCEL",  lockState: "WATCH",  pulse: [42,44,46,48,50,52,54] },
  { rank: 10,code: "CYBR",    name: "資安·零信任",       short: "cyber",          heat: 49, dHeat: 2,  members: 5,  momentum: "STEADY", lockState: "WATCH",  pulse: [45,46,46,47,48,48,49] },
  { rank: 11,code: "PRT-TW",  name: "封測·後段檢測",     short: "test-back",      heat: 41, dHeat: -6, members: 8,  momentum: "DECEL",  lockState: "STALE",  pulse: [55,52,50,48,45,43,41] },
];

export const companies: Company[] = [
  { symbol: "2330", name: "台積電",   marketCapBn: 16420.0, themes: ["AI-PWR","HBM-TW","SLCN-PV"], score: 0.94, momentum: "ACCEL",  intradayChgPct: 1.84, fiiNetBn5d: 2.84, listing: "TWSE" },
  { symbol: "3008", name: "大立光",   marketCapBn: 742.4,   themes: ["AI-PWR"],                    score: 0.74, momentum: "STEADY", intradayChgPct: 0.62, fiiNetBn5d: 0.42, listing: "TWSE" },
  { symbol: "2454", name: "聯發科",   marketCapBn: 1964.8,  themes: ["AI-PWR"],                    score: 0.71, momentum: "ACCEL",  intradayChgPct: 2.11, fiiNetBn5d: 0.84, listing: "TWSE" },
  { symbol: "6504", name: "南六",     marketCapBn: 38.1,    themes: ["PWR-GRD"],                   score: 0.68, momentum: "ACCEL",  intradayChgPct: 0.34, fiiNetBn5d: 0.04, listing: "TWSE" },
  { symbol: "4915", name: "致伸",     marketCapBn: 88.4,    themes: ["ROBOT","DDR5"],              score: 0.55, momentum: "STEADY", intradayChgPct: -0.44,fiiNetBn5d: 0.00, listing: "TWSE" },
  { symbol: "1503", name: "士電",     marketCapBn: 124.2,   themes: ["PWR-GRD","ROBOT"],           score: 0.52, momentum: "ACCEL",  intradayChgPct: 1.20, fiiNetBn5d: 0.18, listing: "TWSE" },
  { symbol: "2376", name: "技嘉",     marketCapBn: 332.1,   themes: ["DDR5"],                      score: 0.61, momentum: "DECEL",  intradayChgPct: -1.10,fiiNetBn5d: 0.00, listing: "TWSE" },
  { symbol: "2317", name: "鴻海",     marketCapBn: 2184.0,  themes: ["AI-PWR","ROBOT"],            score: 0.78, momentum: "ACCEL",  intradayChgPct: 0.92, fiiNetBn5d: 1.62, listing: "TWSE" },
  { symbol: "5347", name: "世界",     marketCapBn: 168.4,   themes: ["HBM-TW","PRT-TW"],           score: 0.49, momentum: "STEADY", intradayChgPct: 0.10, fiiNetBn5d: 0.04, listing: "TWSE" },
  { symbol: "3661", name: "世芯-KY",  marketCapBn: 401.2,   themes: ["AI-PWR"],                    score: 0.81, momentum: "ACCEL",  intradayChgPct: 3.42, fiiNetBn5d: 0.96, listing: "TWSE" },
];

export const ideas: Idea[] = [
  { id: "ID-1142", symbol: "6504", side: "LONG",  quality: "HIGH", confidence: 0.78, score: 0.82, themeCode: "PWR-GRD", rationale: "電網重建受惠 · 訂單能見度 H2 抬升 · 控倉 ≤ 8%",     emittedAt: "2026-04-25T14:29:55+08:00", expiresAt: "2026-04-28T01:00:00Z", runId: "RUN·2026-W17·218" },
  { id: "ID-1141", symbol: "2330", side: "LONG",  quality: "HIGH", confidence: 0.74, score: 0.79, themeCode: "AI-PWR",  rationale: "CoWoS 產能持續滿載 · 外資連 3 日加碼權值核心",      emittedAt: "2026-04-25T14:29:55+08:00", expiresAt: "2026-04-28T01:00:00Z", runId: "RUN·2026-W17·218" },
  { id: "ID-1140", symbol: "3008", side: "LONG",  quality: "MED",  confidence: 0.62, score: 0.71, themeCode: "AI-PWR",  rationale: "光學鏡頭出貨重新進入旺季 · 但 ASP 壓力仍存",          emittedAt: "2026-04-25T14:29:55+08:00", expiresAt: "2026-04-28T01:00:00Z", runId: "RUN·2026-W17·218" },
  { id: "ID-1139", symbol: "4915", side: "LONG",  quality: "MED",  confidence: 0.58, score: 0.66, themeCode: "ROBOT",   rationale: "人形機器人致動模組驗證進入第 3 季 · 量產前夕",        emittedAt: "2026-04-25T14:29:55+08:00", expiresAt: "2026-04-28T01:00:00Z", runId: "RUN·2026-W17·218" },
  { id: "ID-1138", symbol: "2376", side: "TRIM",  quality: "MED",  confidence: 0.55, score: 0.61, themeCode: "DDR5",    rationale: "板卡需求轉弱 · DDR5 主題 d7 動能 -8 · 建議減碼 1/3",   emittedAt: "2026-04-25T14:29:55+08:00", expiresAt: "2026-04-28T01:00:00Z", runId: "RUN·2026-W17·218" },
  { id: "ID-1137", symbol: "2454", side: "LONG",  quality: "HIGH", confidence: 0.70, score: 0.75, themeCode: "AI-PWR",  rationale: "天璣 9400 升級週期 · 4Q 出貨彈性最大",                emittedAt: "2026-04-25T09:00:11+08:00", expiresAt: "2026-04-28T01:00:00Z", runId: "RUN·2026-W17·217" },
  { id: "ID-1136", symbol: "2317", side: "EXIT",  quality: "MED",  confidence: 0.54, score: 0.59, themeCode: "AI-PWR",  rationale: "雲端 Server 接單放緩 · 毛利率壓力擴大 · 出清",        emittedAt: "2026-04-25T09:00:11+08:00", expiresAt: "2026-04-26T01:00:00Z", runId: "RUN·2026-W17·217" },
  { id: "ID-1135", symbol: "1303", side: "SHORT", quality: "LOW",  confidence: 0.48, score: 0.52, themeCode: "DDR5",    rationale: "傳產存貨水位偏高 · 觀望可空 · 倉位嚴控 ≤ 3%",          emittedAt: "2026-04-24T14:33:21+08:00", expiresAt: "2026-04-25T01:00:00Z", runId: "RUN·2026-W17·216" },
  { id: "ID-1134", symbol: "8069", side: "LONG",  quality: "HIGH", confidence: 0.81, score: 0.86, themeCode: "PWR-GRD", rationale: "電網逆變器主力 · 連兩季毛利擴張 · FII 連 5 加碼",      emittedAt: "2026-04-24T14:33:21+08:00", expiresAt: "2026-04-27T01:00:00Z", runId: "RUN·2026-W17·216" },
  { id: "ID-1133", symbol: "2382", side: "LONG",  quality: "MED",  confidence: 0.59, score: 0.64, themeCode: "AI-PWR",  rationale: "AI Server 滲透率提升 · 但近期股價漲幅已多",            emittedAt: "2026-04-24T14:33:21+08:00", expiresAt: "2026-04-27T01:00:00Z", runId: "RUN·2026-W17·216" },
];

export const runs: Run[] = [
  { id: "RUN·2026-W17·218", startedAt: "2026-04-25T06:32:00Z", source: "auto·post-close", ideasEmitted: 5, highQualityCount: 2, avgConfidence: 0.65, durationMs: 684000, strategyVersion: "v3.4.2", state: "ACTIVE",
    query: { mode: "post-close", sort: "score", limit: 8, signalDays: 7, qualityFilter: ["HIGH","MED"], decisionFilter: ["LONG","SHORT","TRIM","EXIT"], market: ["TWSE","TPEX"], symbol: null, theme: null } },
  { id: "RUN·2026-W17·217", startedAt: "2026-04-25T01:00:00Z", source: "auto·pre-open",   ideasEmitted: 4, highQualityCount: 1, avgConfidence: 0.61, durationMs: 648000, strategyVersion: "v3.4.2", state: "ARCHIVED",
    query: { mode: "pre-open", sort: "confidence", limit: 6, signalDays: 5, qualityFilter: ["HIGH","MED"], decisionFilter: ["LONG","SHORT"], market: ["TWSE"], symbol: null, theme: null } },
  { id: "RUN·2026-W17·216", startedAt: "2026-04-24T06:32:00Z", source: "auto·post-close", ideasEmitted: 6, highQualityCount: 3, avgConfidence: 0.68, durationMs: 726000, strategyVersion: "v3.4.2", state: "ARCHIVED",
    query: { mode: "post-close", sort: "score", limit: 8, signalDays: 7, qualityFilter: ["HIGH","MED","LOW"], decisionFilter: ["LONG","SHORT","TRIM","EXIT"], market: ["TWSE","TPEX"], symbol: null, theme: null } },
  { id: "RUN·2026-W17·215", startedAt: "2026-04-24T01:00:00Z", source: "auto·pre-open",   ideasEmitted: 3, highQualityCount: 1, avgConfidence: 0.58, durationMs: 624000, strategyVersion: "v3.4.1", state: "ARCHIVED",
    query: { mode: "pre-open", sort: "fii", limit: 5, signalDays: 5, qualityFilter: ["HIGH"], decisionFilter: ["LONG"], market: ["TWSE"], symbol: null, theme: null } },
  { id: "RUN·2026-W17·214", startedAt: "2026-04-23T06:32:00Z", source: "manual",          ideasEmitted: 7, highQualityCount: 2, avgConfidence: 0.71, durationMs: 828000, strategyVersion: "v3.4.1", state: "ARCHIVED",
    query: { mode: "manual", sort: "momentum", limit: 12, signalDays: 14, qualityFilter: ["HIGH","MED","LOW"], decisionFilter: ["LONG","SHORT","TRIM","EXIT"], market: ["TWSE","TPEX"], symbol: null, theme: "AI-PWR" } },
  { id: "RUN·2026-W16·213", startedAt: "2026-04-22T01:00:00Z", source: "auto·pre-open",   ideasEmitted: 0, highQualityCount: 0, avgConfidence: 0,    durationMs: 12400,  strategyVersion: "v3.4.1", state: "FAILED",
    query: { mode: "pre-open", sort: "score", limit: 6, signalDays: 5, qualityFilter: ["HIGH","MED"], decisionFilter: ["LONG","SHORT"], market: ["TWSE"], symbol: null, theme: null } },
];

export const signals: Signal[] = [
  // ── 2026-04-25 ──
  { id: "S1",  emittedAt: "2026-04-25T06:32:08Z", code: "S·MOM·ACL", channel: "MOM", symbol: "6504", themeCode: null,      quality: "HIGH", state: "EMITTED", trigger: "MOM ACL · pulse +18 d7" },
  { id: "S2",  emittedAt: "2026-04-25T06:32:08Z", code: "S·FII·NET", channel: "FII", symbol: "2330", themeCode: null,      quality: "HIGH", state: "EMITTED", trigger: "FII NET +2.84BN d3" },
  { id: "S3",  emittedAt: "2026-04-25T06:32:08Z", code: "S·THM·ACL", channel: "THM", symbol: null,   themeCode: "AI-PWR",  quality: "MED",  state: "EMITTED", trigger: "AI-PWR theme heat 88 → 92" },
  { id: "S4",  emittedAt: "2026-04-25T06:32:08Z", code: "S·KW·SPK",  channel: "KW",  symbol: "2454", themeCode: null,      quality: "MED",  state: "EMITTED", trigger: "kw[CoWoS] 14 → 38 d7" },
  { id: "S5",  emittedAt: "2026-04-25T06:32:08Z", code: "S·MOM·DCL", channel: "MOM", symbol: "2376", themeCode: null,      quality: "MED",  state: "EMITTED", trigger: "MOM DCL · DDR5 d7 -8" },
  { id: "S6",  emittedAt: "2026-04-25T06:30:11Z", code: "S·VOL·BRK", channel: "VOL", symbol: "3008", themeCode: null,      quality: "LOW",  state: "MUTED",   trigger: "vol breakout · liq thin" },
  { id: "S7",  emittedAt: "2026-04-25T05:48:02Z", code: "S·MAN·NTE", channel: "MAN", symbol: "2615", themeCode: null,      quality: "MED",  state: "EMITTED", trigger: "manual flag · 干散貨 freight 連 3 週擴張" },
  { id: "S8",  emittedAt: "2026-04-25T05:12:22Z", code: "S·THM·DCL", channel: "THM", symbol: null,   themeCode: "DDR5",    quality: "LOW",  state: "EMITTED", trigger: "DDR5 theme heat 64 → 58" },
  { id: "S9",  emittedAt: "2026-04-25T04:33:18Z", code: "S·FII·OUT", channel: "FII", symbol: "2317", themeCode: null,      quality: "MED",  state: "EMITTED", trigger: "FII OUT -1.42BN d5 · 連賣" },
  { id: "S10", emittedAt: "2026-04-25T03:58:05Z", code: "S·KW·HOT",  channel: "KW",  symbol: null,   themeCode: "ROBOT",   quality: "HIGH", state: "EMITTED", trigger: "kw[人形機器人] +56 d7 · 媒體聲量集中" },
  { id: "S11", emittedAt: "2026-04-25T02:45:41Z", code: "S·VOL·CMP", channel: "VOL", symbol: "8069", themeCode: null,      quality: "LOW",  state: "MUTED",   trigger: "vol compress · range -42% d10" },
  { id: "S12", emittedAt: "2026-04-25T01:00:00Z", code: "S·MOM·ACL", channel: "MOM", symbol: "1303", themeCode: null,      quality: "LOW",  state: "MUTED",   trigger: "MOM ACL · 但流動性偏低" },

  // ── 2026-04-24 ──
  { id: "S13", emittedAt: "2026-04-24T14:33:21Z", code: "S·THM·ACL", channel: "THM", symbol: null,   themeCode: "PWR-GRD", quality: "HIGH", state: "EMITTED", trigger: "PWR-GRD theme heat 71 → 79" },
  { id: "S14", emittedAt: "2026-04-24T14:21:04Z", code: "S·FII·NET", channel: "FII", symbol: "8069", themeCode: null,      quality: "HIGH", state: "EMITTED", trigger: "FII NET +0.88BN d5 · 連 5 加碼" },
  { id: "S15", emittedAt: "2026-04-24T13:42:15Z", code: "S·MOM·ACL", channel: "MOM", symbol: "2382", themeCode: null,      quality: "MED",  state: "EMITTED", trigger: "MOM ACL · AI-server pull-in" },
  { id: "S16", emittedAt: "2026-04-24T11:08:33Z", code: "S·KW·SPK",  channel: "KW",  symbol: null,   themeCode: "BIO-RT",  quality: "MED",  state: "EMITTED", trigger: "kw[減重藥] 12 → 31 d7" },
  { id: "S17", emittedAt: "2026-04-24T09:55:12Z", code: "S·VOL·BRK", channel: "VOL", symbol: "8081", themeCode: null,      quality: "MED",  state: "EMITTED", trigger: "vol breakout · 量價齊揚" },
  { id: "S18", emittedAt: "2026-04-24T08:44:00Z", code: "S·MAN·NTE", channel: "MAN", symbol: null,   themeCode: "AUTO-EV", quality: "LOW",  state: "MUTED",   trigger: "manual flag · 但電動車補貼預期已 priced-in" },
];

export const quotes: Quote[] = [
  { symbol: "6504", last: 84.20,   change: 1.20,   changePct: 1.45,  state: "LIVE",  asOf: "2026-04-25T06:32:00Z" },
  { symbol: "2330", last: 1084,    change: 19.0,   changePct: 1.84,  state: "LIVE",  asOf: "2026-04-25T06:32:00Z" },
  { symbol: "3008", last: 2540,    change: 15.0,   changePct: 0.62,  state: "LIVE",  asOf: "2026-04-25T06:32:00Z" },
  { symbol: "2454", last: 1420,    change: 29.0,   changePct: 2.11,  state: "LIVE",  asOf: "2026-04-25T06:32:00Z" },
  { symbol: "TWA",  last: 21486.4, change: 184.22, changePct: 0.86,  state: "CLOSE", asOf: "2026-04-25T05:30:00Z" },
];

export const positions: Position[] = [
  { symbol: "2330", name: "台積電",   qty: 1000, avgPx: 1064.0, lastPx: 1084,  changePct: 1.84,  pnlTwd: 428000, pctNav: 10.4 },
  { symbol: "6504", name: "南六",     qty: 6000, avgPx: 82.7,   lastPx: 84.20, changePct: 1.45,  pnlTwd: 32800,  pctNav: 1.8 },
  { symbol: "3008", name: "大立光",   qty: 200,  avgPx: 2520.0, lastPx: 2540,  changePct: 0.62,  pnlTwd: 18400,  pctNav: 5.6 },
  { symbol: "2454", name: "聯發科",   qty: 800,  avgPx: 1391.0, lastPx: 1420,  changePct: 2.11,  pnlTwd: 84200,  pctNav: 8.4 },
  { symbol: "2317", name: "鴻海",     qty: 5000, avgPx: 202.0,  lastPx: 204,   changePct: 0.92,  pnlTwd: 12400,  pctNav: 4.2 },
  { symbol: "2376", name: "技嘉",     qty: 800,  avgPx: 348.0,  lastPx: 342,   changePct: -1.10, pnlTwd: -11200, pctNav: 2.8 },
];

export const riskLimits: RiskLimit[] = [
  { rule: "MAX·NOTIONAL", limit: "  500,000",  current: "  TWD",   result: "PASS", layer: "ACCT"  },
  { rule: "MAX·SYMBOL %", limit: " 8.0%",      current: " of NAV", result: "PASS", layer: "STRAT" },
  { rule: "MAX·THEME %",  limit: "12.0%",      current: " of NAV", result: "PASS", layer: "STRAT" },
  { rule: "MAX·DAILY DD", limit: " 1.5%",      current: " of NAV", result: "PASS", layer: "ACCT"  },
  { rule: "VAR·1D 95%",   limit: "  62,400",   current: "  TWD",   result: "PASS", layer: "ACCT"  },
  { rule: "VOL·SHARE",    limit: " 0.8%",      current: " of ADV", result: "WARN", layer: "SYM"   },
  { rule: "KIL·MODE",     limit: "ARMED",      current: "  ·",     result: "PASS", layer: "SESS"  },
];

/* ─── Order preview / submit (deterministic mock) ──────────────────── */
export function previewOrder(t: OrderTicket): OrderPreview {
  const px = t.limitPx ?? quotes.find(q => q.symbol === t.symbol)?.last ?? 100;
  const notional = px * t.qty;
  const equity = 4_120_000;             // TWD
  const guards: GuardResult[] = [
    { rule: "MAX·NOTIONAL", layer: "ACCT",  limit: "500,000 TWD",
      observed: `${notional.toLocaleString()} TWD`,
      result: notional > 500_000 ? "BLOCK" : "PASS",
      reason: notional > 500_000 ? "單筆 notional 超限" : undefined },
    { rule: "MAX·SYMBOL %", layer: "STRAT", limit: "8.0% of NAV",
      observed: `${((notional/equity)*100).toFixed(2)}% of NAV`,
      result: notional/equity > 0.08 ? "WARN" : "PASS" },
    { rule: "MAX·DAILY DD", layer: "ACCT",  limit: "1.5% of NAV",
      observed: "0.32% used",  result: "PASS" },
    { rule: "VOL·SHARE",    layer: "SYM",   limit: "0.8% of ADV",
      observed: "0.42% est.",  result: "PASS" },
    { rule: "KIL·MODE",     layer: "SESS",  limit: "ARMED",
      observed: sessionMeta.killMode,
      result: sessionMeta.killMode === "ARMED" ? "PASS" : "BLOCK",
      reason: sessionMeta.killMode === "ARMED" ? undefined : `KILL=${sessionMeta.killMode} · 禁止下單` },
  ];
  const pass = guards.every(g => g.result !== "BLOCK");
  return {
    pass,
    guards,
    effectiveLimits: guards.filter(g => g.result !== "PASS").length
      ? guards.filter(g => g.result !== "PASS")
      : guards.slice(0, 3),
    sizing: {
      sizingMode: "risk-pct",
      equity,
      riskPerTrade: 0.005,
      lotSize: 1000,
      capByMaxPositionPct: Math.floor(equity * 0.08 / px),
      finalQty: t.qty,
      notes: "qty 由 risk-pct 0.5% × equity ÷ limitPx 推導，再以單檔 8% 上限封頂。",
    },
  };
}

export function submitOrder(t: OrderTicket): OrderAck {
  const blocked = sessionMeta.killMode !== "ARMED";
  return {
    orderId: blocked ? "" : `ORD-${Date.now().toString(36).toUpperCase()}`,
    clientOrderId: `CLI-${t.symbol}-${Date.now().toString(36).slice(-5).toUpperCase()}`,
    status: blocked ? "REJECTED" : "ACCEPTED",
    rejectReason: blocked ? `KILL=${sessionMeta.killMode}` : undefined,
    acceptedAt: new Date().toISOString(),
  };
}

/* ─── Execution event stream (initial hydrate) ─────────────────────── */
export const executionEvents: ExecutionEvent[] = [
  { id: "EV-7", kind: "order_filled",    ts: "2026-04-25T05:31:48Z",
    orderId: "ORD-LZ8K2", clientOrderId: "CLI-2330-1A2", symbol: "2330",
    side: "BUY",  qty: 1000, price: 1084, fee: 152, tax: 326,
    raw: { venue: "TWSE", tif: "ROD", strategy: "v3.4.2" } },
  { id: "EV-6", kind: "order_placed",    ts: "2026-04-25T05:31:46Z",
    orderId: "ORD-LZ8K2", clientOrderId: "CLI-2330-1A2", symbol: "2330",
    side: "BUY",  qty: 1000, price: 1084, fee: null, tax: null,
    raw: { venue: "TWSE", tif: "ROD" } },
  { id: "EV-5", kind: "risk_blocked",    ts: "2026-04-25T05:28:11Z",
    orderId: null, clientOrderId: "CLI-3661-XX1", symbol: "3661",
    side: "BUY",  qty: 200,  price: 2540, fee: null, tax: null,
    raw: { rule: "MAX·NOTIONAL", layer: "ACCT", limit: "500000", observed: "508000" } },
  { id: "EV-4", kind: "order_filled",    ts: "2026-04-25T05:18:02Z",
    orderId: "ORD-LZ7G9", clientOrderId: "CLI-6504-9F4", symbol: "6504",
    side: "BUY",  qty: 6000, price: 84.10, fee: 84,  tax: 152,
    raw: { venue: "TWSE", tif: "ROD" } },
  { id: "EV-3", kind: "order_cancelled", ts: "2026-04-25T05:08:51Z",
    orderId: "ORD-LZ72X", clientOrderId: "CLI-2376-4D2", symbol: "2376",
    side: "TRIM", qty: 400,  price: 348,  fee: null, tax: null,
    raw: { reason: "operator-cancel" } },
  { id: "EV-2", kind: "order_rejected",  ts: "2026-04-25T04:58:33Z",
    orderId: null, clientOrderId: "CLI-2454-AA1", symbol: "2454",
    side: "BUY",  qty: 800,  price: 1420, fee: null, tax: null,
    raw: { reason: "venue-reject", code: "21" } },
  { id: "EV-1", kind: "order_placed",    ts: "2026-04-25T04:42:18Z",
    orderId: "ORD-LZ6Q1", clientOrderId: "CLI-2317-9P0", symbol: "2317",
    side: "BUY",  qty: 5000, price: 204, fee: null, tax: null,
    raw: { venue: "TWSE", tif: "ROD" } },
];

/* ─── Risk-layer overrides ─────────────────────────────────────────── */
export const strategyLimits: StrategyRiskLimit[] = [
  { id: "S-MOMO", scope: "strategy", scopeKey: "MOMO·v3", maxPerTrade: 600_000, dailyPnl: -45_000,
    singlePosPct: 0.10, themePosPct: 0.15, grossPosPct: 0.85, updatedAt: "2026-04-22T03:11:00Z",
    note: "AI-PWR 主題 H2 拉高權重" },
  { id: "S-MEAN", scope: "strategy", scopeKey: "MEAN·v2", maxPerTrade: 300_000, dailyPnl: -25_000,
    singlePosPct: 0.05, themePosPct: null, grossPosPct: 0.50, updatedAt: "2026-04-19T08:02:00Z" },
];
export const symbolLimits: SymbolRiskLimit[] = [
  { id: "SY-2330", scope: "symbol", scopeKey: "2330", maxPerTrade: 1_000_000, dailyPnl: null,
    singlePosPct: 0.12, themePosPct: null, grossPosPct: null, updatedAt: "2026-04-23T01:50:00Z",
    note: "權值核心 · 拉高單檔上限" },
  { id: "SY-3661", scope: "symbol", scopeKey: "3661", maxPerTrade: 200_000, dailyPnl: null,
    singlePosPct: 0.04, themePosPct: null, grossPosPct: null, updatedAt: "2026-04-21T11:12:00Z",
    note: "波動高 · 收緊" },
];


/* ─── Ops · System health ──────────────────────────────────────────── */
export const opsSystem: OpsSystem = {
  apis: [
    { endpoint: "/api/themes",                method: "GET",  state: "GREEN", lastSeen: "2026-04-25T06:32:08Z", latencyMs:  84, errorRate24h: 0.000 },
    { endpoint: "/api/companies",             method: "GET",  state: "GREEN", lastSeen: "2026-04-25T06:32:05Z", latencyMs: 142, errorRate24h: 0.001 },
    { endpoint: "/api/ideas",                 method: "GET",  state: "GREEN", lastSeen: "2026-04-25T06:32:08Z", latencyMs:  68, errorRate24h: 0.000 },
    { endpoint: "/api/runs",                  method: "GET",  state: "GREEN", lastSeen: "2026-04-25T06:32:00Z", latencyMs:  91, errorRate24h: 0.000 },
    { endpoint: "/api/signals",               method: "GET",  state: "GREEN", lastSeen: "2026-04-25T06:32:08Z", latencyMs:  72, errorRate24h: 0.000 },
    { endpoint: "/api/quotes",                method: "GET",  state: "AMBER", lastSeen: "2026-04-25T06:31:48Z", latencyMs: 312, errorRate24h: 0.018, },
    { endpoint: "/api/portfolio/positions",   method: "GET",  state: "GREEN", lastSeen: "2026-04-25T06:32:00Z", latencyMs: 104, errorRate24h: 0.000 },
    { endpoint: "/api/portfolio/risk",        method: "GET",  state: "GREEN", lastSeen: "2026-04-25T06:31:55Z", latencyMs:  88, errorRate24h: 0.000 },
    { endpoint: "/api/orders/preview",        method: "POST", state: "GREEN", lastSeen: "2026-04-25T06:28:12Z", latencyMs: 165, errorRate24h: 0.002 },
    { endpoint: "/api/orders",                method: "POST", state: "GREEN", lastSeen: "2026-04-25T05:31:48Z", latencyMs: 248, errorRate24h: 0.000 },
    { endpoint: "/api/portfolio/kill-mode",   method: "POST", state: "GREEN", lastSeen: "2026-04-24T16:02:11Z", latencyMs:  44, errorRate24h: 0.000 },
    { endpoint: "/api/trading/events/stream", method: "GET",  state: "AMBER", lastSeen: "2026-04-25T06:30:00Z", latencyMs: 0,   errorRate24h: 0.042, },
  ],
  dataSource: {
    state: "MOCK", baseUrl: "", lastFetchAt: null, lastError: null,
    offlineCount24h: 0, fallbackCount24h: 0,
  },
  jobs: [
    { jobId: "JOB-7G8K9", kind: "openalice·post-close", state: "DONE",
      startedAt: "2026-04-24T13:30:00Z", finishedAt: "2026-04-24T13:32:18Z", durationMs: 138_000,
      payload: { ideasEmitted: 11 } },
    { jobId: "JOB-7G8L1", kind: "fii·sync",            state: "DONE",
      startedAt: "2026-04-24T15:30:00Z", finishedAt: "2026-04-24T15:30:42Z", durationMs:  42_000 },
    { jobId: "JOB-7G8M2", kind: "kw·heat·rebuild",     state: "DONE",
      startedAt: "2026-04-25T01:00:00Z", finishedAt: "2026-04-25T01:04:11Z", durationMs: 251_000 },
    { jobId: "JOB-7G8N3", kind: "openalice·pre-open",  state: "DONE",
      startedAt: "2026-04-25T06:30:00Z", finishedAt: "2026-04-25T06:32:08Z", durationMs: 128_000,
      payload: { ideasEmitted: 9, runId: "RUN·2026-W17·219" } },
    { jobId: "JOB-7G8N4", kind: "vol·breakout·scan",   state: "RUNNING",
      startedAt: "2026-04-25T06:32:10Z", finishedAt: null, durationMs: null },
    { jobId: "JOB-7G8N5", kind: "audit·daily·digest",  state: "QUEUED",
      startedAt: "2026-04-25T07:00:00Z", finishedAt: null, durationMs: null },
    { jobId: "JOB-7G8L8", kind: "kgi·position·sync",   state: "FAILED",
      startedAt: "2026-04-24T17:00:00Z", finishedAt: "2026-04-24T17:00:18Z", durationMs:  18_000,
      errorMsg: "KGI gateway 504 · retry scheduled" },
  ],
  build: {
    version: "0.5.0",
    commit: "a3f1c92",
    branch: "main",
    deployedAt: "2026-04-25T03:14:00Z",
    nodeEnv: "development",
  },
};

/* ─── Ops · Activity log ───────────────────────────────────────────── */
export const activityEvents: ActivityEvent[] = [
  { id: "AC-21", ts: "2026-04-25T06:32:10Z", source: "scheduler", severity: "INFO",
    event: "vol.scan.started",       summary: "vol·breakout·scan kicked off (5m bars · TWSE+TPEX)" },
  { id: "AC-20", ts: "2026-04-25T06:32:08Z", source: "worker",    severity: "INFO",
    event: "openalice.run.completed", summary: "RUN·2026-W17·219 · 9 ideas emitted · 128s",
    payload: { runId: "RUN·2026-W17·219", ideasEmitted: 9 } },
  { id: "AC-19", ts: "2026-04-25T06:31:48Z", source: "api",       severity: "WARN",
    event: "quotes.latency.spike",    summary: "/api/quotes latency 312ms (p95 = 180ms)" },
  { id: "AC-18", ts: "2026-04-25T05:31:48Z", source: "manual",    severity: "INFO",
    event: "order.filled",            summary: "ORD-LZ8K2 · 2330 BUY 1000 @ 1084 · IUF·01" },
  { id: "AC-17", ts: "2026-04-25T05:28:11Z", source: "api",       severity: "WARN",
    event: "risk.blocked",            summary: "CLI-3661-XX1 · MAX·NOTIONAL · 508,000 > 500,000" },
  { id: "AC-16", ts: "2026-04-25T04:00:00Z", source: "scheduler", severity: "INFO",
    event: "kw.heat.rebuilt",         summary: "kw heatmap rebuilt · 2,431 keywords · 4m11s" },
  { id: "AC-15", ts: "2026-04-25T03:14:00Z", source: "ext",       severity: "INFO",
    event: "deploy.completed",        summary: "v0.5.0 · commit a3f1c92 · main" },
  { id: "AC-14", ts: "2026-04-24T17:00:18Z", source: "worker",    severity: "ERROR",
    event: "kgi.sync.failed",         summary: "KGI gateway 504 · retry T+5m" },
  { id: "AC-13", ts: "2026-04-24T16:02:11Z", source: "manual",    severity: "INFO",
    event: "kill_mode.changed",       summary: "ARMED → SAFE (post-close) · IUF·01" },
  { id: "AC-12", ts: "2026-04-24T15:30:42Z", source: "scheduler", severity: "INFO",
    event: "fii.sync.completed",      summary: "FII net flows synced · 1,247 symbols · 42s" },
];

/* ─── Ops · Audit log ──────────────────────────────────────────────── */
export const auditEvents: AuditEvent[] = [
  { id: "AU-92", ts: "2026-04-25T05:31:48Z", actor: "IUF·01",    action: "WRITE", entityType: "order",       entityId: "ORD-LZ8K2",
    diff: { side: "BUY", symbol: "2330", qty: 1000, price: 1084 }, ip: "10.4.7.21" },
  { id: "AU-91", ts: "2026-04-25T05:31:46Z", actor: "IUF·01",    action: "WRITE", entityType: "order_preview", entityId: "CLI-2330-1A2",
    diff: { result: "PASS", guards: 5 }, ip: "10.4.7.21" },
  { id: "AU-90", ts: "2026-04-25T04:42:18Z", actor: "IUF·01",    action: "WRITE", entityType: "order",       entityId: "ORD-LZ6Q1",
    diff: { side: "BUY", symbol: "2317", qty: 5000 }, ip: "10.4.7.21" },
  { id: "AU-89", ts: "2026-04-25T03:14:00Z", actor: "system",    action: "WRITE", entityType: "deploy",      entityId: "v0.5.0",
    diff: { commit: "a3f1c92", from: "v0.4.0" } },
  { id: "AU-88", ts: "2026-04-24T16:02:11Z", actor: "IUF·01",    action: "WRITE", entityType: "kill_mode",   entityId: "session·2026-04-24",
    diff: { from: "ARMED", to: "SAFE" }, ip: "10.4.7.21" },
  { id: "AU-87", ts: "2026-04-24T13:50:00Z", actor: "IUF·01",    action: "WRITE", entityType: "risk_limit",  entityId: "S-MOMO",
    diff: { themePosPct: { from: 0.12, to: 0.15 } }, ip: "10.4.7.21" },
  { id: "AU-86", ts: "2026-04-24T13:32:18Z", actor: "scheduler", action: "WRITE", entityType: "run",         entityId: "RUN·2026-W17·218",
    diff: { ideasEmitted: 11, state: "ACTIVE" } },
  { id: "AU-85", ts: "2026-04-24T11:08:00Z", actor: "IUF·01",    action: "DELETE", entityType: "idea",       entityId: "ID-1138",
    diff: { reason: "duplicate" }, ip: "10.4.7.21" },
];

export const auditSummary: AuditSummary = {
  todayTotal: 14,
  byAction: { WRITE: 12, READ: 0, DELETE: 2 },
  byActor: [
    { actor: "IUF·01",    count: 11 },
    { actor: "system",    count: 2 },
    { actor: "scheduler", count: 1 },
  ],
  byEntity: [
    { entityType: "order",         count: 5 },
    { entityType: "order_preview", count: 4 },
    { entityType: "kill_mode",     count: 2 },
    { entityType: "risk_limit",    count: 1 },
    { entityType: "idea",          count: 1 },
    { entityType: "run",           count: 1 },
  ],
};

/* ─── Plans · Brief / Review / Weekly ──────────────────────────────── */
export const briefBundle: BriefBundle = {
  date: "2026-04-25",
  market: {
    state: "PRE-OPEN",
    countdownSec: 1840,            // ~30min to open
    futuresNight: { last: 21_510, chgPct: 0.18 },
    usMarket:     { index: "NDX", last: 21486.4, chgPct: 0.86, closeTs: "2026-04-25T04:00:00Z" },
    events: [
      { ts: "2026-04-25T08:30:00Z", label: "央行 4 月理監事會 · 利率決議",      weight: "HIGH" },
      { ts: "2026-04-25T13:30:00Z", label: "TSMC · Q1 法說會",                weight: "HIGH" },
      { ts: "2026-04-25T20:30:00Z", label: "美 · 3 月核心 PCE 物價",            weight: "MED"  },
    ],
  },
  topThemes: [],   // populated at request time from themes
  ideasOpen: [],   // populated at request time from ideas (not expired)
  watchlist: [
    { symbol: "2330", name: "台積電", themeCode: "AI-PWR",  note: "權值核心" },
    { symbol: "2454", name: "聯發科", themeCode: "AI-PWR",  note: "Q1 法說 4/28" },
    { symbol: "6504", name: "南六",   themeCode: "BIO-RT",  note: "持倉中" },
    { symbol: "8069", name: "元太",   themeCode: "PWR-GRD" },
    { symbol: "2382", name: "廣達",   themeCode: "AI-PWR",  note: "AI server pull-in" },
    { symbol: "3711", name: "日月光投控", themeCode: "AI-PWR" },
  ],
  riskTodayLimits: [],   // populated from riskLimits
};

export const reviewBundle: ReviewBundle = {
  date: "2026-04-25",
  pnl: { realized: 184_200, unrealized: 412_800, navStart: 4_120_000, navEnd: 4_304_200 },
  trades: [],            // populated from executionEvents (kind=order_filled, today)
  ideaHitRate: { emitted: 9, filled: 4, pct: 0.444 },
  signalsSummary: [
    { channel: "MOM", count: 4 },
    { channel: "FII", count: 2 },
    { channel: "KW",  count: 2 },
    { channel: "VOL", count: 2 },
    { channel: "THM", count: 2 },
    { channel: "MAN", count: 1 },
  ],
};

export const weeklyPlan: WeeklyPlan = {
  weekNo: "2026-W17",
  summary: { trades: 28, cumPnl: 612_400, themeWinRate: 0.61, bestTheme: "AI-PWR" },
  themeRotation: [
    { code: "AI-PWR",  heatStart: 78, heatEnd: 94, delta: +16 },
    { code: "ROBOT",   heatStart: 70, heatEnd: 82, delta: +12 },
    { code: "PWR-GRD", heatStart: 65, heatEnd: 71, delta:  +6 },
    { code: "HBM-TW",  heatStart: 88, heatEnd: 91, delta:  +3 },
    { code: "DDR5",    heatStart: 72, heatEnd: 64, delta:  -8 },
    { code: "AUTO-EV", heatStart: 60, heatEnd: 51, delta:  -9 },
  ],
  strategyTweaks: [
    { strategyId: "MOMO·v3", change: "themePosPct 12% → 15%",       ts: "2026-04-22T03:11:00Z" },
    { strategyId: "MEAN·v2", change: "下調 dailyPnl floor → -25K",    ts: "2026-04-21T08:02:00Z" },
    { strategyId: "MOMO·v3", change: "AI-PWR 主題 lock state 切 LOCKED", ts: "2026-04-23T01:50:00Z" },
  ],
};
