export type TaiwanStockQuantityUnit = "SHARE" | "LOT";

export const TWSE_BOARD_LOT_SHARES = 1000;
export const TWSE_ODD_LOT_MAX_SHARES = TWSE_BOARD_LOT_SHARES - 1;

export function quantityUnitLabel(unit: TaiwanStockQuantityUnit) {
  return unit === "LOT" ? "整張" : "零股";
}

export function quantityUnitDescription(unit: TaiwanStockQuantityUnit) {
  return unit === "LOT"
    ? "1 張 = 1,000 股"
    : "1 股起買，零股上限 999 股";
}

export function toTaiwanStockShareCount(qty: number, unit: TaiwanStockQuantityUnit) {
  return unit === "LOT" ? qty * TWSE_BOARD_LOT_SHARES : qty;
}

export function estimateTaiwanStockNotional(price: number, qty: number, unit: TaiwanStockQuantityUnit) {
  return price * toTaiwanStockShareCount(qty, unit);
}

export function validateTaiwanStockQuantity(qty: number, unit: TaiwanStockQuantityUnit) {
  if (!Number.isInteger(qty) || qty <= 0) {
    return "數量必須是正整數。";
  }
  if (unit === "SHARE" && qty > TWSE_ODD_LOT_MAX_SHARES) {
    return `零股數量必須介於 1 到 ${TWSE_ODD_LOT_MAX_SHARES} 股；1,000 股以上請切換為整張。`;
  }
  return null;
}

export function formatTwd(value: number) {
  return `NT$${value.toLocaleString("zh-TW", { maximumFractionDigits: 0 })}`;
}
