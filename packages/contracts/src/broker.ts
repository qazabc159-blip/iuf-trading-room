import { z } from "zod";

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
  timestamp: z.string()
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
