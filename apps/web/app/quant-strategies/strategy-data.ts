export type StrategyHolding = {
  symbol: string;
  name?: string;
  weight: number;
  price: number;
  note: string;
};

export type StrategyCurvePoint = {
  date: string;
  value: number;
  drawdown?: number;
  periodReturn?: number;
};

export type QuantStrategy = {
  id: string;
  name: string;
  shortName: string;
  role: string;
  cadence: string;
  basketSize: string;
  accent: "gold" | "cyan" | "green";
  maturity: string;
  signal: string;
  logic: string[];
  sizing: string[];
  riskControls: string[];
  caveats: string[];
  metrics: {
    netReturnPct: number;
    benchmarkPct?: number;
    excessPct?: number;
    strictOosPct?: number;
    sharpe: number | null;
    sharpeLabel?: string;
    maxDrawdownPct: number;
    hitRatePct: number;
    sampleCount: number;
  };
  current: {
    asOf: string;
    status: string;
    primaryReadout: string;
    secondaryReadout: string;
  };
  holdings: StrategyHolding[];
  curve: StrategyCurvePoint[];
  bars: StrategyCurvePoint[];
};

const class5Holdings: StrategyHolding[] = [
  ["5289", 1865, "營收年增加速度第 1 名"],
  ["3006", 238, "營收年增加速度第 2 名"],
  ["2451", 344.5, "營收年增加速度第 3 名"],
  ["2408", 341, "營收年增加速度第 4 名"],
  ["2337", 169, "營收年增加速度第 5 名"],
  ["2344", 134, "營收年增加速度第 6 名"],
  ["2382", 334.5, "營收年增加速度第 7 名"],
  ["2360", 2260, "營收年增加速度第 8 名"],
  ["3450", 422, "營收年增加速度第 9 名"],
  ["5274", 17810, "營收年增加速度第 10 名"],
  ["3443", 5075, "營收年增加速度第 11 名"],
  ["8299", 2880, "營收年增加速度第 12 名"],
  ["2404", 1050, "營收年增加速度第 13 名"],
  ["2383", 4920, "營收年增加速度第 14 名"],
  ["2059", 5010, "營收年增加速度第 15 名"],
  ["1815", 106.5, "營收年增加速度第 16 名"],
  ["2890", 30.5, "營收年增加速度第 17 名"],
  ["5443", 126, "營收年增加速度第 18 名"],
  ["2603", 211.5, "營收年增加速度第 19 名"],
  ["2615", 74.8, "營收年增加速度第 20 名"],
].map(([symbol, price, note]) => ({
  symbol: String(symbol),
  price: Number(price),
  note: String(note),
  weight: 0.05,
}));

