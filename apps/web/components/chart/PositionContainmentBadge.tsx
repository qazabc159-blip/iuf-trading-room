"use client";
/**
 * PositionContainmentBadge — 持倉資料目前不可用（containment 模式）
 * Ported from sandbox v0.7.0-w3
 * Wording locked: DO NOT change without Elva + 楊董 approval
 */

export function PositionContainmentBadge() {
  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      gap: 2,
      padding: "8px 14px",
      borderTop: "1px solid var(--night-rule-strong)",
      fontFamily: "var(--mono)",
    }}>
      <div style={{
        fontSize: 10,
        letterSpacing: "0.14em",
        color: "var(--gold)",
        fontWeight: 700,
      }}>
        持倉資料目前不可用（containment 模式）
      </div>
      <div style={{
        fontSize: 9,
        letterSpacing: "0.10em",
        color: "var(--night-mid)",
      }}>
        請至 KGI 平台查詢
      </div>
    </div>
  );
}
