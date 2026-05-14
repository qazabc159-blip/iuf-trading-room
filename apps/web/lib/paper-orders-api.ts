import type {
  PaperOrderCreateInput,
  PreviewOrderResult,
} from "@iuf-trading-room/contracts";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL
  ?? (process.env.NODE_ENV === "production" ? "" : "http://localhost:3001");
const WORKSPACE_SLUG = process.env.NEXT_PUBLIC_DEFAULT_WORKSPACE_SLUG ?? "primary-desk";

// PaperOrderInput is the form-facing type (no idempotencyKey ??added by withIdempotency).
// quantity_unit is REQUIRED ??no silent default. Caller must specify SHARE or LOT explicitly.
export type PaperOrderInput = Omit<PaperOrderCreateInput, "idempotencyKey"> & {
  quantity_unit: "LOT" | "SHARE";
};

export type PaperOrderStatus =
  | "PENDING"
  | "ACCEPTED"
  | "FILLED"
  | "REJECTED"
  | "CANCELLED";

export type PaperOrderIntent = {
  id: string;
  idempotencyKey: string;
  symbol: string;
  side: "buy" | "sell";
  orderType: "market" | "limit" | "stop" | "stop_limit";
  qty: number;
  quantity_unit: "SHARE" | "LOT";
  price: number | null;
  userId: string;
  status: PaperOrderStatus;
  reason: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PaperFill = {
  fillQty: number;
  fillPrice: number;
  fillTime: string;
};

export type PaperOrderState = {
  intent: PaperOrderIntent;
  fill: PaperFill | null;
};

export type PaperPortfolioPosition = {
  symbol: string;
  netQtyShares: number;
  avgCostPerShare: number | null;
  fillCount: number;
  note: string | null;
};

export type PaperFillLedgerRow = {
  orderId: string;
  symbol: string;
  side: "buy" | "sell";
  orderType: "market" | "limit" | "stop" | "stop_limit";
  qty: number;
  quantity_unit: "SHARE" | "LOT";
  fillQty: number;
  fillPrice: number;
  fillTime: string;
};

export type PaperOrderCancelResult = {
  data: PaperOrderState;
  alreadyTerminal: boolean;
};

export type PaperHealthState = {
  previewReady: boolean;
  submitReady: boolean;
  fillsReady: boolean;
  portfolioReady: boolean;
  lastFillTs: string | null;
  queueDepth: number;
  gate: {
    executionMode: string;
    executionModeOk: boolean;
    killSwitchOk: boolean;
    paperModeOk: boolean;
    gateOpen: boolean;
  };
  persistence: {
    mode: string;
    tableExists: boolean;
    dbError: string | null;
  };
  paper_orders_500_root_cause_closed?: boolean;
};

type Envelope<T> = { data: T };

type ApiErrorBody =
  | { error?: string; reason?: string; layer?: string; details?: unknown; idempotencyKey?: string }
  | { data?: unknown }
  | null;

export class PaperOrderApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly layer?: string;
  readonly details?: unknown;

  constructor(status: number, body: ApiErrorBody, fallback: string) {
    const record = body && typeof body === "object" ? body as Record<string, unknown> : {};
    const code = typeof record.error === "string" ? record.error : fallback;
    const reason = typeof record.reason === "string" ? record.reason : undefined;
    super(reason ? `${code}: ${reason}` : `${code} (${status})`);
    this.name = "PaperOrderApiError";
    this.status = status;
    this.code = code;
    this.layer = typeof record.layer === "string" ? record.layer : undefined;
    this.details = record.details;
  }
}

