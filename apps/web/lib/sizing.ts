import type { PositionSizingRule } from "@iuf-trading-room/contracts";

// TWSE round lots are 1000 shares. Anything below that becomes a 零股 odd-lot
// order which the paper broker doesn't model — round down so we always stay
// inside the trader's risk envelope.
export const DEFAULT_LOT_SIZE = 1000;

export type SizingInput = {
  equity: number | null;
  sizing: PositionSizingRule;
  entryPrice: number | null;
  stopLoss: number | null;
  lotSize?: number;
};

export type SizingResult = {
  // Final lot-rounded share count, or null when inputs are insufficient.
  qty: number | null;
  // Pre-cap qty before maxPositionPct clamp — null when not computed.
  rawQty: number | null;
  // True when maxPositionPct cap pulled rawQty down.
  cappedByMaxPosition: boolean;
  // Rationale string for UI display ("risk 1% / equity 10M / stop dist 12 → 833").
  reason: string;
  // Set when we couldn't compute (missing inputs, zero stop distance).
  blocker: string | null;
};

const EMPTY: SizingResult = {
  qty: null,
  rawQty: null,
  cappedByMaxPosition: false,
  reason: "",
  blocker: null
};

function floorToLot(value: number, lot: number): number {
  if (lot <= 1) return Math.floor(value);
  return Math.floor(value / lot) * lot;
}

export function computeSizedQuantity(input: SizingInput): SizingResult {
  const lot = input.lotSize ?? DEFAULT_LOT_SIZE;
  const { sizing, equity, entryPrice, stopLoss } = input;

  if (sizing.mode === "fixed_qty") {
    if (sizing.qty === null || sizing.qty <= 0) {
      return { ...EMPTY, blocker: "計畫未設定固定張數" };
    }
    return {
      ...EMPTY,
      qty: sizing.qty,
      rawQty: sizing.qty,
      reason: `固定 ${sizing.qty.toLocaleString()} 股`
    };
  }

  if (equity === null || equity <= 0) {
    return { ...EMPTY, blocker: "等待帳戶權益載入" };
  }
  if (entryPrice === null || entryPrice <= 0) {
    return { ...EMPTY, blocker: "計畫未設定 entry price" };
  }

  let rawQty: number;
  let reason: string;

  if (sizing.mode === "risk_per_trade") {
    if (stopLoss === null || stopLoss <= 0) {
      return { ...EMPTY, blocker: "風險模式需要 stop loss" };
    }
    const riskPerShare = Math.abs(entryPrice - stopLoss);
    if (riskPerShare === 0) {
      return { ...EMPTY, blocker: "entry 與 stop 相同無風險距離" };
    }
    const cashAtRisk = (equity * sizing.pct) / 100;
    rawQty = cashAtRisk / riskPerShare;
    reason =
      `風險 ${sizing.pct}% · 權益 ${formatCurrency(equity)} · ` +
      `停損距離 ${riskPerShare.toFixed(2)} → ${Math.floor(rawQty).toLocaleString()} 股`;
  } else {
    // fixed_pct
    const notional = (equity * sizing.pct) / 100;
    rawQty = notional / entryPrice;
    reason =
      `部位 ${sizing.pct}% 權益 · 名目 ${formatCurrency(notional)} · ` +
      `entry ${entryPrice} → ${Math.floor(rawQty).toLocaleString()} 股`;
  }

  const maxNotional = (equity * sizing.maxPositionPct) / 100;
  const maxQtyByCap = maxNotional / entryPrice;
  const cappedByMax = rawQty > maxQtyByCap;
  const finalRaw = cappedByMax ? maxQtyByCap : rawQty;

  const qty = floorToLot(finalRaw, lot);
  if (qty <= 0) {
    return {
      ...EMPTY,
      rawQty: Math.max(0, Math.floor(rawQty)),
      reason,
      blocker: `計算張數小於最小單位 ${lot} 股`
    };
  }

  return {
    qty,
    rawQty: Math.floor(rawQty),
    cappedByMaxPosition: cappedByMax,
    reason,
    blocker: null
  };
}

function formatCurrency(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toFixed(0);
}
