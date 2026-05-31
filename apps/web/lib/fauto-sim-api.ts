/**
 * F-AUTO SIM API helpers
 * Consumes KGI SIM + S1 pipeline endpoints for the /ops/f-auto panel.
 *
 * Endpoints covered:
 *   GET /api/v1/kgi/status                       — full KGI connection state (Owner)
 *   GET /api/v1/paper/positions?source=sim        — KGI SIM reconstructed positions
 *   GET /api/v1/paper/funds?source=sim            — KGI SIM reconstructed balance
 *   GET /api/v1/kgi/sim/positions                 — raw KGI SIM positions (Owner)
 *   GET /api/v1/kgi/sim/orders                    — KGI SIM order history (Owner)
 *   GET /api/v1/kgi/sim/balance                   — KGI SIM derived balance (Owner)
 *   GET /api/v1/internal/kgi/sim/daily-smoke-status  — 7-day smoke history (Owner)
 *   GET /api/v1/internal/s1-sim/status            — S1 pipeline summary (Owner, Jason pending)
 *   GET /api/v1/internal/s1-sim/eod-report?date=  — S1 EOD report (Owner, Jason pending)
 *   GET /api/v1/internal/s1-sim/basket?date=      — S1 basket (Owner, Jason pending)
 */

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  (process.env.NODE_ENV === "production" ? "" : "http://localhost:3001");

const WORKSPACE_SLUG =
  process.env.NEXT_PUBLIC_DEFAULT_WORKSPACE_SLUG ?? "primary-desk";

// ─── shared fetch helper ──────────────────────────────────────────────────────

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

async function apiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
  if (!API_BASE) return { ok: false, status: 503, error: "API_BASE_UNCONFIGURED" };

  const cookie = await ssrCookieHeader();
  try {
    const res = await fetch(`${API_BASE}${path}`, {
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

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, status: res.status, error: text || `HTTP ${res.status}` };
    }

    const json = (await res.json()) as { data?: T } | T;
    const data =
      json !== null &&
      typeof json === "object" &&
      "data" in (json as object)
        ? (json as { data: T }).data
        : (json as T);
    return { ok: true, data };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, status: 0, error: msg };
  }
}

// ─── types ────────────────────────────────────────────────────────────────────

export type KgiStatus = {
  kgi_logged_in: boolean;
  account_set: boolean;
  trade_connected: boolean;
  quote_connected: boolean;
  last_sim_order_status?: string | null;
  smoke_results?: {
    quote_smoke?: "pass" | "fail" | "skip" | null;
    trade_smoke?: "pass" | "fail" | "skip" | null;
    last_smoke_at?: string | null;
  } | null;
  fetchedAt?: string;
};

export type SimPosition = {
  symbol: string;
  qty: number;
  avgCost: number | null;
  unrealizedPnl: number | null;
  lastPrice: number | null;
  marketValue: number | null;
  note?: string | null;
};

export type SimFunds = {
  cashBalance: number | null;
  availableFunds: number | null;
  totalMarketValue: number | null;
  totalEquity: number | null;
  currency: string;
  fetchedAt?: string;
  note?: string | null;
};

export type KgiSimRawPosition = {
  symbol: string;
  netQtyShares: number;
  unrealizedPnl: number;
  realizedPnl: number;
  lastPrice: number;
  boardLot: number;
};