function makeIdempotencyKey(prefix: "preview" | "submit") {
  const uuid =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${uuid}`;
}

async function readJson(response: Response): Promise<ApiErrorBody> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as ApiErrorBody;
  } catch {
    return { error: text };
  }
}

async function ssrCookieHeader() {
  if (typeof window !== "undefined") return null;

  try {
    const { headers } = await import("next/headers");
    const h = await headers();
    return h.get("cookie");
  } catch {
    return null;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (!API_BASE) {
    throw new PaperOrderApiError(503, { error: "API_BASE_UNCONFIGURED" }, "PAPER_ORDER_API_BASE_UNCONFIGURED");
  }

  const cookie = await ssrCookieHeader();
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    cache: "no-store",
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-workspace-slug": WORKSPACE_SLUG,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(init?.headers ?? {}),
    },
  });

  const body = await readJson(response);
  if (!response.ok) {
    throw new PaperOrderApiError(response.status, body, "PAPER_ORDER_REQUEST_FAILED");
  }

  return ((body && typeof body === "object" && "data" in body ? (body as Envelope<T>).data : body) ?? null) as T;
}

function withIdempotency(
  input: PaperOrderInput,
  prefix: "preview" | "submit",
  overrideKey?: string,
): PaperOrderCreateInput {
  return {
    ...input,
    symbol: input.symbol.trim().toUpperCase(),
    quantity_unit: input.quantity_unit,
    price: input.orderType === "market" ? null : input.price ?? null,
    idempotencyKey: overrideKey ?? makeIdempotencyKey(prefix),
  };
}

export function isTerminalPaperOrder(status: PaperOrderStatus) {
  return status === "FILLED" || status === "REJECTED" || status === "CANCELLED";
}

export function isCancellablePaperOrder(status: PaperOrderStatus) {
  return status === "PENDING" || status === "ACCEPTED";
}

export async function previewPaperOrder(input: PaperOrderInput, idempotencyKey?: string) {
  return request<PreviewOrderResult>("/api/v1/paper/preview", {
    method: "POST",
    body: JSON.stringify(withIdempotency(input, "preview", idempotencyKey)),
  });
}

export async function getPaperHealth() {
  return request<PaperHealthState>("/api/v1/paper/health");
}

export async function submitPaperOrder(input: PaperOrderInput, idempotencyKey?: string) {
  if (!API_BASE) {
    throw new PaperOrderApiError(503, { error: "API_BASE_UNCONFIGURED" }, "PAPER_ORDER_API_BASE_UNCONFIGURED");
  }

  const body = withIdempotency(input, "submit", idempotencyKey);
  const cookie = await ssrCookieHeader();
  const response = await fetch(`${API_BASE}/api/v1/paper/submit`, {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "x-workspace-slug": WORKSPACE_SLUG,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });

  const json = await readJson(response);
  if (!response.ok) {
    if (response.status === 422 && json && typeof json === "object" && "data" in json) {
      return (json as Envelope<PaperOrderState>).data;
    }
    throw new PaperOrderApiError(response.status, json, "PAPER_ORDER_SUBMIT_FAILED");
  }
  return (json as Envelope<PaperOrderState>).data;
}

export async function getPaperOrder(orderId: string) {
  return request<PaperOrderState>(`/api/v1/paper/orders/${encodeURIComponent(orderId)}`);
}

export async function listPaperOrders(status?: PaperOrderStatus) {
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  return request<PaperOrderState[]>(`/api/v1/paper/orders${query}`);
}

export async function getPaperPortfolio() {
  return request<PaperPortfolioPosition[]>("/api/v1/paper/portfolio");
}

export type PaperPortfolioSummary = {
  baseCapitalTWD: number;
  currency: string;
  simulated: boolean;
  paperMode: boolean;
  positionCount: number;
  investedCostTWD: number;
  note: string;
};

export type PaperPortfolioRawResponse = {
  positions: PaperPortfolioPosition[];
  summary: PaperPortfolioSummary;
};

/** Returns positions + summary (baseCapitalTWD etc.) without envelope unwrapping. */
export async function getPaperPortfolioRaw(): Promise<PaperPortfolioRawResponse> {
  if (!API_BASE) {
    throw new PaperOrderApiError(503, { error: "API_BASE_UNCONFIGURED" }, "PAPER_ORDER_API_BASE_UNCONFIGURED");
  }
  const cookie = await ssrCookieHeader();
  const response = await fetch(`${API_BASE}/api/v1/paper/portfolio`, {
    credentials: "include",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "x-workspace-slug": WORKSPACE_SLUG,
      ...(cookie ? { Cookie: cookie } : {}),
    },
  });
  const body = await readJson(response);
  if (!response.ok) {
    throw new PaperOrderApiError(response.status, body, "PAPER_PORTFOLIO_RAW_FAILED");
  }
  const envelope = body as { data: PaperPortfolioPosition[]; summary: PaperPortfolioSummary };
  return {
    positions: envelope.data ?? [],
    summary: envelope.summary ?? { baseCapitalTWD: 10_000_000, currency: "TWD", simulated: true, paperMode: true, positionCount: 0, investedCostTWD: 0, note: "" },
  };
}

export async function listPaperFills() {
  return request<PaperFillLedgerRow[]>("/api/v1/paper/fills");
}

export async function cancelPaperOrder(orderId: string, reason = "operator_cancelled_from_frontend") {
  if (!API_BASE) {
    throw new PaperOrderApiError(503, { error: "API_BASE_UNCONFIGURED" }, "PAPER_ORDER_API_BASE_UNCONFIGURED");
  }

  const cookie = await ssrCookieHeader();
  const response = await fetch(`${API_BASE}/api/v1/paper/orders/${encodeURIComponent(orderId)}/cancel`, {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "x-workspace-slug": WORKSPACE_SLUG,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify({ reason }),
  });
  const json = await readJson(response);
  if (!response.ok) {
    throw new PaperOrderApiError(response.status, json, "PAPER_ORDER_CANCEL_FAILED");
  }
  return json as PaperOrderCancelResult;
}

// ---------------------------------------------------------------------------
// KGI Live Positions (北極星訴求 #9 — 真實倉位 read-only)
// ---------------------------------------------------------------------------

export type KgiLivePosition = {
  symbol: string;
  netQtyShares: number;
  unrealizedPnl: number;
  realizedPnl: number;
  lastPrice: number;
  boardLot: number;
};

export type KgiPositionsResponse = {
  source: "kgi_live";
  status: "ok" | "gateway_unreachable" | "gateway_not_authenticated" | "gateway_error";
  positions: KgiLivePosition[];
  fetchedAt: string;
  note?: string;
};

export async function getKgiPositions(): Promise<KgiPositionsResponse> {
  // Returns the envelope data directly (never throws on gateway degraded states — those are 200)
  const cookie = await ssrCookieHeader();
  const url = `${API_BASE}/api/v1/portfolio/kgi/positions`;
  const response = await fetch(url, {
    credentials: "include",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "x-workspace-slug": WORKSPACE_SLUG,
      ...(cookie ? { Cookie: cookie } : {}),
    },
  });

  const body = await readJson(response);

  if (!response.ok) {
    // 403 Owner-only — surface as unavailable rather than crashing the page
    if (response.status === 403) {
      return {
        source: "kgi_live",
        status: "gateway_error",
        positions: [],
        fetchedAt: new Date().toISOString(),
        note: "此資訊僅限帳號擁有者檢視。",
      };
    }
    throw new PaperOrderApiError(response.status, body, "KGI_POSITIONS_FAILED");
  }

  const envelope = body as { data: KgiPositionsResponse };
  return envelope.data;
}

// ---------------------------------------------------------------------------
// KGI SIM Order — direct gateway submit (not paper-only DB)
// POST /api/v1/kgi/sim/order
// ---------------------------------------------------------------------------

export type KgiSimOrderPayload = {
  symbol: string;
  side: "buy" | "sell";
  qty: number;
  price?: number | null;
  orderType: "market" | "limit";
  quantityUnit: "SHARE" | "LOT";
};

export type KgiSimOrderResponse = {
  sim_only: true;
  prod_write_blocked: true;
  data: {
    tradeId: string | null;
    status: string;
    symbol: string;
    side: "buy" | "sell";
    qty: number;
    quantityUnit: "SHARE" | "LOT";
    effectiveQtyShares: number;
    price: number | null;
    orderType: "market" | "limit";
    isOddLot: boolean;
    submittedAt: string;
  };
};

export class KgiSimOrderApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "KgiSimOrderApiError";
    this.status = status;
    this.code = code;
  }
}

export async function submitKgiSimOrder(payload: KgiSimOrderPayload): Promise<KgiSimOrderResponse> {
  if (!API_BASE) {
    throw new KgiSimOrderApiError(503, "API_BASE_UNCONFIGURED", "尚未設定資料服務位置。");
  }

  const cookie = await ssrCookieHeader();
  const response = await fetch(`${API_BASE}/api/v1/kgi/sim/order`, {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "x-workspace-slug": WORKSPACE_SLUG,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify({
      symbol: payload.symbol.trim().toUpperCase(),
      side: payload.side,
      qty: payload.qty,
      price: payload.price ?? null,
      orderType: payload.orderType,
      quantityUnit: payload.quantityUnit,
    }),
  });

  const body = await readJson(response);

  if (!response.ok) {
    const record = body && typeof body === "object" ? body as Record<string, unknown> : {};
    const code = typeof record.error === "string" ? record.error : "KGI_SIM_SUBMIT_FAILED";
    const msg = typeof record.message === "string" ? record.message : `HTTP ${response.status}`;
    throw new KgiSimOrderApiError(response.status, code, msg);
  }

  return body as unknown as KgiSimOrderResponse;
}

export function formatKgiSimOrderError(error: unknown): string {
  if (error instanceof KgiSimOrderApiError) {
    if (error.code === "GATEWAY_AUTH_ERROR") return "KGI gateway 尚未登入，請聯絡楊董確認 gateway 連線狀態。";
    if (error.code === "GATEWAY_UNREACHABLE") return "KGI EC2 gateway 無法連線，請確認 gateway 是否已啟動。";
    if (error.code === "NOT_SIM_ENV") return "目前 KGI 環境非 SIM，無法下單；需要 KGI_ENV=sim。";
    if (error.code === "ORDER_NOT_ENABLED") return "KGI gateway /order/create 尚未啟用（409），請聯絡 Jason 確認 gateway 版本。";
    if (error.code === "VALIDATION_ERROR" || error.code === "ORDER_VALIDATION_REJECTED") return `委託欄位驗證失敗：${error.message}`;
    if (error.code === "OWNER_ONLY") return "此功能僅限帳號擁有者使用。";
    if (error.status === 409) return "目前 KGI gateway 連線中，請稍候再試。";
    if (error.status >= 500) return `KGI SIM 服務暫時異常（${error.status}）：${error.message}`;
    return `KGI SIM 委託失敗（${error.code}）：${error.message}`;
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/fetch failed|failed to fetch|ECONNREFUSED|network/i.test(message)) return "KGI gateway 連線失敗，請確認服務狀態。";
  return message.trim() ? `KGI SIM 委託發生錯誤：${message}` : "KGI SIM 委託發生未知錯誤。";
}

export function formatPaperOrderError(error: unknown) {
  if (error instanceof PaperOrderApiError) {
    const layer = error.layer ? ` layer=${error.layer}` : "";
    if (error.code === "API_BASE_UNCONFIGURED") return "尚未設定資料服務位置，無法連線到模擬交易。";
    if (error.code === "paper_gate_blocked") return `模擬交易目前被風控閘門擋下：${error.message}${layer}`;
    if (error.code === "DUPLICATE_IDEMPOTENCY_KEY") return "這張模擬委託已送出過，系統不會重複送單。";
    if (error.code === "VALIDATION_ERROR") return "委託欄位未通過檢查，請確認股票、價格、股數與零股/整張單位。";
    if (error.status === 401) return "登入狀態已失效，請重新登入後再預覽模擬委託。";
    if (error.status === 404) return "模擬交易服務尚未提供這項內容。";
    if (error.status >= 500) return `模擬交易服務暫時異常（${error.status}${layer}）。`;
    return `模擬委託未通過（${error.status}${layer}）：${error.message}`;
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/API_BASE|NEXT_PUBLIC_API_BASE_URL|base url/i.test(message)) return "尚未設定資料服務位置，無法連線到模擬交易。";
  if (/fetch failed|failed to fetch|ECONNREFUSED|network/i.test(message)) return "模擬交易服務連線失敗，請稍後再試。";
  return message.trim() ? `模擬委託發生錯誤：${message}` : "模擬委託發生未知錯誤。";
}
