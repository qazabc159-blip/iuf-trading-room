import { z } from "zod";

import { marketDataDecisionSummaryItemSchema } from "./marketData.js";
import { riskCheckResultSchema } from "./risk.js";

// Broker kind is intentionally narrow and extensible. "paper" is the default
// for Phase 0/1 so the full execution path can be exercised before touching a
// real brokerage account.
export const brokerKindSchema = z.enum(["kgi", "paper", "manual"]);

export const orderSideSchema = z.enum(["buy", "sell"]);

export const orderTypeSchema = z.enum([
  "market",
  "limit",
  "stop",
  "stop_limit"
]);

export const timeInForceSchema = z.enum([
  "day",
  "rod", // rest of day (台股常用)
  "ioc",
  "fok",
  "gtc"
]);

// Order lifecycle — every state the risk engine / reconciliation needs to
// reason about. "acknowledged" means broker accepted the order; "partial"
// covers partial fills; "rejected" is broker-side rejection (not our risk
// guard, which blocks before submission).
export const orderStatusSchema = z.enum([
  "pending",
  "submitted",
  "acknowledged",
  "partial",
  "filled",
  "canceled",
  "rejected",
  "expired"
]);

export const brokerAccountSchema = z.object({
  id: z.string(),
  broker: brokerKindSchema,
  accountNo: z.string(),
  accountName: z.string(),
  currency: z.string().default("TWD"),
  isActive: z.boolean().default(true),
  isPaper: z.boolean().default(false),
  connectedAt: z.string().nullable().default(null)
});

export const balanceSchema = z.object({
  accountId: z.string(),
  currency: z.string().default("TWD"),
  cash: z.number(),
  availableCash: z.number(),
  equity: z.number(),
  marketValue: z.number(),
  unrealizedPnl: z.number(),
  realizedPnlToday: z.number().default(0),
  marginUsed: z.number().default(0),
  updatedAt: z.string()
});

export const positionSchema = z.object({
  accountId: z.string(),
  symbol: z.string(),
  market: z.string().default("TWSE"),
  quantity: z.number(),
  avgPrice: z.number(),
  marketPrice: z.number().nullable(),
  marketValue: z.number().nullable(),
  unrealizedPnl: z.number().nullable(),
  unrealizedPnlPct: z.number().nullable(),
  openedAt: z.string().nullable().default(null),
  companyId: z.string().uuid().nullable().default(null)
});

// Snapshot of the market-data consumer verdict at the instant an order was
// submitted / filled / rejected. We store a compact copy on the order and on
// every execution event so a trader can later answer "what quote did this
// trade actually see?" without replaying the provider timeline.
export const executionQuoteContextSchema = z.object({
  mode: z.enum(["paper", "execution"]),
  decision: z.enum(["allow", "review", "block"]),
  source: z.string().nullable(),
  readiness: z.enum(["ready", "degraded", "blocked"]),
  freshnessStatus: z.enum(["fresh", "stale", "missing"]),
  paperUsable: z.boolean(),
  liveUsable: z.boolean(),
  providerConnected: z.boolean(),
  fallbackReason: z.string(),
  staleReason: z.string(),
  reasons: z.array(z.string()).default([]),
  last: z.number().nullable(),
  bid: z.number().nullable(),
  ask: z.number().nullable(),
  capturedAt: z.string()
});

