"use client";

/**
 * KGI Position Placeholder — W2d Lane 2 read-only component.
 *
 * Displays the containment mode position notice per §3.1 of
 * position_disabled_policy_note_2026-04-27.md.
 *
 * Rules (hard):
 * - MUST show "持倉資料目前不可用（containment 模式）"
 * - MUST NOT show 0 position or stale position data
 * - MUST NOT show "系統故障" / "system failure" / "Failed to load" / "Error"
 * - MUST use yellow ⚠ or grey shield icon, NOT red error icon
 * - MUST provide recovery path hint: "若需確認持倉，請至 KGI 平台直接查詢"
 */

export function KgiPositionContainmentPlaceholder() {
  return (
    <div
      data-testid="kgi-position-containment"
      style={{
        fontFamily: "var(--mono, monospace)",
        padding: "1rem 1.25rem",
        borderLeft: "3px solid var(--amber)",
        background: "rgba(255, 176, 0, 0.04)"
      }}
    >
      <div
        style={{
          display: "flex",
          gap: "0.6rem",
          alignItems: "flex-start",
          marginBottom: "0.5rem"
        }}
      >
        <span style={{ color: "var(--amber)", fontSize: "1rem", lineHeight: 1.4 }}>
          [CONTAINMENT]
        </span>
        <span
          style={{
            color: "var(--amber)",
            fontSize: "0.88rem",
            letterSpacing: "0.04em",
            lineHeight: 1.4
          }}
        >
          持倉資料目前不可用（containment 模式）
        </span>
      </div>
      <p
        style={{
          color: "var(--dim)",
          fontSize: "0.78rem",
          margin: "0 0 0.4rem 0",
          lineHeight: 1.6,
          paddingLeft: "1.6rem"
        }}
      >
        KGI gateway 的持倉端點已透過 Candidate F circuit breaker 熔斷，
        以保護 quote / trades / deals 等讀取通道持續運作。
        此為主動 containment，非系統故障。
      </p>
      <p
        style={{
          color: "var(--dim)",
          fontSize: "0.78rem",
          margin: 0,
          lineHeight: 1.6,
          paddingLeft: "1.6rem"
        }}
      >
        若需確認持倉，請至 KGI 平台直接查詢。
      </p>
    </div>
  );
}
