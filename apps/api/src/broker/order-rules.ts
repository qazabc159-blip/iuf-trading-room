/**
 * order-rules.ts — 台股下單能力完整矩陣 T-1 驗證層
 *
 * Source: reports/epic_trading_desk_20260702/ORDER_TYPE_MATRIX_DESIGN_v1.md §4
 * (7 validation rules). Pure functions only — no DB/session access — so the
 * full matrix is deterministically unit-testable. Callers (paper-broker.ts)
 * resolve refPrice (quote_last_close 前收) themselves and pass it in; when
 * unavailable the price-limit rule (§4.4) is skipped, never blocking.
 *
 * Reuses BOARD_LOT_REGULAR / getTickSize from kgi-contract-rules.ts per the
 * design doc's explicit instruction not to duplicate the tick/lot tables.
 * There is no separate odd-lot tick tier today — §4.3 explicitly says to use
 * the board-lot tier for odd-lot prices too until TWSE publishes one
 * (TODO below).
 */

import type {
  OrderCond,
  OrderSession,
  OrderType,
  QuantityUnit,
  TimeInForce
} from "@iuf-trading-room/contracts";
import { toTaiwanStockShareCount } from "@iuf-trading-room/contracts";

import { BOARD_LOT_REGULAR, getTickSize } from "./kgi-contract-rules.js";

// ---------------------------------------------------------------------------
// Error codes — structured, stable strings for HTTP responses / UI mapping.
// Codes named in the design doc are used verbatim; the rest (§4.2/§4.6/§4.7,
// which the design doc left unnamed) follow the same naming convention.
// ---------------------------------------------------------------------------
export type OrderRuleErrorCode =
  | "MARKET_ORDER_TIF_INVALID"
  | "ODD_LOT_SESSION_TIF_INVALID"
  | "PRICE_TICK_INVALID"
  | "PRICE_LIMIT_EXCEEDED"
  | "ODD_LOT_CASH_ONLY"
  | "LOT_QUANTITY_INVALID"
  | "ODD_LOT_QUANTITY_INVALID"
  | "MODIFY_QTY_NOT_REDUCE_ONLY";

