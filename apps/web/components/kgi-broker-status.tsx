"use client";

/**
 * KGI Broker Status Panel — W2d Lane 2 read-only component.
 *
 * Displays the 4-state broker connection status per §3.3 of
 * position_disabled_policy_note_2026-04-27.md:
 *
 *   connected-quote-available            : Connected & Quote Available
 *   connected-quote-available-pos-disabled: Connected & Quote Available, Position Disabled (containment)
 *   connected-order-locked               : Connected, Order Locked (NOT_ENABLED_IN_W1)
 *   disconnected                         : Disconnected
 *
 * No order buttons. No order capability exposed. §6 4/4 PASS.
 */

import type { BrokerConnectionState } from "@/lib/kgi-quote-types";

type StatusConfig = {
  icon: string;
  label: string;
  note: string;
  borderColor: string;
  iconColor: string;
};

const STATE_CONFIG: Record<BrokerConnectionState, StatusConfig> = {
  "connected-quote-available": {
    icon: "✓",
    label: "Connected & Quote Available",
    note: "Gateway 連線正常，報價資料流通。",
    borderColor: "var(--phosphor)",
    iconColor: "var(--phosphor)"
  },
  "connected-quote-available-pos-disabled": {
    icon: "⚠",
    label: "Connected & Quote Available, Position Disabled (containment)",
    note: "持倉資料目前不可用（containment 模式）。報價資料正常。",
    borderColor: "var(--amber)",
    iconColor: "var(--amber)"
  },
  "connected-order-locked": {
    icon: "■",
    label: "Connected, Order Locked",
    note: "/order/create 仍鎖死 (NOT_ENABLED_IN_W1) — 目前不允許下單。",
    borderColor: "var(--amber)",
    iconColor: "var(--amber)"
  },
  disconnected: {
    icon: "✗",
    label: "Disconnected",
    note: "Gateway 無法連線。請確認本地 gateway 是否在線。",
    borderColor: "var(--dim)",
    iconColor: "var(--dim)"
  }
};

export function KgiBrokerStatusPanel({
  state
}: {
  state: BrokerConnectionState;
}) {
  const cfg = STATE_CONFIG[state];
  return (
    <div
      data-testid="kgi-broker-status"
      style={{
        fontFamily: "var(--mono, monospace)",
        borderLeft: `3px solid ${cfg.borderColor}`,
        paddingLeft: "0.75rem"
      }}
    >
      <div
        style={{
          display: "flex",
          gap: "0.5rem",
          alignItems: "baseline",
          marginBottom: "0.3rem"
        }}
      >
        <span style={{ color: cfg.iconColor, fontSize: "0.9rem" }}>{cfg.icon}</span>
        <span
          style={{
            color: "var(--fg, #eee)",
            fontSize: "0.85rem",
            letterSpacing: "0.04em"
          }}
        >
          {cfg.label}
        </span>
      </div>
      <p
        style={{
          color: "var(--dim)",
          fontSize: "0.78rem",
          margin: 0,
          lineHeight: 1.5
        }}
      >
        {cfg.note}
      </p>
    </div>
  );
}

/**
 * Demo panel showing all 4 states — for DRAFT PR visual review.
 */
export function KgiBrokerStatusAllStates() {
  const states: BrokerConnectionState[] = [
    "connected-quote-available",
    "connected-quote-available-pos-disabled",
    "connected-order-locked",
    "disconnected"
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {states.map((s) => (
        <KgiBrokerStatusPanel key={s} state={s} />
      ))}
    </div>
  );
}
