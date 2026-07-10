// uta-order-vocab.ts — pure label/derivation helpers for the
// /admin/uta/accounts OrdersTable (extracted out of page.tsx so the JSX-free
// logic is directly unit-testable; this repo's vitest config only picks up
// *.test.ts, not *.tsx).
//
// Bug context (Pete #1206 review, fixed 2026-07-10): the OrdersTable used to
// read UnifiedOrderEntry.side/quantity/simOnly, none of which exist on the
// real backend record (apps/api/src/broker/unified-order-store.ts
// UnifiedOrderRecord uses action/qty, and has no per-row sim flag at all) —
// leaving 方向/數量/安全模式 blank in prod. sideLabel() below now reads the
// real `action: "Buy" | "Sell"` field. isKnownSimOnlyAdapter() replaces the
// phantom simOnly boolean: POST /api/v1/uta/orders' zod schema (server.ts)
// only ever accepts adapterKey "kgi" | "paper", and both are hard-locked to
// SIM/paper at the trading-service layer (CLAUDE.md 🔴 真金下單路徑) — so
// "安全模式" is derived from the real adapterKey field, not fabricated
// per-row data.

export function sideLabel(action: string): string {
  if (action === "Buy") return "買進";
  if (action === "Sell") return "賣出";
  return action;
}

export function isKnownSimOnlyAdapter(adapterKey: string): boolean {
  return adapterKey === "kgi" || adapterKey === "paper";
}

export function safetyModeLabel(simOnly: boolean): string {
  return simOnly ? "SIM" : "待確認";
}
