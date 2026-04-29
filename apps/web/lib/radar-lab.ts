const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";
const WORKSPACE_SLUG = process.env.NEXT_PUBLIC_DEFAULT_WORKSPACE_SLUG ?? "primary-desk";

export type LabProducer = "QUANT_LAB" | "OPERATOR" | "OPENALICE";
export type LabBundleStatus = "NEW" | "APPROVED" | "REJECTED" | "PUSHED";

export type LabPeriodStat = {
  label: string;
  trades: number;
  winRate: number;
  returnPct: number;
};

export type LabBacktestPoint = {
  t: string;
  value: number;
};

export type LabSignalBundle = {
  bundleId: string;
  title: string;
  producer: LabProducer;
  status: LabBundleStatus;
  symbol: string;
  themeCode: string;
  confidence: number;
  createdAt: string;
  summary: string;
  backtest: {
    winRate: number;
    maxDrawdownPct: number;
    totalReturnPct: number;
    tradeCount: number;
    periodStats: LabPeriodStat[];
    equityCurve: LabBacktestPoint[];
    drawdown: LabBacktestPoint[];
  };
  promotionMemo: string;
  divergenceNotes: string[];
};

type LabAction = "APPROVE" | "REJECT" | "PUSH_TO_PORTFOLIO" | "DIVERGENCE_FEEDBACK";

async function getMaybe<T>(path: string, fallback: T): Promise<T> {
  if (!API_BASE) return fallback;
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      credentials: "include",
      headers: { "x-workspace-slug": WORKSPACE_SLUG },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`${response.status} ${path}`);
    const body = await response.json();
    return ((body && typeof body === "object" && "data" in body) ? body.data : body) as T;
  } catch (error) {
    console.warn("[radar-lab] mock fallback:", path, error);
    return fallback;
  }
}

async function postMaybe<T>(path: string, body: unknown, fallback: T): Promise<T> {
  if (!API_BASE) return fallback;
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", "x-workspace-slug": WORKSPACE_SLUG },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`${response.status} ${path}`);
    const payload = await response.json();
    return ((payload && typeof payload === "object" && "data" in payload) ? payload.data : payload) as T;
  } catch (error) {
    console.warn("[radar-lab] mock POST fallback:", path, error);
    return fallback;
  }
}

