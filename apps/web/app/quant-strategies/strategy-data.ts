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

export type DisplayStatus = "PASS" | "WATCH" | "FAIL" | null;

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
  displayStatus: DisplayStatus;
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

export const QUANT_STRATEGIES: QuantStrategy[] = [
  {
    id: "cont_liq_v36",
    name: "S1 連續動能流動性策略",
    shortName: "S1",
    role: "F-AUTO KGI SIM 觀察主策略",
    cadence: "每週二 08:30 產生訊號、09:00-09:20 送出 SIM",
    basketSize: "Top 8 台股",
    accent: "gold",
    displayStatus: "WATCH",
    maturity: "Forward observation / KGI SIM only",
    signal:
      "以台股流動性池計算 20 日動能與 5/20 日量能比，做橫斷面 z-score 加總，依市場態勢決定曝險，再挑選前 8 檔送入 KGI SIM。",
    logic: [
      "Universe 來自 Trading Room 公司池，只允許台股四碼股票，排除資料不足或停牌標的。",
      "分數 = z(20 日報酬) + z(5 日均量 / 20 日均量)，用量價同步改善的股票當候選。",
      "用 0050 或市場中位數判斷 regime：risk_on 滿倉、sideways 半倉、risk_off 降到 20%、crisis 不下單。",
      "目前 Trading Room 正式量化只開 S1；其他策略先不放在產品頁，避免使用者誤以為可以執行。",
    ],
    sizing: [
      "你在本頁輸入的 SIM 資金會寫入後端 quant_strategy.subscribe audit log。",
      "S1 runner 產生 basket 時會讀取最新 S1 訂閱資金，依 regime 曝險權重換算每檔目標金額。",
      "下單股數以整張向下取整；若流動性容量超過 ADV 約束，會降股數或標註 capacity warning。",
    ],
    riskControls: [
      "全程 SIM-only，KGI real order path 保持鎖定。",
      "沒有 basket 就不送單；KGI 登入、帳號或 gateway 異常只記 failsafe，不硬下單。",
      "每次訊號、委託與 EOD 報告都寫入 reports/trading_room，/ops/f-auto 可追蹤狀態。",
    ],
    caveats: [
      "S1 目前是觀察窗，不是正式投資建議，不宣稱 L5/L10 或 alpha 已確認。",
      "今天若已錯過週二 08:30/09:00 視窗，新的資金設定會套用到下一次 S1 signal run，除非另開 owner-only catch-up。",
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
      asOf: "2026-06-02",
      status: "KGI SIM 自動送單已啟動；2026-06-02 送出 8 檔觀察單，下次為週二盤前訊號視窗",
      primaryReadout: "資金配置會接到 S1 runner",
      secondaryReadout: "只跑 SIM，不開 real order",
    },
    holdings: [
      { symbol: "2330", name: "台積電", weight: 0.125, price: 2355, note: "示意：實際 basket 由 runner 盤前重算" },
      { symbol: "2454", name: "聯發科", weight: 0.125, price: 1340, note: "示意：實際 basket 由 runner 盤前重算" },
      { symbol: "2317", name: "鴻海", weight: 0.125, price: 172, note: "示意：實際 basket 由 runner 盤前重算" },
      { symbol: "2382", name: "廣達", weight: 0.125, price: 285, note: "示意：實際 basket 由 runner 盤前重算" },
      { symbol: "3711", name: "日月光投控", weight: 0.125, price: 147, note: "示意：實際 basket 由 runner 盤前重算" },
      { symbol: "2308", name: "台達電", weight: 0.125, price: 390, note: "示意：實際 basket 由 runner 盤前重算" },
      { symbol: "3034", name: "聯詠", weight: 0.125, price: 515, note: "示意：實際 basket 由 runner 盤前重算" },
      { symbol: "2603", name: "長榮", weight: 0.125, price: 210, note: "示意：實際 basket 由 runner 盤前重算" },
    ],
    curve: [
      { date: "2025-08", value: 0, drawdown: 0 },
      { date: "2025-09", value: 25.35, drawdown: 0 },
      { date: "2025-10", value: 38.92, drawdown: 0 },
      { date: "2025-11", value: 41.73, drawdown: -3.1 },
      { date: "2025-12", value: 77.2, drawdown: 0 },
      { date: "2026-01", value: 103.02, drawdown: 0 },
      { date: "2026-02", value: 124.97, drawdown: 0 },
      { date: "2026-03", value: 155.46, drawdown: 0 },
      { date: "2026-04", value: 171.22, drawdown: -4.2 },
      { date: "2026-05", value: 190.41, drawdown: -10.51 },
    ],
    bars: [
      { date: "2025-09", value: 25.35 },
      { date: "2025-10", value: 13.57 },
      { date: "2025-11", value: 2.81 },
      { date: "2025-12", value: 35.47 },
      { date: "2026-01", value: 25.82 },
      { date: "2026-02", value: 21.95 },
      { date: "2026-03", value: 30.49 },
      { date: "2026-04", value: 15.76 },
      { date: "2026-05", value: -7.17 },
    ],
  },
];

export function getQuantStrategy(strategyId: string): QuantStrategy | null {
  return QUANT_STRATEGIES.find((strategy) => strategy.id === strategyId) ?? null;
}