export const orderSchema = z.object({
  id: z.string(),
  clientOrderId: z.string(),
  brokerOrderId: z.string().nullable(),
  accountId: z.string(),
  broker: brokerKindSchema,
  symbol: z.string(),
  side: orderSideSchema,
  type: orderTypeSchema,
  timeInForce: timeInForceSchema.default("rod"),
  quantity: z.number().positive(),
  filledQuantity: z.number().nonnegative().default(0),
  price: z.number().nullable(),
  stopPrice: z.number().nullable().default(null),
  avgFillPrice: z.number().nullable().default(null),
  status: orderStatusSchema,
  reason: z.string().nullable().default(null),
  // Link back to our domain objects so we can trace every order to the plan /
  // strategy that produced it.
  tradePlanId: z.string().uuid().nullable().default(null),
  strategyId: z.string().uuid().nullable().default(null),
  riskCheckId: z.string().uuid().nullable().default(null),
  submittedAt: z.string().nullable(),
  acknowledgedAt: z.string().nullable().default(null),
  filledAt: z.string().nullable().default(null),
  canceledAt: z.string().nullable().default(null),
  // Quote-feed snapshot captured when the order was submitted. Null for legacy
  // orders restored from snapshots written before this field existed.
  quoteContext: executionQuoteContextSchema.nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const fillSchema = z.object({
  id: z.string(),
  orderId: z.string(),
  clientOrderId: z.string(),
  accountId: z.string(),
  symbol: z.string(),
  side: orderSideSchema,
  quantity: z.number().positive(),
  price: z.number(),
  fee: z.number().nonnegative().default(0),
  tax: z.number().nonnegative().default(0),
  timestamp: z.string(),
  // Quote-feed snapshot at fill time. Nullable because (a) legacy fills from
  // snapshots written before this field existed won't have one, and (b)
  // reconciled fills originating from broker replay may not carry a quote.
  quoteContext: executionQuoteContextSchema.nullable().default(null)
});

export const executionEventSchema = z.object({
  type: z.enum([
    "submit",
    "acknowledge",
    "fill",
    "cancel",
    "reject",
    "expire",
    "reconcile"
  ]),
  orderId: z.string(),
  clientOrderId: z.string(),
  status: orderStatusSchema,
  message: z.string().nullable().default(null),
  payload: z.unknown().nullable().default(null),
  timestamp: z.string()
});

export const brokerConnectionStatusSchema = z.object({
  broker: brokerKindSchema,
  accountId: z.string().nullable(),
  connected: z.boolean(),
  heartbeatAt: z.string().nullable(),
  latencyMs: z.number().int().nonnegative().nullable(),
  lastReconcileAt: z.string().nullable(),
  errorMessage: z.string().nullable().default(null)
});

// Inputs coming from UI / strategy engine — risk engine intercepts these
// before the broker adapter sees them.
export const orderCreateInputSchema = z.object({
  accountId: z.string(),
  symbol: z.string().min(1),
  side: orderSideSchema,
  type: orderTypeSchema.default("limit"),
  timeInForce: timeInForceSchema.default("rod"),
  quantity: z.number().positive(),
  // quantity_unit: paper-layer odd-lot support.
  // LOT  = board lot (1 lot = 1000 shares); default for all existing orders.
  // SHARE = odd-lot (1–999 shares); risk engine computes effectiveShares accordingly.
  // Broker adapters (KGI) must NOT use this field for live orders — they handle
  // lot sizing via their own contract rules.
  quantity_unit: z.enum(["SHARE", "LOT"]).optional().default("LOT"),
  price: z.number().positive().nullable().default(null),
  stopPrice: z.number().positive().nullable().default(null),
  tradePlanId: z.string().uuid().nullable().default(null),
  strategyId: z.string().uuid().nullable().default(null),
  clientOrderId: z.string().optional(),
  // Allows manual operator override of specific guards with an explicit
  // reason. Default is no override.
  overrideGuards: z.array(z.string()).default([]),
  overrideReason: z.string().default("")
});

export const orderCancelInputSchema = z.object({
  orderId: z.string(),
  reason: z.string().default("")
});

export const orderReplaceInputSchema = z.object({
  orderId: z.string(),
  quantity: z.number().positive().optional(),
  price: z.number().positive().nullable().optional(),
  stopPrice: z.number().positive().nullable().optional(),
  reason: z.string().default("")
});

// Gate mode is bound to broker kind: paper accounts use the paper summary,
// live brokers use the execution summary. "manual" / future brokers fold into
// "execution" — the gate never lets real money through the paper branch.
export const executionGateModeSchema = z.enum(["paper", "execution"]);

// Outcome vocabulary for the server-side quote gate. "allow" means the gate
// is green; the four review_* / block / quote_unknown branches describe every
// way a submit can be held or diverted. UI and server both bind to this enum
// so a new state cannot be introduced silently.
export const executionGateDecisionSchema = z.enum([
  "allow",
  "review_accepted",
  "review_required",
  "review_unusable",
  "block",
  "quote_unknown"
]);

// Readiness / freshness are nullable on the gate result only because the
// gate may fail open ("quote_unknown") before it has any decision-summary
// item to read. When an item is present these are always populated.
export const executionQuoteGateResultSchema = z.object({
  mode: executionGateModeSchema,
  decision: executionGateDecisionSchema,
  blocked: z.boolean(),
  reasons: z.array(z.string()).default([]),
  // Flattened view of the decision-summary fields the UI must show. Hoisting
  // them to top level means the contract guarantees their presence even if
  // `item` evolves or is trimmed in a future transport.
  primaryReason: z.string().nullable().default(null),
  fallbackReason: z.string().nullable().default(null),
  staleReason: z.string().nullable().default(null),
  selectedSource: z.string().nullable().default(null),
  readiness: z.enum(["ready", "degraded", "blocked"]).nullable().default(null),
  freshnessStatus: z.enum(["fresh", "stale", "missing"]).nullable().default(null),
  // Full decision-summary item for advanced UIs; nullable because the gate
  // may fail open before reaching the market-data surface.
  item: marketDataDecisionSummaryItemSchema.nullable().default(null),
  quoteContext: executionQuoteContextSchema.nullable().default(null),
  quoteError: z.string().nullable().default(null)
});

// The shape returned by POST /trading/orders and /trading/orders/preview.
// `order` is null whenever the gate or risk engine blocked before a paper
// broker row was produced; `quoteGate` is null only when the risk engine
// hard-blocked before we even reached the quote gate.
export const submitOrderResultSchema = z.object({
  order: orderSchema.nullable(),
  riskCheck: riskCheckResultSchema,
  blocked: z.boolean(),
  quoteGate: executionQuoteGateResultSchema.nullable()
});

// previewOrderResultSchema is the authoritative contract for
// POST /api/v1/paper/orders/preview (and /api/v1/trading/orders/preview).
// Frontend OrderPreview type MUST be derived from this, not hand-written.
// This is identical to submitOrderResultSchema — preview runs the same
// risk+gate pipeline but never commits an order (order is always null).
export const previewOrderResultSchema = submitOrderResultSchema;
export type PreviewOrderResult = z.infer<typeof previewOrderResultSchema>;

export type BrokerKind = z.infer<typeof brokerKindSchema>;
export type OrderSide = z.infer<typeof orderSideSchema>;
export type OrderType = z.infer<typeof orderTypeSchema>;
export type TimeInForce = z.infer<typeof timeInForceSchema>;
export type OrderStatus = z.infer<typeof orderStatusSchema>;
export type BrokerAccount = z.infer<typeof brokerAccountSchema>;
export type Balance = z.infer<typeof balanceSchema>;
export type Position = z.infer<typeof positionSchema>;
export type Order = z.infer<typeof orderSchema>;
export type Fill = z.infer<typeof fillSchema>;
export type ExecutionEvent = z.infer<typeof executionEventSchema>;
export type BrokerConnectionStatus = z.infer<typeof brokerConnectionStatusSchema>;
export type OrderCreateInput = z.infer<typeof orderCreateInputSchema>;
export type OrderCancelInput = z.infer<typeof orderCancelInputSchema>;
export type OrderReplaceInput = z.infer<typeof orderReplaceInputSchema>;
export type ExecutionQuoteContext = z.infer<typeof executionQuoteContextSchema>;
export type ExecutionGateMode = z.infer<typeof executionGateModeSchema>;
export type ExecutionGateDecision = z.infer<typeof executionGateDecisionSchema>;
export type ExecutionQuoteGateResult = z.infer<typeof executionQuoteGateResultSchema>;
export type SubmitOrderResult = z.infer<typeof submitOrderResultSchema>;
