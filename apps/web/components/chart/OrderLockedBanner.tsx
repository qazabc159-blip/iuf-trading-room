"use client";
/**
 * OrderLockedBanner — [LOCKED] 下單功能未啟用 · Read-only 模式
 * Ported from sandbox v0.7.0-w3
 * Wording locked: DO NOT change without Elva + 楊董 approval
 */

export function OrderLockedBanner() {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: "7px 14px",
      background: "rgba(212,168,81,0.07)",
      borderBottom: "1px solid rgba(212,168,81,0.22)",
      fontFamily: "var(--mono)",
      fontSize: 10.5,
      letterSpacing: "0.14em",
      color: "var(--gold-bright)",
    }}>
      <span style={{ fontWeight: 700 }}>[LOCKED]</span>
      <span style={{ color: "var(--night-mid)" }}>
        下單功能未啟用 · Read-only 模式
      </span>
    </div>
  );
}
