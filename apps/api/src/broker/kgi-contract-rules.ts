/**
 * kgi-contract-rules.ts — adapter-side inference for fields KGI does NOT expose
 *
 * KGI api.Order.contract() returns 10 attrs (symbol / name / market / category /
 * sub_category / ref_price / bull_limit / bear_limit / day_trade / update_date)
 * but does NOT include board_lot / tick_size / min_qty.
 *
 * Source: brokerport_golden_2026-04-23.md §226
 *   "缺欄位：board_lot / tick_size / min_qty — KGI 沒暴露，Jason 在 BrokerPort 層補常數表"
 *
 * These rules are Taiwan market conventions, NOT KGI SDK values.
 * Update if TWSE/TPEx rule changes (e.g. odd-lot all-day trading expansion).
 */

// ---------------------------------------------------------------------------
// Board lot sizes
// ---------------------------------------------------------------------------

/**
 * Regular lot size for TWSE and TPEx listed stocks.
 * Convention: 1 lot = 1000 shares (一張 = 1000 股).
 * Source: Taiwan Stock Exchange regulations.
 */
export const BOARD_LOT_REGULAR = 1000;

/**
 * Odd-lot trade unit.
 * For symbols where odd_lot=True subscription is used, or trailing "A" suffix in
 * get_position() index (e.g. "00981A").
 * 1 share minimum.
 */
export const BOARD_LOT_ODD = 1;

/**
 * Determine board lot size for a symbol.
 * Odd-lot symbols use the "A" suffix convention in KGI (e.g. "00981A").
 * Regular symbols get 1000-share lots.
 */
export function getBoardLot(symbol: string): number {
  // KGI zero-share / odd-lot position symbols have trailing "A"
  if (symbol.endsWith("A")) return BOARD_LOT_ODD;
  return BOARD_LOT_REGULAR;
}

// ---------------------------------------------------------------------------
// Tick size (升降單位) — TWSE price tier table
// ---------------------------------------------------------------------------

/**
 * TWSE/TPEx tick size table based on stock price.
 * Source: TWSE official tick size schedule (證交所升降單位表).
 * Effective for ordinary stocks (not ETFs — ETFs use 0.001 below 10, same otherwise).
 *
 * Price range         | Tick size
 * --------------------|----------
 * < 10                | 0.01
 * 10 ≤ price < 50     | 0.05
 * 50 ≤ price < 100    | 0.1
 * 100 ≤ price < 500   | 0.5
 * 500 ≤ price < 1000  | 1.0
 * ≥ 1000              | 5.0
 */
export const TICK_SIZE_TIERS: ReadonlyArray<{ minPrice: number; tickSize: number }> = [
  { minPrice: 1000, tickSize: 5.0 },
  { minPrice: 500,  tickSize: 1.0 },
  { minPrice: 100,  tickSize: 0.5 },
  { minPrice: 50,   tickSize: 0.1 },
  { minPrice: 10,   tickSize: 0.05 },
  { minPrice: 0,    tickSize: 0.01 },
] as const;

/**
 * Return the tick size for a given reference price.
 * Uses ref_price from the KGI Contract object.
 *
 * @param refPrice - The reference price (ref_price from KGI Contract)
 * @returns tick size in TWD
 */
export function getTickSize(refPrice: number): number {
  for (const tier of TICK_SIZE_TIERS) {
    if (refPrice >= tier.minPrice) return tier.tickSize;
  }
  // Fallback for price = 0 (suspended / invalid)
  return 0.01;
}

// ---------------------------------------------------------------------------
// Min qty
// ---------------------------------------------------------------------------

/**
 * Minimum order quantity.
 * Regular lots: 1 lot (= 1000 shares via boardLot).
 * Odd-lot symbols: 1 share.
 */
export function getMinQty(symbol: string): number {
  return getBoardLot(symbol) === BOARD_LOT_ODD ? 1 : 1;
  // Both return 1 (minimum unit), but the unit differs — 1 lot vs 1 share.
  // The caller multiplies by getBoardLot() to get actual share count.
}

// ---------------------------------------------------------------------------
// Position type string normalisation
// ---------------------------------------------------------------------------

/**
 * KGI get_position() returns a DataFrame where the "type" column is a composite
 * string: "odd /cash /margin /short" — 4 sub-fields separated by " /".
 *
 * Source: brokerport_golden_2026-04-23.md §176
 *         PHASE0_CLOSE_2026-04-23.md §31 "type='odd /cash /margin /short'"
 *
 * The quantity arrays (quantity_yd / quantity_td / quantity_B / quantity_S)
 * each have 4 elements corresponding to: [odd, cash, margin, short].
 */
export const POSITION_TYPE_LABELS = ["odd", "cash", "margin", "short"] as const;
export type PositionTypeLabel = (typeof POSITION_TYPE_LABELS)[number];

/**
 * Parse the KGI type string and validate it matches the expected format.
 * Returns the 4 sub-field labels in order.
 * Throws if the format is unexpected (future-proofing against KGI SDK changes).
 */
export function parsePositionTypeString(typeStr: string): PositionTypeLabel[] {
  const parts = typeStr.split(" /").map((s) => s.trim()) as PositionTypeLabel[];
  if (parts.length !== 4) {
    throw new Error(
      `KGI position type string has unexpected format: "${typeStr}". ` +
        `Expected "odd /cash /margin /short" (4 parts).`
    );
  }
  return parts;
}

/**
 * Index into a KGI quantity array (quantity_yd / quantity_td / quantity_B / quantity_S)
 * by label.
 *
 * @param arr   - The 4-element quantity array from KGI DataFrame
 * @param label - Which sub-field to extract
 */
export function getQuantityByLabel(
  arr: number[],
  label: PositionTypeLabel
): number {
  const idx = POSITION_TYPE_LABELS.indexOf(label);
  if (idx === -1) throw new Error(`Unknown PositionTypeLabel: ${label}`);
  return arr[idx] ?? 0;
}

// ---------------------------------------------------------------------------
// Market normalisation
// ---------------------------------------------------------------------------

/**
 * Normalise KGI market strings to the IUF canonical form.
 * KGI uses lowercase "tse" / "otc". IUF broker.ts contracts use "TWSE" style.
 */
export function normaliseMarket(kgiMarket: string): string {
  switch (kgiMarket.toLowerCase()) {
    case "tse": return "TWSE";
    case "otc": return "TPEx";
    default:    return kgiMarket.toUpperCase();
  }
}
