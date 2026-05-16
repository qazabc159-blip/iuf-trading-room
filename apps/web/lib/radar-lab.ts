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

// =============================================================================
// Lab sanctioned strategy snapshot — read-only consume
// =============================================================================
// Source endpoint: GET /api/v1/lab/strategies (alias) or /api/v1/lab/strategy-snapshot
// Backed by lab-strategy-consumer.ts which reads sanctioned lab JSON.
//
// Per Lab/TR alignment lock 2026-05-07:
//  - All candidates are RESEARCH_ONLY; no Sharpe / equity / win-rate / allocation %
//  - status verbatim from lab JSON (TR must NEVER rename / soften)
//  - blocked state when source='unavailable' → display 「目前無 Lab approved 策略可推廣」
// =============================================================================

export type LabStrategyCandidate = {
  strategyId: string;
  displayName: string;
  status: string;
  displayStatus?: "PASS" | "WATCH" | "FAIL" | null;
  researchOnlyFlag: "RESEARCH_ONLY";
  disclaimer: string;
  caveats: string[];
  labGovernanceSource: string;
  nextAction: string;
};

export type LabSanctionedSnapshot = {
  sanctioned: true;
  sourcePath: string;
  sprintId: string;
  collectedAt: string;
  researchOnly: true;
  portfolioVerdict: string;
  candidates: LabStrategyCandidate[];
  strongCandidateCount: number;
};

export type LabStrategiesResponse = {
  data: LabSanctionedSnapshot | null;
  meta: {
    source: "lab_sanctioned" | "unavailable";
    sprintId?: string;
    collectedAt?: string;
    candidateCount?: number;
    researchOnly?: boolean;
    note?: string;
    reason?: string;
    labGovernancePath?: string;
    labTrAlignmentLock?: string;
  };
};

// Variant of getApi that returns full envelope (data + meta) — needed for
// /lab/strategies because meta.source distinguishes lab_sanctioned vs unavailable.
async function getApiEnvelope<T>(path: string): Promise<T> {
  if (!API_BASE) throw missingApiError(path);

  const cookie = await ssrCookieHeader();
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    headers: {
      "x-workspace-slug": WORKSPACE_SLUG,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`${response.status} ${path}`);

  return (await response.json()) as T;
}

function missingApiError(path: string): Error {
  return new Error(`量化研究資料服務尚未設定：${path}`);
}

function invalidShapeError(path: string): Error {
  return new Error(`量化研究資料格式暫時無法辨識：${path}`);
}

function isArray<T>(value: unknown): value is T[] {
  return Array.isArray(value);
}

async function ssrCookieHeader(): Promise<string | null> {
  if (typeof window !== "undefined") return null;

  try {
    const { headers } = await import("next/headers");
    const h = await headers();
    return h.get("cookie");
  } catch {
    return null;
  }
}

async function getApi<T>(path: string, accept?: (value: unknown) => value is T): Promise<T> {
  if (!API_BASE) throw missingApiError(path);

  const cookie = await ssrCookieHeader();
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    headers: {
      "x-workspace-slug": WORKSPACE_SLUG,
      ...(cookie ? { Cookie: cookie } : {}),
    },
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

  const cookie = await ssrCookieHeader();
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "x-workspace-slug": WORKSPACE_SLUG,
      ...(cookie ? { Cookie: cookie } : {}),
    },
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
    PUSHED: "已交接",
  } satisfies Record<LabBundleStatus, string>,
};

export const radarLabApi = {
  bundles: () => getApi<LabSignalBundle[]>("/api/v1/lab/bundles", isArray),
  bundle: (bundleId: string) =>
    getApi<LabSignalBundle | null>(`/api/v1/lab/bundles/${encodeURIComponent(bundleId)}`),
  bundleAction: (bundleId: string, action: LabAction, payload?: unknown) =>
    postApi(`/api/v1/lab/bundles/${encodeURIComponent(bundleId)}/action`, { action, payload }),
  strategies: () => getApiEnvelope<LabStrategiesResponse>("/api/v1/lab/strategies"),
};

// Lab status enum → Trading Room display wording.
// TR v1 is SIM-only; upstream live-like lab states must not render as broker readiness.
export function labStatusDisplayWording(status: string): string {
  const map: Record<string, string> = {
    STRONG_CANDIDATE: "研究候選 / 未進交易流程",
    STRATEGY2_RS2060_CONFIRMED: "研究候選 / 未進交易流程",
    STRATEGY3_TURNOVER_REPAIRED: "研究候選 / 未進交易流程",
    RESEARCH_SYSTEM: "研究系統 / 未進交易流程",
    BACKTESTED_RAW: "原始研究",
    KILL_NO_EDGE: "研究退場 / 無優勢",
    KILL_INFORMATIVE: "研究退場 / 僅供參考",
    PAPER_PROPOSED: "紙上候選 / 待驗證",
    PAPER_LIVE: "SIM 驗證中 / 非正式交易",
    LIVE_CANDIDATE: "正式券商寫入關閉 / 待風控驗收",
    IN_LIVE: "正式券商寫入關閉 / TR 不執行",
    RETIRED: "退役",
    NO_APPROVED_STRATEGY: "目前沒有可推進策略",
    PROBATION: "試察期",
    LIBRARY_ONLY: "函式庫元件 / 非獨立策略",
    FALLBACK_NOT_USED: "備援（未啟用）",
    META_ALLOCATOR_RESEARCH_LEAD_NEEDS_APPEND: "研究領先 / 需補充資料",
    HOLD: "暫停 / 無當前 edge",
  };
  return map[status] ?? "研究狀態待整理";
}