export interface OrderRuleViolation {
  code: OrderRuleErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export interface OrderMatrixInput {
  type: OrderType;
  timeInForce: TimeInForce;
  orderCond: OrderCond;
  session: OrderSession;
  quantity: number;
  quantity_unit: QuantityUnit;
  price: number | null;
}

export interface OrderMatrixContext {
  /** quote_last_close 前收. null/undefined => price-limit check (§4.4) skipped. */
  refPrice?: number | null;
}

export interface OrderMatrixValidationResult {
  ok: boolean;
  violations: OrderRuleViolation[];
  /** true when §4.4 (漲跌停) was skipped because refPrice was unavailable. */
  priceLimitSkipped: boolean;
}

const ODD_LOT_SESSIONS = new Set<OrderSession>([
  "intraday_odd",
  "afterhours_odd",
  "afterhours_fixed"
]);

// Float tolerance for tick-grid / percentage-band comparisons. Prices are
// TWD with at most 2 decimal places; 1e-6 comfortably clears fp rounding
// noise without accepting a genuinely-off-grid price.
const EPSILON = 1e-6;

// Round `value` to the nearest multiple of `tick`, then fix to the tick's
// own decimal precision so callers don't see values like 10.099999999999998.
function roundToTick(value: number, tick: number): number {
  const rounded = Math.round(value / tick) * tick;
  const decimals = tick < 1 ? String(tick).split(".")[1]?.length ?? 2 : 0;
  return Number(rounded.toFixed(decimals));
}

// ---------------------------------------------------------------------------
// §4.1 — 市價單 TIF 只能 ioc/fok
// ---------------------------------------------------------------------------
export function checkMarketOrderTif(
  input: Pick<OrderMatrixInput, "type" | "timeInForce">
): OrderRuleViolation | null {
  if (input.type !== "market") return null;
  if (input.timeInForce === "ioc" || input.timeInForce === "fok") return null;
  return {
    code: "MARKET_ORDER_TIF_INVALID",
    message: "市價單僅允許 IOC 或 FOK，禁止 ROD/DAY/GTC",
    details: { type: input.type, timeInForce: input.timeInForce }
  };
}

// ---------------------------------------------------------------------------
// §4.2 — 零股 session × TIF 限制
// ---------------------------------------------------------------------------
export function checkOddLotSessionTif(
  input: Pick<OrderMatrixInput, "session" | "timeInForce">
): OrderRuleViolation | null {
  if (input.session === "afterhours_odd" || input.session === "afterhours_fixed") {
    if (input.timeInForce !== "rod") {
      return {
        code: "ODD_LOT_SESSION_TIF_INVALID",
        message: "盤後零股／盤後定價僅允許 ROD（集合競價）",
        details: { session: input.session, timeInForce: input.timeInForce }
      };
    }
    return null;
  }
  if (input.session === "intraday_odd") {
    if (input.timeInForce === "rod" || input.timeInForce === "ioc" || input.timeInForce === "fok") {
      return null;
    }
    return {
      code: "ODD_LOT_SESSION_TIF_INVALID",
      message: "盤中零股僅允許 ROD/IOC/FOK",
      details: { session: input.session, timeInForce: input.timeInForce }
    };
  }
  return null; // regular session: no odd-lot TIF constraint from this rule.
}

// ---------------------------------------------------------------------------
// §4.3 — tick（升降單位）
// ---------------------------------------------------------------------------
export function checkPriceTick(
  input: Pick<OrderMatrixInput, "type" | "price">
): OrderRuleViolation | null {
  if (input.type !== "limit" || input.price === null) return null;
  const tick = getTickSize(input.price);
  const nearest = roundToTick(input.price, tick);
  if (Math.abs(nearest - input.price) < EPSILON) return null;
  return {
    code: "PRICE_TICK_INVALID",
    message: `限價 ${input.price} 不在合法升降單位 (tick=${tick}) 上`,
    details: { price: input.price, tick, nearestValidPrice: nearest }
  };
}

// ---------------------------------------------------------------------------
// §4.4 — 漲跌停 ±10%
// ---------------------------------------------------------------------------
export function checkPriceLimit(
  input: Pick<OrderMatrixInput, "type" | "price">,
  ctx: OrderMatrixContext
): OrderRuleViolation | null {
  if (input.type !== "limit" || input.price === null) return null;
  const refPrice = ctx.refPrice;
  if (refPrice === null || refPrice === undefined || refPrice <= 0) return null; // skip — no ref price
  const tick = getTickSize(refPrice);
  // Round the ±10% band inward to the nearest legal tick so the reported
  // bounds are themselves valid limit prices (TWSE convention).
  const upperLimit = Math.floor((refPrice * 1.1) / tick) * tick;
  const lowerLimit = Math.ceil((refPrice * 0.9) / tick) * tick;
  if (input.price > upperLimit + EPSILON || input.price < lowerLimit - EPSILON) {
    return {
      code: "PRICE_LIMIT_EXCEEDED",
      message: `限價 ${input.price} 超出漲跌停區間 [${lowerLimit}, ${upperLimit}]`,
      details: { price: input.price, refPrice, lowerLimit, upperLimit }
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// §4.5 — session × orderCond：零股/盤後定價只支援現股
// ---------------------------------------------------------------------------
export function checkSessionOrderCond(
  input: Pick<OrderMatrixInput, "session" | "orderCond">
): OrderRuleViolation | null {
  if (input.session !== "regular" && input.orderCond !== "cash") {
    return {
      code: "ODD_LOT_CASH_ONLY",
      message: "零股／盤後定價僅支援現股，不支援融資／融券／當沖",
      details: { session: input.session, orderCond: input.orderCond }
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// §4.6 — 數量：regular 須整張；零股 session 須 1-999 股
// ---------------------------------------------------------------------------
export function checkQuantity(
  input: Pick<OrderMatrixInput, "session" | "quantity" | "quantity_unit">
): OrderRuleViolation | null {
  const shares = toTaiwanStockShareCount(input.quantity, input.quantity_unit);
  if (!ODD_LOT_SESSIONS.has(input.session)) {
    if (shares % BOARD_LOT_REGULAR !== 0) {
      return {
        code: "LOT_QUANTITY_INVALID",
        message: `整股(${input.session})委託數量須為整張(${BOARD_LOT_REGULAR}股)倍數`,
        details: { shares, session: input.session }
      };
    }
    return null;
  }
  if (shares < 1 || shares >= BOARD_LOT_REGULAR) {
    return {
      code: "ODD_LOT_QUANTITY_INVALID",
      message: `零股／盤後定價委託股數須介於 1-${BOARD_LOT_REGULAR - 1} 股`,
      details: { shares, session: input.session }
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// §4.7 — 改量 reduce-only（驗證函式；cancel/replace 流串接留 T-4 TODO）
// ---------------------------------------------------------------------------
export function validateReduceOnlyModify(
  originalQty: number,
  modifyQty: number
): OrderRuleViolation | null {
  if (modifyQty <= 0) {
    return {
      code: "MODIFY_QTY_NOT_REDUCE_ONLY",
      message: "改量後數量必須大於 0",
      details: { originalQty, modifyQty }
    };
  }
  if (modifyQty >= originalQty) {
    return {
      code: "MODIFY_QTY_NOT_REDUCE_ONLY",
      message: "改量僅能減少，不可增加；如需加量請取消後重新下單",
      details: { originalQty, modifyQty }
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Aggregate — runs §4.1-§4.3 + §4.5-§4.6 (create-time rules); §4.7 is a
// standalone function for the modify flow, not part of create validation.
// ---------------------------------------------------------------------------
export function validateOrderTypeMatrix(
  input: OrderMatrixInput,
  ctx: OrderMatrixContext = {}
): OrderMatrixValidationResult {
  const violations: OrderRuleViolation[] = [];

  const marketTifViolation = checkMarketOrderTif(input);
  if (marketTifViolation) violations.push(marketTifViolation);

  const oddLotTifViolation = checkOddLotSessionTif(input);
  if (oddLotTifViolation) violations.push(oddLotTifViolation);

  const tickViolation = checkPriceTick(input);
  if (tickViolation) violations.push(tickViolation);

  const refPrice = ctx.refPrice ?? null;
  const priceLimitSkipped =
    input.type === "limit" && input.price !== null && (refPrice === null || refPrice <= 0);
  const priceLimitViolation = checkPriceLimit(input, ctx);
  if (priceLimitViolation) violations.push(priceLimitViolation);

  const sessionOrderCondViolation = checkSessionOrderCond(input);
  if (sessionOrderCondViolation) violations.push(sessionOrderCondViolation);

  const quantityViolation = checkQuantity(input);
  if (quantityViolation) violations.push(quantityViolation);

  return { ok: violations.length === 0, violations, priceLimitSkipped };
}
