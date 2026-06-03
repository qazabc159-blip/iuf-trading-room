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
 *   GET /api/v1/internal/s1-sim/status            — S1 pipeline summary (Owner)
 *   GET /api/v1/internal/s1-sim/eod-report?date=  — S1 EOD report (Owner)
 *   GET /api/v1/internal/s1-sim/basket?date=      — S1 basket (Owner)
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
  const method = (init?.method ?? "GET").toUpperCase();
  const browserProxyUrl =
    typeof window !== "undefined" && method === "GET"
      ? `/api/ui-final-v031/backend?path=${encodeURIComponent(path)}`
      : null;
  const url = browserProxyUrl ?? (API_BASE ? `${API_BASE}${path}` : null);
  if (!url) return { ok: false, status: 503, error: "API_BASE_UNCONFIGURED" };

  const cookie = await ssrCookieHeader();
  try {
    const requestInit = {
      credentials: "include",
      cache: "no-store",
      ...init,
      headers: {
        "Content-Type": "application/json",
        "x-workspace-slug": WORKSPACE_SLUG,
        ...(cookie ? { Cookie: cookie } : {}),
        ...(init?.headers ?? {}),
      },
    } satisfies RequestInit;

    let res = await fetch(url, requestInit);
    if (
      browserProxyUrl &&
      API_BASE &&
      method === "GET" &&
      (res.status === 401 || res.status === 403)
    ) {
      res = await fetch(`${API_BASE}${path}`, requestInit);
    }

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
  raw_trade_connected?: boolean;
  raw_quote_connected?: boolean;
  gateway_quote_auth?: {
    available: boolean | null;
    state: string | null;
    errorCode: string | null;
    subscribedTickCount: number | null;
    kgiLoggedIn: boolean | null;
    accountSet: boolean | null;
  } | null;
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

type PaperSimPositionRaw = {
  symbol?: string;
  quantity?: number | null;
  qty?: number | null;
  avgPrice?: number | null;
  avgCost?: number | null;
  marketPrice?: number | null;
  lastPrice?: number | null;
  marketValue?: number | null;
  unrealizedPnl?: number | null;
  note?: string | null;
};

type PaperSimFundsRaw = {
  cash?: number | null;
  cashBalance?: number | null;
  availableCash?: number | null;
  availableFunds?: number | null;
  marketValue?: number | null;
  totalMarketValue?: number | null;
  equity?: number | null;
  totalEquity?: number | null;
  currency?: string | null;
  updatedAt?: string | null;
  fetchedAt?: string | null;
  note?: string | null;
};

type KgiSimOrdersRaw =
  | KgiSimRawOrderItem[]
  | {
      orders?: Array<Partial<KgiSimRawOrderItem> & {
        action?: string | null;
        qty?: number | null;
        quantity?: number | null;
        submitted_at?: string | null;
        trade_id?: string | null;
      }>;
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

// S1 pipeline — read-only observation endpoints

export type S1SimStatus = {
  asOf: string | null;
  todayTst: string | null;
  automaticScheduler: {
    enabled: boolean;
    mode: string | null;
    signalWindowTst: string | null;
    orderSubmitWindowTst: string | null;
    eodWindowTst: string | null;
    pollIntervalMs: number | null;
    signalCatchupBeforeOrder: boolean;
    manualTriggerRole: string | null;
  };
  lastSignalDate: string | null;
  lastOrderDate: string | null;
  lastEodDate: string | null;
  regime: string | null;
  exposureWeight: number | null;
  basketSymbols: string[];
  latestBasketSize: number | null;
  latestBasketGeneratedAt: string | null;
  ordersAttempted: number | null;
  ordersAccepted: number | null;
  ordersRejected: number | null;
  signalWindowOpen: boolean;
  orderSubmitWindowOpen: boolean;
  eodWindowOpen: boolean;
  gatewayUrlConfigured: boolean;
  configuredCapitalTwd: number | null;
  capitalSource: string | null;
  capitalSubscriptionId: string | null;
  capitalSubscriptionCreatedAt: string | null;
  eodPositionCount: number | null;
  eodDataSource: string | null;
  eodMarketValueTwd: number | null;
  eodUnrealizedPnlTwd: number | null;
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
  found: boolean;
  date: string;
  regime: string | null;
  exposureWeight: number | null;
  items: S1BasketItem[];
  generatedAtTst: string | null;
  universeCount: number | null;
  failsafeNotes: string | null;
};

export type S1EodPositionRow = {
  symbol: string;
  shares: number;
  avgCost: number | null;
  lastPrice: number | null;
  unrealizedPnlTwd: number | null;
};

export type S1EodReport = {
  found: boolean;
  date: string;
  regime: string | null;
  generatedAtTst: string | null;
  totalUnrealizedPnlTwd: number | null;
  totalMarketValueTwd: number | null;
  cashResidual: number | null;
  dataSource: string | null;
  failsafeNotes: string | null;
  positions: S1EodPositionRow[];
};

type S1StatusRaw = {
  sim_only?: boolean;
  prod_write_blocked?: boolean;
  as_of?: string;
  today_tst?: string;
  windows?: {
    signal_open?: boolean;
    order_submit_open?: boolean;
    eod_open?: boolean;
  };
  automatic_scheduler?: {
    enabled?: boolean;
    mode?: string | null;
    signal_window_tst?: string | null;
    order_submit_window_tst?: string | null;
    eod_window_tst?: string | null;
    poll_interval_ms?: number | null;
    signal_catchup_before_order?: boolean;
    manual_trigger_role?: string | null;
  };
  gateway_url_configured?: boolean;
  configured_capital_twd?: number | null;
  capital_source?: string | null;
  capital_subscription_id?: string | null;
  capital_subscription_created_at?: string | null;
  latest_basket?: {
    date?: string | null;
    regime?: string | null;
    exposure_weight?: number | null;
    basket_size?: number | null;
    generated_at_tst?: string | null;
  } | null;
  today_orders?: {
    submitted_at_tst?: string | null;
    orders_attempted?: number | null;
    orders_accepted?: number | null;
    orders_rejected?: number | null;
  } | null;
  today_eod?: {
    generated_at_tst?: string | null;
    total_unrealized_pnl_twd?: number | null;
    total_market_value_twd?: number | null;
    position_count?: number | null;
    data_source?: string | null;
  } | null;
};

type S1BasketRaw = {
  schema?: string;
  generated_at_tst?: string;
  signal_date?: string;
  regime?: string;
  exposure_weight?: number;
  basket?: Array<{
    symbol?: string;
    score_cont_liq?: number | null;
    target_shares?: number | null;
    target_notional_twd?: number | null;
    sizing_note?: string | null;
  }>;
  universe_count?: number;
  failsafe_notes?: string[];
};

type S1BasketResponseRaw = {
  sim_only?: boolean;
  prod_write_blocked?: boolean;
  date: string;
  found: boolean;
  basket: S1BasketRaw | null;
};

type S1EodResponseRaw = {
  sim_only?: boolean;
  prod_write_blocked?: boolean;
  date: string;
  found: boolean;
  report: {
    trading_date?: string;
    generated_at_tst?: string;
    positions?: Array<{
      symbol?: string;
      shares?: number;
      avg_cost?: number | null;
      last_price?: number | null;
      unrealized_pnl_twd?: number | null;
    }>;
    total_unrealized_pnl_twd?: number | null;
    total_market_value_twd?: number | null;
    cash_residual_estimated_twd?: number | null;
    data_source?: string | null;
    notes?: string[];
  } | null;
};

// ─── API functions ─────────────────────────────────────────────────────────────

/** GET /api/v1/kgi/status — full KGI connection state (Owner-only) */
export async function getKgiStatus() {
  return apiFetch<KgiStatus>("/api/v1/kgi/status");
}

/** GET /api/v1/paper/positions?source=sim — KGI SIM reconstructed positions */
export async function getSimPositions() {
  const result = await apiFetch<PaperSimPositionRaw[]>("/api/v1/paper/positions?source=sim");
  if (!result.ok) return result;
  return {
    ok: true as const,
    data: (Array.isArray(result.data) ? result.data : []).map((row) => ({
      symbol: row.symbol ?? "--",
      qty: Number(row.qty ?? row.quantity ?? 0),
      avgCost: row.avgCost ?? row.avgPrice ?? null,
      unrealizedPnl: row.unrealizedPnl ?? null,
      lastPrice: row.lastPrice ?? row.marketPrice ?? null,
      marketValue: row.marketValue ?? null,
      note: row.note ?? null,
    } satisfies SimPosition)),
  };
}

/** GET /api/v1/paper/funds?source=sim — KGI SIM reconstructed balance */
export async function getSimFunds() {
  const result = await apiFetch<PaperSimFundsRaw>("/api/v1/paper/funds?source=sim");
  if (!result.ok) return result;
  const row = result.data ?? {};
  return {
    ok: true as const,
    data: {
      cashBalance: row.cashBalance ?? row.cash ?? null,
      availableFunds: row.availableFunds ?? row.availableCash ?? null,
      totalMarketValue: row.totalMarketValue ?? row.marketValue ?? null,
      totalEquity: row.totalEquity ?? row.equity ?? null,
      currency: row.currency ?? "TWD",
      fetchedAt: row.fetchedAt ?? row.updatedAt ?? undefined,
      note: row.note ?? null,
    } satisfies SimFunds,
  };
}

/** GET /api/v1/kgi/sim/positions — raw KGI positions from gateway (Owner-only) */
export async function getKgiSimRawPositions() {
  return apiFetch<KgiSimRawPosition[]>("/api/v1/kgi/sim/positions");
}

/** GET /api/v1/kgi/sim/orders — KGI SIM order history (Owner-only) */
export async function getKgiSimOrders() {
  const result = await apiFetch<KgiSimOrdersRaw>("/api/v1/kgi/sim/orders");
  if (!result.ok) return result;
  const rows = (Array.isArray(result.data) ? result.data : (result.data.orders ?? [])) as Array<
    Partial<KgiSimRawOrderItem> & {
      action?: string | null;
      quantity?: number | null;
      submitted_at?: string | null;
      trade_id?: string | null;
    }
  >;
  return {
    ok: true as const,
    data: rows.map((row, index) => {
      const sideRaw = String(row.side ?? row.action ?? "").toLowerCase();
      const side: "buy" | "sell" = sideRaw.includes("sell") || sideRaw.includes("short") ? "sell" : "buy";
      const qty = Number(row.qty ?? row.quantity ?? row.effectiveQtyShares ?? 0);
      return {
        tradeId: row.tradeId ?? row.trade_id ?? `kgi-sim-order-${index}`,
        status: String(row.status ?? "unknown"),
        symbol: String(row.symbol ?? "--"),
        side,
        qty,
        quantityUnit: row.quantityUnit === "LOT" ? "LOT" : "SHARE",
        effectiveQtyShares: Number(row.effectiveQtyShares ?? qty),
        price: row.price ?? null,
        orderType: row.orderType === "limit" ? "limit" : "market",
        isOddLot: row.isOddLot === true,
        submittedAt: row.submittedAt ?? row.submitted_at ?? "",
      } satisfies KgiSimRawOrderItem;
    }),
  };
}

/** GET /api/v1/kgi/sim/balance — derived balance from positions (Owner-only) */
export async function getKgiSimBalance() {
  return apiFetch<KgiSimBalance>("/api/v1/kgi/sim/balance");
}

/** GET /api/v1/internal/kgi/sim/daily-smoke-status — 7-day smoke ring buffer (Owner-only) */
export async function getDailySmokeHistory() {
  return apiFetch<DailySmokeHistory>("/api/v1/internal/kgi/sim/daily-smoke-status");
}

/** GET /api/v1/internal/s1-sim/status — S1 pipeline summary (Owner-only) */
export async function getS1SimStatus() {
  const result = await apiFetch<S1StatusRaw>("/api/v1/internal/s1-sim/status");
  if (!result.ok) return result;
  const raw = result.data;
  const latestBasket = raw.latest_basket ?? null;
  const todayOrders = raw.today_orders ?? null;
  const todayEod = raw.today_eod ?? null;
  return {
    ok: true as const,
    data: {
      asOf: raw.as_of ?? null,
      todayTst: raw.today_tst ?? null,
      automaticScheduler: {
        enabled: raw.automatic_scheduler?.enabled === true,
        mode: raw.automatic_scheduler?.mode ?? null,
        signalWindowTst: raw.automatic_scheduler?.signal_window_tst ?? null,
        orderSubmitWindowTst: raw.automatic_scheduler?.order_submit_window_tst ?? null,
        eodWindowTst: raw.automatic_scheduler?.eod_window_tst ?? null,
        pollIntervalMs: raw.automatic_scheduler?.poll_interval_ms ?? null,
        signalCatchupBeforeOrder: raw.automatic_scheduler?.signal_catchup_before_order === true,
        manualTriggerRole: raw.automatic_scheduler?.manual_trigger_role ?? null,
      },
      lastSignalDate: latestBasket?.date ?? null,
      lastOrderDate: todayOrders?.submitted_at_tst ?? null,
      lastEodDate: todayEod?.generated_at_tst ?? null,
      regime: latestBasket?.regime ?? null,
      exposureWeight: latestBasket?.exposure_weight ?? null,
      basketSymbols: [],
      latestBasketSize: latestBasket?.basket_size ?? null,
      latestBasketGeneratedAt: latestBasket?.generated_at_tst ?? null,
      ordersAttempted: todayOrders?.orders_attempted ?? null,
      ordersAccepted: todayOrders?.orders_accepted ?? null,
      ordersRejected: todayOrders?.orders_rejected ?? null,
      signalWindowOpen: raw.windows?.signal_open === true,
      orderSubmitWindowOpen: raw.windows?.order_submit_open === true,
      eodWindowOpen: raw.windows?.eod_open === true,
      gatewayUrlConfigured: raw.gateway_url_configured === true,
      configuredCapitalTwd: raw.configured_capital_twd ?? null,
      capitalSource: raw.capital_source ?? null,
      capitalSubscriptionId: raw.capital_subscription_id ?? null,
      capitalSubscriptionCreatedAt: raw.capital_subscription_created_at ?? null,
      eodPositionCount: todayEod?.position_count ?? null,
      eodDataSource: todayEod?.data_source ?? null,
      eodMarketValueTwd: todayEod?.total_market_value_twd ?? null,
      eodUnrealizedPnlTwd: todayEod?.total_unrealized_pnl_twd ?? null,
      failsafeNotes: null,
    } satisfies S1SimStatus,
  };
}

/** GET /api/v1/internal/s1-sim/eod-report?date= — S1 EOD report (Owner-only) */
export async function getS1SimEodReport(date: string) {
  const result = await apiFetch<S1EodResponseRaw>(
    `/api/v1/internal/s1-sim/eod-report?date=${encodeURIComponent(date)}`,
  );
  if (!result.ok) return result;
  const raw = result.data;
  const report = raw.report;
  return {
    ok: true as const,
    data: {
      found: raw.found === true && report !== null,
      date: report?.trading_date ?? raw.date,
      regime: null,
      generatedAtTst: report?.generated_at_tst ?? null,
      totalUnrealizedPnlTwd: report?.total_unrealized_pnl_twd ?? null,
      totalMarketValueTwd: report?.total_market_value_twd ?? null,
      cashResidual: report?.cash_residual_estimated_twd ?? null,
      dataSource: report?.data_source ?? null,
      failsafeNotes: report?.notes?.join(" / ") ?? null,
      positions: (report?.positions ?? []).map((pos) => ({
        symbol: pos.symbol ?? "--",
        shares: pos.shares ?? 0,
        avgCost: pos.avg_cost ?? null,
        lastPrice: pos.last_price ?? null,
        unrealizedPnlTwd: pos.unrealized_pnl_twd ?? null,
      })),
    } satisfies S1EodReport,
  };
}

/** GET /api/v1/internal/s1-sim/basket?date= — S1 basket (Owner-only) */
export async function getS1SimBasket(date: string) {
  const result = await apiFetch<S1BasketResponseRaw>(
    `/api/v1/internal/s1-sim/basket?date=${encodeURIComponent(date)}`,
  );
  if (!result.ok) return result;
  const raw = result.data;
  const basket = raw.basket;
  return {
    ok: true as const,
    data: {
      found: raw.found === true && basket !== null,
      date: basket?.signal_date ?? raw.date,
      regime: basket?.regime ?? null,
      exposureWeight: basket?.exposure_weight ?? null,
      generatedAtTst: basket?.generated_at_tst ?? null,
      universeCount: basket?.universe_count ?? null,
      failsafeNotes: basket?.failsafe_notes?.join(" / ") ?? null,
      items: (basket?.basket ?? []).map((item) => ({
        symbol: item.symbol ?? "--",
        score: item.score_cont_liq ?? null,
        shares: item.target_shares ?? null,
        targetNotionalTwd: item.target_notional_twd ?? null,
        sizingNote: item.sizing_note ?? null,
      })),
    } satisfies S1Basket,
  };
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
