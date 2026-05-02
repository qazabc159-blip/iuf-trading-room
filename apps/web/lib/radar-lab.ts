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

function missingApiError(path: string): Error {
  return new Error(`量化研究後端尚未設定：${path}`);
}

function invalidShapeError(path: string): Error {
  return new Error(`量化研究資料格式暫時無法辨識：${path}`);
}

function isArray<T>(value: unknown): value is T[] {
  return Array.isArray(value);
}

async function getApi<T>(path: string, accept?: (value: unknown) => value is T): Promise<T> {
  if (!API_BASE) throw missingApiError(path);

  const response = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    headers: { "x-workspace-slug": WORKSPACE_SLUG },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`${response.status} ${path}`);

  const body = await response.json();
  const data = (body && typeof body === "object" && "data" in body) ? body.data : body;
  if (accept && !accept(data)) throw invalidShapeError(path);
  return data as T;
}

async function postApi<T>(path: string, body: unknown): Promise<T> {
  if (!API_BASE) throw missingApiError(path);

  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", "x-workspace-slug": WORKSPACE_SLUG },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${response.status} ${path}`);

  const payload = await response.json();
  return ((payload && typeof payload === "object" && "data" in payload) ? payload.data : payload) as T;
}

export const labDisplay = {
  producer: {
    QUANT_LAB: "量化研究",
    OPERATOR: "操作員",
    OPENALICE: "AI 內容管線",
  } satisfies Record<LabProducer, string>,
  status: {
    NEW: "待審",
    APPROVED: "已核准",
    REJECTED: "已退回",
    PUSHED: "已送出",
  } satisfies Record<LabBundleStatus, string>,
};

export const radarLabApi = {
  bundles: () => getApi<LabSignalBundle[]>("/api/v1/lab/bundles", isArray),
  bundle: (bundleId: string) =>
    getApi<LabSignalBundle | null>(`/api/v1/lab/bundles/${encodeURIComponent(bundleId)}`),
  bundleAction: (bundleId: string, action: LabAction, payload?: unknown) =>
    postApi(`/api/v1/lab/bundles/${encodeURIComponent(bundleId)}/action`, { action, payload }),
};