export type KgiSimRawOrderItem = {
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

export type KgiSimBalance = {
  totalMarketValue: number | null;
  cashBalance: number | null;
  equity: number | null;
  fetchedAt?: string;
};

export type DailySmokeEntry = {
  date: string;
  status: "pass" | "fail" | "skip" | "pending";
  lastProdBrokerAuditCount?: number;
  note?: string | null;
};

export type DailySmokeHistory = {
  lastRunStatus?: string | null;
  lastRunAt?: string | null;
  lastProdBrokerAuditCount?: number;
  history: DailySmokeEntry[];
};

// S1 pipeline — Jason pending endpoints

export type S1SimStatus = {
  lastSignalDate: string | null;
  lastOrderDate: string | null;
  lastEodDate: string | null;
  regime: string | null;
  exposureWeight: number | null;
  basketSymbols: string[];
  ordersAttempted: number | null;
  ordersAccepted: number | null;
  failsafeNotes: string | null;
};

export type S1BasketItem = {
  symbol: string;
  score: number | null;
  shares: number | null;
  targetNotionalTwd: number | null;
  sizingNote: string | null;
};

export type S1Basket = {
  date: string;
  regime: string | null;
  exposureWeight: number | null;
  items: S1BasketItem[];
};

export type S1EodPositionRow = {
  symbol: string;
  shares: number;
  avgCost: number | null;
  lastPrice: number | null;
  unrealizedPnlTwd: number | null;
};

export type S1EodReport = {
  date: string;
  regime: string | null;
  totalUnrealizedPnlTwd: number | null;
  totalMarketValueTwd: number | null;
  cashResidual: number | null;
  dataSource: string | null;
  failsafeNotes: string | null;
  positions: S1EodPositionRow[];
};

// ─── API functions ─────────────────────────────────────────────────────────────

/** GET /api/v1/kgi/status — full KGI connection state (Owner-only) */
export async function getKgiStatus() {
  return apiFetch<KgiStatus>("/api/v1/kgi/status");
}

/** GET /api/v1/paper/positions?source=sim — KGI SIM reconstructed positions */
export async function getSimPositions() {
  return apiFetch<SimPosition[]>("/api/v1/paper/positions?source=sim");
}

/** GET /api/v1/paper/funds?source=sim — KGI SIM reconstructed balance */
export async function getSimFunds() {
  return apiFetch<SimFunds>("/api/v1/paper/funds?source=sim");
}

/** GET /api/v1/kgi/sim/positions — raw KGI positions from gateway (Owner-only) */
export async function getKgiSimRawPositions() {
  return apiFetch<KgiSimRawPosition[]>("/api/v1/kgi/sim/positions");
}

/** GET /api/v1/kgi/sim/orders — KGI SIM order history (Owner-only) */
export async function getKgiSimOrders() {
  return apiFetch<KgiSimRawOrderItem[]>("/api/v1/kgi/sim/orders");
}

/** GET /api/v1/kgi/sim/balance — derived balance from positions (Owner-only) */
export async function getKgiSimBalance() {
  return apiFetch<KgiSimBalance>("/api/v1/kgi/sim/balance");
}

/** GET /api/v1/internal/kgi/sim/daily-smoke-status — 7-day smoke ring buffer (Owner-only) */
export async function getDailySmokeHistory() {
  return apiFetch<DailySmokeHistory>("/api/v1/internal/kgi/sim/daily-smoke-status");
}

/** GET /api/v1/internal/s1-sim/status — S1 pipeline summary (Owner-only, Jason pending) */
export async function getS1SimStatus() {
  return apiFetch<S1SimStatus>("/api/v1/internal/s1-sim/status");
}

/** GET /api/v1/internal/s1-sim/eod-report?date= — S1 EOD report (Owner-only, Jason pending) */
export async function getS1SimEodReport(date: string) {
  return apiFetch<S1EodReport>(
    `/api/v1/internal/s1-sim/eod-report?date=${encodeURIComponent(date)}`,
  );
}

/** GET /api/v1/internal/s1-sim/basket?date= — S1 basket (Owner-only, Jason pending) */
export async function getS1SimBasket(date: string) {
  return apiFetch<S1Basket>(
    `/api/v1/internal/s1-sim/basket?date=${encodeURIComponent(date)}`,
  );
}

// ─── display helpers ───────────────────────────────────────────────────────────

export function fmtTwd(value: number | null | undefined): string {
  if (value == null) return "--";
  return value.toLocaleString("zh-TW", {
    style: "currency",
    currency: "TWD",
    maximumFractionDigits: 0,
  });
}

export function fmtPct(value: number | null | undefined): string {
  if (value == null) return "--";
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
}

export function fmtDatetime(iso: string | null | undefined): string {
  if (!iso) return "--";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("zh-TW", {
    timeZone: "Asia/Taipei",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