export const mockLabBundles: LabSignalBundle[] = [
  {
    bundleId: "QLAB-20260429-01",
    title: "AI-PWR 盤後延續與 HBM 外資流入",
    producer: "QUANT_LAB",
    status: "NEW",
    symbol: "2330",
    themeCode: "AI-PWR",
    confidence: 0.82,
    createdAt: "2026-04-29T14:32:00+08:00",
    summary: "Athena 偵測 AI-PWR 熱度維持高檔，2330 與 HBM 封裝鏈同步有外資淨買訊號。",
    backtest: {
      winRate: 0.64,
      maxDrawdownPct: -4.8,
      totalReturnPct: 12.4,
      tradeCount: 38,
      periodStats: [
        { label: "20D", trades: 8, winRate: 0.63, returnPct: 3.4 },
        { label: "60D", trades: 17, winRate: 0.65, returnPct: 8.1 },
        { label: "120D", trades: 38, winRate: 0.64, returnPct: 12.4 },
      ],
      equityCurve: [
        { t: "W1", value: 100 }, { t: "W2", value: 102 }, { t: "W3", value: 101.4 },
        { t: "W4", value: 105.2 }, { t: "W5", value: 108.8 }, { t: "W6", value: 112.4 },
      ],
      drawdown: [
        { t: "W1", value: 0 }, { t: "W2", value: -1.2 }, { t: "W3", value: -4.8 },
        { t: "W4", value: -2.1 }, { t: "W5", value: -1.4 }, { t: "W6", value: -0.7 },
      ],
    },
    promotionMemo:
      "建議升級為 operator review：訊號勝率達門檻，回撤仍在風險盒內。不要直接送單，先由 OpenAlice 補足產業敘事，再由 operator 判斷是否帶到下單台。\n\n限制：目前 price source 仍須等 Lane 1 live market data 完整接上，所有推送僅為紙上候選。",
    divergenceNotes: ["外資流入與成交量同向", "法人券商分點未完全同步", "早盤追價風險偏高"],
  },
  {
    bundleId: "QLAB-20260429-02",
    title: "6504 南六量能突破但流動性偏薄",
    producer: "QUANT_LAB",
    status: "APPROVED",
    symbol: "6504",
    themeCode: "PWR-GRD",
    confidence: 0.74,
    createdAt: "2026-04-29T14:20:00+08:00",
    summary: "南六量能突破，PWR-GRD theme score 升溫；但成交厚度不足，建議縮小 sizing。",
    backtest: {
      winRate: 0.58,
      maxDrawdownPct: -6.2,
      totalReturnPct: 7.6,
      tradeCount: 24,
      periodStats: [
        { label: "20D", trades: 5, winRate: 0.6, returnPct: 1.9 },
        { label: "60D", trades: 11, winRate: 0.55, returnPct: 4.2 },
        { label: "120D", trades: 24, winRate: 0.58, returnPct: 7.6 },
      ],
      equityCurve: [
        { t: "W1", value: 100 }, { t: "W2", value: 99.1 }, { t: "W3", value: 103.2 },
        { t: "W4", value: 104.8 }, { t: "W5", value: 102.6 }, { t: "W6", value: 107.6 },
      ],
      drawdown: [
        { t: "W1", value: 0 }, { t: "W2", value: -2.4 }, { t: "W3", value: -1.2 },
        { t: "W4", value: -3.6 }, { t: "W5", value: -6.2 }, { t: "W6", value: -2.8 },
      ],
    },
    promotionMemo: "可以保留在觀察池。若成交量沒有延續，不推到 portfolio；若維持放量，才允許 operator 手動預覽。",
    divergenceNotes: ["量能突破早於價格確認", "bidask depth 偏薄"],
  },
  {
    bundleId: "OA-20260429-07",
    title: "ROBOT 關鍵詞群聚與供應鏈附著",
    producer: "OPENALICE",
    status: "NEW",
    symbol: "4915",
    themeCode: "ROBOT",
    confidence: 0.61,
    createdAt: "2026-04-29T13:58:00+08:00",
    summary: "OpenAlice 將 4915 與 humanoid / actuator 關鍵詞群聚附著到 ROBOT theme。",
    backtest: {
      winRate: 0.52,
      maxDrawdownPct: -8.5,
      totalReturnPct: 2.9,
      tradeCount: 19,
      periodStats: [
        { label: "20D", trades: 4, winRate: 0.5, returnPct: -0.8 },
        { label: "60D", trades: 9, winRate: 0.56, returnPct: 1.2 },
        { label: "120D", trades: 19, winRate: 0.52, returnPct: 2.9 },
      ],
      equityCurve: [
        { t: "W1", value: 100 }, { t: "W2", value: 98.4 }, { t: "W3", value: 101.2 },
        { t: "W4", value: 97.8 }, { t: "W5", value: 103.1 }, { t: "W6", value: 102.9 },
      ],
      drawdown: [
        { t: "W1", value: 0 }, { t: "W2", value: -3.4 }, { t: "W3", value: -1.8 },
        { t: "W4", value: -8.5 }, { t: "W5", value: -2.3 }, { t: "W6", value: -2.7 },
      ],
    },
    promotionMemo: "敘事有效，但統計樣本不足。建議退回 OpenAlice 補來源與關鍵詞證據，不推 portfolio。",
    divergenceNotes: ["敘事強，price confirmation 弱", "樣本數偏少"],
  },
  {
    bundleId: "OP-20260429-03",
    title: "2376 DDR5 轉弱，保留 trim 候選",
    producer: "OPERATOR",
    status: "PUSHED",
    symbol: "2376",
    themeCode: "DDR5",
    confidence: 0.68,
    createdAt: "2026-04-29T13:22:00+08:00",
    summary: "operator 手動標註 DDR5 pulse 轉弱，2376 應只允許 trim，不允許加碼。",
    backtest: {
      winRate: 0.61,
      maxDrawdownPct: -3.9,
      totalReturnPct: 5.2,
      tradeCount: 16,
      periodStats: [
        { label: "20D", trades: 3, winRate: 0.67, returnPct: 1.1 },
        { label: "60D", trades: 7, winRate: 0.57, returnPct: 2.4 },
        { label: "120D", trades: 16, winRate: 0.61, returnPct: 5.2 },
      ],
      equityCurve: [
        { t: "W1", value: 100 }, { t: "W2", value: 101.1 }, { t: "W3", value: 99.8 },
        { t: "W4", value: 102.3 }, { t: "W5", value: 103.7 }, { t: "W6", value: 105.2 },
      ],
      drawdown: [
        { t: "W1", value: 0 }, { t: "W2", value: -0.7 }, { t: "W3", value: -3.9 },
        { t: "W4", value: -1.6 }, { t: "W5", value: -0.9 }, { t: "W6", value: -0.4 },
      ],
    },
    promotionMemo: "這是風險降低訊號，不是做多訊號。推送到 portfolio 時只能預填 TRIM / SELL 類型。",
    divergenceNotes: ["價格弱於 theme", "成交量沒有擴大"],
  },
];

export const labDisplay = {
  producer: {
    QUANT_LAB: "Quant Lab",
    OPERATOR: "Operator",
    OPENALICE: "OpenAlice",
  } satisfies Record<LabProducer, string>,
  status: {
    NEW: "待審",
    APPROVED: "已批准",
    REJECTED: "已駁回",
    PUSHED: "已推送",
  } satisfies Record<LabBundleStatus, string>,
};

export const radarLabApi = {
  bundles: () => getMaybe<LabSignalBundle[]>("/api/v1/lab/bundles", mockLabBundles),
  bundle: (bundleId: string) =>
    getMaybe<LabSignalBundle | null>(
      `/api/v1/lab/bundles/${encodeURIComponent(bundleId)}`,
      mockLabBundles.find((bundle) => bundle.bundleId === bundleId) ?? null,
    ),
  bundleAction: (bundleId: string, action: LabAction, payload?: unknown) =>
    postMaybe(`/api/v1/lab/bundles/${encodeURIComponent(bundleId)}/action`, { action, payload }, { ok: true, bundleId, action }),
};