export const QUANT_STRATEGIES: QuantStrategy[] = [
  {
    id: "cont_liq_v36",
    name: "流動強勢延續 v36",
    shortName: "cont_liq",
    role: "短週期量價延續",
    cadence: "20 個交易日",
    basketSize: "4 檔等權",
    accent: "gold",
    maturity: "Forward Observation Day 6/20",
    signal: "成交量 5/20 放大 + 20 日相對強度，選前 4 檔並套用流動性門檻。",
    logic: [
      "先排除流動性不足的股票池，再用 volumeRatio5To20 與 trailRet20d 做標準化分數。",
      "只在大盤 regime 過門檻時啟動，避免盤勢太弱時硬做動能延續。",
      "持有 20 個交易日，下一輪重新排序；目前 Period 1 不換股、不追修參數。",
    ],
    sizing: [
      "目前籃子 4 檔等權，資金平均切成 4 份。",
      "SIM 下單預設零股股數，避免整張單位造成資金跳動。",
      "若資金太小導致某檔股數為 0，該檔會自動略過。",
    ],
    riskControls: [
      "籃子 -10% 觸發警示；籃子 -15% 觸發暫停檢查。",
      "單檔風險會標示，但 Period 1 強制線是籃子層級。",
      "不做盤中追價與參數重調。",
    ],
    caveats: [
      "5/14 籃子 -7.17%，未觸發籃子警示；6205 單檔 -15.73% 已物化。",
      "歷史共同窗數字與現在 forward observation 是不同證據層，不混在一起宣告。",
    ],
    metrics: {
      netReturnPct: 400.89,
      benchmarkPct: 95.25,
      excessPct: 305.64,
      sharpe: 3.03,
      maxDrawdownPct: -10.51,
      hitRatePct: 92.31,
      sampleCount: 13,
    },
    current: {
      asOf: "2026-05-14",
      status: "Day 6 / 20",
      primaryReadout: "Period 1 basket -7.17%",
      secondaryReadout: "0050 +0.31%, excess -7.49pp",
    },
    holdings: [
      { symbol: "3707", weight: 0.25, price: 80.0, note: "Day 6 +9.44%" },
      { symbol: "2426", weight: 0.25, price: 66.8, note: "Day 6 -12.34%" },
      { symbol: "6205", weight: 0.25, price: 79.3, note: "Day 6 -15.73%" },
      { symbol: "2486", weight: 0.25, price: 259.0, note: "Day 6 -10.07%" },
    ],
    curve: [
      { date: "2024-05", value: 1.38, drawdown: 0 },
      { date: "2024-06", value: 25.04, drawdown: 0 },
      { date: "2025-05", value: 11.9, drawdown: -10.51 },
      { date: "2025-06", value: 25.47, drawdown: 0 },
      { date: "2025-07", value: 60.97, drawdown: 0 },
      { date: "2025-08", value: 49.1, drawdown: -7.37 },
      { date: "2025-09", value: 80.08, drawdown: 0 },
      { date: "2025-10", value: 96.7, drawdown: 0 },
      { date: "2025-11", value: 96.8, drawdown: 0 },
      { date: "2025-12", value: 114.3, drawdown: 0 },
      { date: "2026-01", value: 136.63, drawdown: 0 },
      { date: "2026-02", value: 185.53, drawdown: 0 },
      { date: "2026-03", value: 222.02, drawdown: 0 },
    ],
    bars: [
      { date: "2025-08", value: 2.53 },
      { date: "2025-09", value: 25.35 },
      { date: "2025-10", value: 13.57 },
      { date: "2025-11", value: 2.81 },
      { date: "2025-12", value: 35.47 },
      { date: "2026-01", value: 25.82 },
      { date: "2026-02", value: 21.95 },
      { date: "2026-03", value: 30.49 },
    ],
  },
  {
    id: "class5_revenue_momentum",
    name: "月營收加速度",
    shortName: "Class5",
    role: "基本面月頻動能",
    cadence: "每月營收發布後",
    basketSize: "20 檔等權",
    accent: "cyan",
    maturity: "Research Candidate / PIT repair",
    signal: "用月營收年增率加速度排序，抓營收動能突然抬升的股票。",
    logic: [
      "使用 FinMind 月營收資料建立事件面板，固定選 revenue_yoy_acceleration 前 20 名。",
      "持有 20 個交易日；成本採 120bps；訓練、驗證、嚴格 OOS 分段紀錄。",
      "MOPS 官方 API 已可抓 20/20 候選，但 issuer-level 發布時間戳仍待 PIT 嚴格補強。",
    ],
    sizing: [
      "20 檔等權，單檔 5%。",
      "高價股可能讓小資金配置出現 0 股；SIM 面板會清楚列出被略過的檔。",
      "適合做第二主策略，頻率低於 cont_liq，來源也不同。",
    ],
    riskControls: [
      "sector top share 觀察；最新候選 top sector share 40%。",
      "未補 PIT 前不做嚴格統計宣告，但可進 SIM 觀察。",
      "每月只重算一次，降低換手與資料噪音。",
    ],
    caveats: [
      "歷史結果強，但正式 Phase 0 仍卡在 issuer-level 發布時間戳。",
      "5/14 已抓 20/20 anchor close，forward observation 可以從 SIM 層先跑。",
    ],
    metrics: {
      netReturnPct: 303.73,
      excessPct: 45.91,
      strictOosPct: 104.51,
      sharpe: 3.37,
      maxDrawdownPct: -18.49,
      hitRatePct: 86.67,
      sampleCount: 15,
    },
    current: {
      asOf: "2026-05-14",
      status: "20/20 anchor captured",
      primaryReadout: "Latest period 2026-04",
      secondaryReadout: "Rule: revenue_yoy_acceleration Top20",
    },
    holdings: class5Holdings,
    curve: [
      { date: "2025-02", value: 2.79, drawdown: 0 },
      { date: "2025-03", value: -8.78, drawdown: -11.26 },
      { date: "2025-04", value: -16.22, drawdown: -18.49 },
      { date: "2025-05", value: -9.61, drawdown: -12.06 },
      { date: "2025-06", value: 3.09, drawdown: 0 },
      { date: "2025-07", value: 14.14, drawdown: 0 },
      { date: "2025-08", value: 28.09, drawdown: 0 },
      { date: "2025-09", value: 44.0, drawdown: 0 },
      { date: "2025-10", value: 60.49, drawdown: 0 },
      { date: "2025-11", value: 65.3, drawdown: 0 },
      { date: "2025-12", value: 97.42, drawdown: 0 },
      { date: "2026-01", value: 140.17, drawdown: 0 },
      { date: "2026-02", value: 184.05, drawdown: 0 },
      { date: "2026-03", value: 214.03, drawdown: 0 },
      { date: "2026-04", value: 303.73, drawdown: 0 },
    ],
    bars: [
      { date: "2025-09", value: 12.42 },
      { date: "2025-10", value: 11.45 },
      { date: "2025-11", value: 3.0 },
      { date: "2025-12", value: 19.43 },
      { date: "2026-01", value: 21.65 },
      { date: "2026-02", value: 18.27 },
      { date: "2026-03", value: 10.56 },
      { date: "2026-04", value: 28.57 },
    ],
  },
  {
    id: "family_c_sbl_overlay",
    name: "TDCC 籌碼分散 × SBL Overlay",
    shortName: "Family C",
    role: "籌碼結構 + 借券風險",
    cadence: "每週資料",
    basketSize: "目前 6/20 anchor",
    accent: "green",
    maturity: "Overlay Candidate",
    signal: "挑低 Tier HHI 的持股結構，再用 SBL 風險分數壓掉借券壓力較高的標的。",
    logic: [
      "TDCC 集保分級資料建立散戶/大戶結構，低 Tier HHI 代表持股結構較分散。",
      "SBL flow-to-ADV 風險特徵作為 overlay，不把它當 standalone alpha。",
      "目前只有 6 個歷史 feature dates，因此定位是第三策略備選與風險分散來源。",
    ],
    sizing: [
      "目標 20 檔等權；目前 5/14 anchor 只抓到 6 檔真實收盤。",
      "SIM 面板會以目前可得 6 檔先試跑，等 20/20 補齊再自動換成完整籃子。",
      "不與 cont_liq 共用訊號核心，相關性接近 0。",
    ],
    riskControls: [
      "feature-date count 未達 12 前不做主策略宣告。",
      "leave-one-date-out 仍脆弱，必須持續擴歷史樣本。",
      "SBL overlay 只做風險調整，不直接作為唯一買進理由。",
    ],
    caveats: [
      "目前資料完整度低於 Class5；適合先做 SIM 觀察，不適合當唯一主線。",
      "5/14 anchor 只有 6/20，等隔日 FinMind/TWSE 補齊。",
    ],
    metrics: {
      netReturnPct: 11.94,
      excessPct: 2.2,
      sharpe: null,
      sharpeLabel: "待 12+ feature dates",
      maxDrawdownPct: -0.02,
      hitRatePct: 60.0,
      sampleCount: 5,
    },
    current: {
      asOf: "2026-05-14",
      status: "6/20 anchor",
      primaryReadout: "Incremental excess +13.97pp vs baseline",
      secondaryReadout: "leave-one-out min excess -0.93pp",
    },
    holdings: [
      { symbol: "3118", weight: 1 / 6, price: 33.85, note: "Family C anchor rank 4" },
      { symbol: "1558", weight: 1 / 6, price: 90.5, note: "Family C anchor rank 9" },
      { symbol: "1591", weight: 1 / 6, price: 52.7, note: "Family C anchor rank 11" },
      { symbol: "3325", weight: 1 / 6, price: 12.05, note: "Family C anchor rank 12" },
      { symbol: "6164", weight: 1 / 6, price: 11.85, note: "Family C anchor rank 13" },
      { symbol: "3095", weight: 1 / 6, price: 44.4, note: "Family C anchor rank 15" },
    ],
    curve: [
      { date: "2024-02", value: -2.85, drawdown: -2.85 },
      { date: "2024-10", value: 0.22, drawdown: 0 },
      { date: "2025-01", value: 0.03, drawdown: -0.19 },
      { date: "2025-04", value: 1.14, drawdown: 0 },
      { date: "2025-10", value: 2.2, drawdown: 0 },
    ],
    bars: [
      { date: "2024-02", value: -2.85 },
      { date: "2024-10", value: 3.16 },
      { date: "2025-01", value: -0.19 },
      { date: "2025-04", value: 1.11 },
      { date: "2025-10", value: 1.05 },
    ],
  },
];

export function getQuantStrategy(id: string) {
  return QUANT_STRATEGIES.find((strategy) => strategy.id === id) ?? null;
}

