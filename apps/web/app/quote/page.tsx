"use client";

/**
 * /quote — KGI Gateway Quote Monitor
 *
 * W2d Lane 2 read-only frontend. Displays:
 *  [01] Quote Panel     — tick (close/chg/vol) + bidask 5-level + freshness badge
 *  [02] Broker Status   — 4-state connection indicator (§3.3 policy)
 *  [03] Position Status — containment placeholder (§3.1 policy)
 *  [04] Order UI        — locked placeholder (§6.1 no order button rule)
 *
 * Hard rules enforced:
 * - 0 order buttons (even disabled)
 * - 0 /order/* route links
 * - position wording: "持倉資料目前不可用（containment 模式）" only
 * - 0 import from broker/* or risk-engine
 * - data-testid never contains "order" or "submit"
 *
 * DRAFT PR status: not merged, not deployed.
 * Backend wire-up: awaiting Jason Lane 1 /api/v1/kgi/quote/* routes.
 */

import { Suspense, useState } from "react";

import { PageFrame } from "@/components/PageFrame";

import { KgiBrokerStatusAllStates, KgiBrokerStatusPanel } from "@/components/kgi-broker-status";
import { KgiPositionContainmentPlaceholder } from "@/components/kgi-position-placeholder";
import { KgiQuotePanel } from "@/components/kgi-quote-panel";
import type { BrokerConnectionState } from "@/lib/kgi-quote-types";

// Default symbol for W2d Step 3a evidence (2330 TSMC)
const DEFAULT_SYMBOL = "2330";

// Hard-wired status for W2d: position disabled, order locked per W1 hard line.
// Will be derived from live API state after Jason Lane 1 wire-up.
const BROKER_STATE: BrokerConnectionState = "connected-quote-available-pos-disabled";

export default function QuotePage() {
  return (
    <Suspense fallback={null}>
      <QuotePageInner />
    </Suspense>
  );
}

function QuotePageInner() {
  const [symbol] = useState(DEFAULT_SYMBOL);
  const [showAllStates, setShowAllStates] = useState(false);

  return (
    <PageFrame code="QT" title="Quote" sub="報價查詢">
      {/* DRAFT notice */}
      <section
        className="hud-frame"
        style={{
          padding: "0.5rem 1.25rem",
          marginBottom: "1rem",
          borderColor: "var(--amber)",
          fontFamily: "var(--mono, monospace)",
          fontSize: "0.78rem",
          color: "var(--amber)"
        }}
      >
        [DRAFT] W2d Lane 2 — 讀取模式預覽。後端 API wire-up 待 Jason Lane 1 完成後接通。
      </section>

      {/* [01] Quote Panel */}
      <section className="hud-frame" style={{ padding: "1.5rem", marginBottom: "1rem" }}>
        <p className="ascii-head" data-idx="01">
          [01] 即時報價 · {symbol}
        </p>
        <KgiQuotePanel symbol={symbol} />
      </section>

      {/* [02] Broker Status Panel */}
      <section className="hud-frame" style={{ padding: "1.5rem", marginBottom: "1rem" }}>
        <p className="ascii-head" data-idx="02">
          [02] Broker 連線狀態
        </p>
        <KgiBrokerStatusPanel state={BROKER_STATE} />

        {/* Dev toggle: show all 4 states for DRAFT review */}
        <div style={{ marginTop: "1rem" }}>
          <button
            onClick={() => setShowAllStates((v) => !v)}
            style={{
              background: "transparent",
              color: "var(--dim)",
              border: "1px solid var(--line, #2a2a2a)",
              padding: "0.2rem 0.6rem",
              fontFamily: "var(--mono, monospace)",
              fontSize: "0.72rem",
              cursor: "pointer"
            }}
          >
            {showAllStates ? "▲ 收起" : "▼ 展開全部狀態（DRAFT 審核用）"}
          </button>
          {showAllStates && (
            <div
              style={{
                marginTop: "0.75rem",
                padding: "0.75rem",
                border: "1px dashed var(--line, #2a2a2a)"
              }}
            >
              <p
                style={{
                  fontFamily: "var(--mono, monospace)",
                  fontSize: "0.7rem",
                  color: "var(--dim)",
                  marginBottom: "0.75rem"
                }}
              >
                [DRAFT REVIEW] 四態狀態預覽 — 非生產狀態
              </p>
              <KgiBrokerStatusAllStates />
            </div>
          )}
        </div>
      </section>

      {/* [03] Position Status */}
      <section className="hud-frame" style={{ padding: "1.5rem", marginBottom: "1rem" }}>
        <p className="ascii-head" data-idx="03">
          [03] 持倉狀態
        </p>
        <KgiPositionContainmentPlaceholder />
      </section>

      {/* [04] Order UI — locked placeholder, per §6.1: no order button allowed */}
      <section className="hud-frame" style={{ padding: "1.5rem", marginBottom: "1rem" }}>
        <p className="ascii-head" data-idx="04">
          [04] 下單功能
        </p>
        <OrderLockedPlaceholder />
      </section>
    </PageFrame>
  );
}

/**
 * Order locked placeholder.
 *
 * §6.1: quote panel MUST NOT contain order button (even disabled).
 * This section only displays the lock status — no order interaction.
 */
function OrderLockedPlaceholder() {
  return (
    <div
      data-testid="kgi-route-lock-notice"
      style={{
        fontFamily: "var(--mono, monospace)",
        padding: "0.75rem 1rem",
        borderLeft: "3px solid var(--dim)",
        color: "var(--dim)",
        fontSize: "0.82rem",
        lineHeight: 1.6
      }}
      title="/order/create remains locked"
    >
      <span style={{ letterSpacing: "0.06em" }}>
        [LOCKED] /order/create remains locked (NOT_ENABLED_IN_W1)
      </span>
      <p style={{ margin: "0.35rem 0 0 0", fontSize: "0.75rem" }}>
        下單功能尚未開放。W1 hard line 維持。
      </p>
    </div>
  );
}
