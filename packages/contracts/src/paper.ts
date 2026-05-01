// W6 Paper Sprint — paper order contracts.
//
// These types describe the paper execution path ONLY.
// No KGI broker types. No live execution types.
// All routes under /api/v1/paper/* use these schemas.

import { z } from "zod";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const paperOrderStatusSchema = z.enum([
  "PENDING",
  "ACCEPTED",
  "FILLED",
  "REJECTED",
  "CANCELLED"
]);
export type PaperOrderStatus = z.infer<typeof paperOrderStatusSchema>;

export const paperOrderSideSchema = z.enum(["buy", "sell"]);
export type PaperOrderSide = z.infer<typeof paperOrderSideSchema>;

export const paperOrderTypeSchema = z.enum(["market", "limit", "stop", "stop_limit"]);
export type PaperOrderType = z.infer<typeof paperOrderTypeSchema>;

/**
 * quantity_unit distinguishes board-lot (整股) from odd-lot (零股) orders.
 *
 * LOT  — 1 lot = 1,000 shares (TWSE board lot). Default for all existing orders.
 * SHARE — 1 share unit; valid range 1–999 for Taiwan odd-lot session.
 *
 * The API and ledger are quantity-unit-aware. The arithmetic path is unit-agnostic
 * (qty=1 SHARE fills 1 share, qty=1 LOT fills at 1-lot scale).
 * Risk engine computes effectiveShares = qty * (unit === "LOT" ? 1000 : 1).
 */
export const quantityUnitSchema = z.enum(["SHARE", "LOT"]);
export type QuantityUnit = z.infer<typeof quantityUnitSchema>;

// ---------------------------------------------------------------------------
// Paper order — request schema (POST /api/v1/paper/orders)
// ---------------------------------------------------------------------------

export const paperOrderCreateInputSchema = z.object({
  idempotencyKey: z.string().min(1, "idempotencyKey must not be empty"),
  symbol: z.string().min(1),
  side: paperOrderSideSchema,
  orderType: paperOrderTypeSchema,
  qty: z.number().int().positive(),
  quantity_unit: quantityUnitSchema.optional().default("LOT"),
  price: z.number().positive().nullable().optional()
});
export type PaperOrderCreateInput = z.infer<typeof paperOrderCreateInputSchema>;

// ---------------------------------------------------------------------------
// Paper order — response schema
// ---------------------------------------------------------------------------

export const paperOrderSchema = z.object({
  id: z.string().uuid(),
  idempotencyKey: z.string(),
  symbol: z.string(),
  side: paperOrderSideSchema,
  orderType: paperOrderTypeSchema,
  qty: z.number().int().positive(),
  quantity_unit: quantityUnitSchema.default("LOT"),
  price: z.number().nullable(),
  status: paperOrderStatusSchema,
  reason: z.string().nullable(),
  userId: z.string().uuid(),
  intentId: z.string().uuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});
export type PaperOrder = z.infer<typeof paperOrderSchema>;

// ---------------------------------------------------------------------------
// Paper fill
// ---------------------------------------------------------------------------

export const paperFillSchema = z.object({
  id: z.string().uuid(),
  orderId: z.string().uuid(),
  fillQty: z.number().int().positive(),
  fillPrice: z.number().positive(),
  fillTime: z.string().datetime(),
  simulatedAt: z.string().datetime()
});
export type PaperFill = z.infer<typeof paperFillSchema>;

// ---------------------------------------------------------------------------
// Paper position
// ---------------------------------------------------------------------------

export const paperPositionSchema = z.object({
  userId: z.string().uuid(),
  symbol: z.string(),
  qty: z.number().int(),
  avgCost: z.number().nullable(),
  lastUpdated: z.string().datetime()
});
export type PaperPosition = z.infer<typeof paperPositionSchema>;

// ---------------------------------------------------------------------------
// Execution flags snapshot (GET /api/v1/paper/flags)
// ---------------------------------------------------------------------------

export const executionModeSchema = z.enum(["disabled", "paper", "live"]);
export type ExecutionMode = z.infer<typeof executionModeSchema>;

export const executionFlagSnapshotSchema = z.object({
  executionMode: executionModeSchema,
  killSwitchEnabled: z.boolean(),
  paperModeEnabled: z.boolean()
});
export type ExecutionFlagSnapshot = z.infer<typeof executionFlagSnapshotSchema>;

// ---------------------------------------------------------------------------
// Gate rejection response
// ---------------------------------------------------------------------------

export const paperGateRejectionSchema = z.object({
  error: z.literal("paper_gate_blocked"),
  reason: z.string(),
  layer: z.enum(["execution_mode", "kill_switch", "paper_mode"])
});
export type PaperGateRejection = z.infer<typeof paperGateRejectionSchema>;
