import type {
  PaperOrderCreateInput,
  PreviewOrderResult,
} from "@iuf-trading-room/contracts";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL
  ?? (process.env.NODE_ENV === "production" ? "" : "http://localhost:3001");
const WORKSPACE_SLUG = process.env.NEXT_PUBLIC_DEFAULT_WORKSPACE_SLUG ?? "primary-desk";

// PaperOrderInput is the form-facing type (no idempotencyKey — added by withIdempotency).
// quantity_unit is REQUIRED — no silent default. Caller must specify SHARE or LOT explicitly.
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

export type PaperOrderCancelResult = {
  data: PaperOrderState;
  alreadyTerminal: boolean;
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (!API_BASE) {
    throw new PaperOrderApiError(503, { error: "API_BASE_UNCONFIGURED" }, "PAPER_ORDER_API_BASE_UNCONFIGURED");
  }

  const response = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    cache: "no-store",
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-workspace-slug": WORKSPACE_SLUG,
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
  return request<PreviewOrderResult>("/api/v1/paper/orders/preview", {
    method: "POST",
    body: JSON.stringify(withIdempotency(input, "preview", idempotencyKey)),
  });
}

export async function submitPaperOrder(input: PaperOrderInput, idempotencyKey?: string) {
  if (!API_BASE) {
    throw new PaperOrderApiError(503, { error: "API_BASE_UNCONFIGURED" }, "PAPER_ORDER_API_BASE_UNCONFIGURED");
  }

  const body = withIdempotency(input, "submit", idempotencyKey);
  const response = await fetch(`${API_BASE}/api/v1/paper/orders`, {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "x-workspace-slug": WORKSPACE_SLUG,
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

export async function cancelPaperOrder(orderId: string, reason = "operator cancelled from frontend") {
  if (!API_BASE) {
    throw new PaperOrderApiError(503, { error: "API_BASE_UNCONFIGURED" }, "PAPER_ORDER_API_BASE_UNCONFIGURED");
  }

  const response = await fetch(`${API_BASE}/api/v1/paper/orders/${encodeURIComponent(orderId)}/cancel`, {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "x-workspace-slug": WORKSPACE_SLUG,
    },
    body: JSON.stringify({ reason }),
  });
  const json = await readJson(response);
  if (!response.ok) {
    throw new PaperOrderApiError(response.status, json, "PAPER_ORDER_CANCEL_FAILED");
  }
  return json as PaperOrderCancelResult;
}

export function formatPaperOrderError(error: unknown) {
  if (error instanceof PaperOrderApiError) {
    const layer = error.layer ? ` layer=${error.layer}` : "";
    return `${error.code} (${error.status}${layer})`;
  }
  return error instanceof Error ? error.message : String(error);
}
