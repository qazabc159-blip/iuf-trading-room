"use client";

import { useState } from "react";

import type { ExecutionEvent, Fill } from "@iuf-trading-room/contracts";

import { MODE_DECISION_HINT } from "@/lib/quote-vocab";

type Status = "connecting" | "live" | "reconnecting" | "error";

const TYPE_COLOR: Record<ExecutionEvent["type"], string> = {
  submit: "var(--phosphor)",
  acknowledge: "var(--phosphor)",
  fill: "var(--phosphor)",
  cancel: "var(--amber)",
  reject: "var(--danger, #ff4d4d)",
  expire: "var(--dim)",
  reconcile: "var(--dim)"
};

const TYPE_LABEL: Record<ExecutionEvent["type"], string> = {
  submit: "SUBMIT",
  acknowledge: "ACK",
  fill: "FILL",
  cancel: "CANCEL",
  reject: "REJECT",
  expire: "EXPIRE",
  reconcile: "RECON"
};

const STATUS_COLOR: Record<Status, string> = {
  connecting: "var(--dim)",
  live: "var(--phosphor)",
  reconnecting: "var(--amber)",
  error: "var(--danger, #ff4d4d)"
};

const STATUS_LABEL: Record<Status, string> = {
  connecting: "CONNECTING",
  live: "LIVE",
  reconnecting: "RECONNECTING",
  error: "ERROR"
};

function eventKey(ev: ExecutionEvent): string {
  return `${ev.orderId}:${ev.timestamp}:${ev.type}`;
}

// Heuristic: a fill event's payload is the Fill record. We don't trust the
// runtime shape blindly — narrow only when the canonical fields are present.
function asFill(ev: ExecutionEvent): Fill | null {
  if (ev.type !== "fill" || !ev.payload || typeof ev.payload !== "object") {
    return null;
  }
  const p = ev.payload as Record<string, unknown>;
  if (
    typeof p.id === "string" &&
    typeof p.orderId === "string" &&
    typeof p.symbol === "string" &&
    typeof p.quantity === "number" &&
    typeof p.price === "number"
  ) {
    return ev.payload as Fill;
  }
  return null;
}

type QuoteContext = {
  source: string | null;
  readiness: "ready" | "degraded" | "blocked" | string;
  freshnessStatus: "fresh" | "stale" | "missing" | string;
  paperUsable: boolean;
  providerConnected: boolean;
  fallbackReason: string;
  staleReason: string;
  reasons: string[];
  last: number | null;
  bid: number | null;
  ask: number | null;
};

type QuoteDecisionMode = {
  decision: "allow" | "review" | "block";
  usable: boolean;
  safe: boolean;
};

type QuoteDecision = {
  selectedSource: string | null;
  readiness: "ready" | "degraded" | "blocked" | string;
  freshnessStatus: "fresh" | "stale" | "missing" | string;
  fallbackReason: string;
  staleReason: string;
  primaryReason: string;
  reasons: string[];
  quoteTimestamp: string | null;
  quoteAgeMs: number | null;
  quote: {
    source: string;
    last: number | null;
    bid: number | null;
    ask: number | null;
    timestamp: string;
    ageMs: number;
    isStale: boolean;
  } | null;
  paper?: QuoteDecisionMode;
  execution?: QuoteDecisionMode;
};

// Paper broker attaches quoteContext to submit/ack/fill/reject payloads so the
// timeline can show what the quote feed looked like at order time. Cancel
// events carry `originalQuoteContext` instead — a replay of the Order's
// persisted quoteContext — because cancel is user-driven and doesn't make a
// new decision against the quote.
function asQuoteContext(
  ev: ExecutionEvent
): { qc: QuoteContext; kind: "current" | "original" } | null {
  if (!ev.payload || typeof ev.payload !== "object") return null;
  const p = ev.payload as Record<string, unknown>;
  const current = p.quoteContext;
  if (current && typeof current === "object") {
    return { qc: current as QuoteContext, kind: "current" };
  }
  const original = p.originalQuoteContext;
  if (original && typeof original === "object") {
    return { qc: original as QuoteContext, kind: "original" };
  }
  return null;
}

function asQuoteDecision(ev: ExecutionEvent): QuoteDecision | null {
  if (!ev.payload || typeof ev.payload !== "object") return null;
  const p = ev.payload as Record<string, unknown>;
  const qd = p.quoteDecision;
  if (qd && typeof qd === "object") {
    return qd as QuoteDecision;
  }
  return null;
}

const QC_READINESS_COLOR: Record<string, string> = {
  ready: "var(--phosphor)",
  degraded: "var(--amber)",
  blocked: "var(--danger, #ff4d4d)"
};

export function ExecutionTimeline({
  events,
  status
}: {
  events: ExecutionEvent[];
  status: Status;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          marginBottom: "0.75rem",
          fontFamily: "var(--mono, monospace)",
          fontSize: "0.8rem"
        }}
      >
        <span style={{ color: "var(--dim)" }}>
          最近 {events.length} 筆事件 · 點選列展開細節
        </span>
        <span style={{ color: STATUS_COLOR[status] }}>
          ● {STATUS_LABEL[status]}
        </span>
      </div>
      {events.length === 0 ? (
        <p
          style={{
            fontFamily: "var(--mono, monospace)",
            color: "var(--dim)",
            fontSize: "0.85rem"
          }}
        >
          [IDLE] 尚未接收到 execution 事件。
        </p>
      ) : (
        <ol
          style={{
            listStyle: "none",
            padding: 0,
            margin: 0,
            display: "grid",
            gap: "0.25rem",
            fontFamily: "var(--mono, monospace)",
            fontSize: "0.8rem"
          }}
        >
          {events.map((ev, idx) => {
            const key = eventKey(ev);
            const open = expanded === key;
            return (
              <li
                key={`${key}-${idx}`}
                style={{
                  borderTop: idx === 0 ? "none" : "1px solid var(--line, #2a2a2a)"
                }}
              >
                <button
                  type="button"
                  onClick={() => setExpanded(open ? null : key)}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1.25rem 6rem 4rem 7rem 1fr 7rem",
                    gap: "0.5rem",
                    padding: "0.3rem 0",
                    width: "100%",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    fontFamily: "inherit",
                    fontSize: "inherit",
                    textAlign: "left",
                    color: "inherit"
                  }}
                >
                  <span style={{ color: "var(--dim)" }}>{open ? "▼" : "▶"}</span>
                  <span style={{ color: "var(--dim)" }}>
                    {new Date(ev.timestamp).toLocaleTimeString("zh-TW", {
                      hour12: false
                    })}
                  </span>
                  <span style={{ color: TYPE_COLOR[ev.type] }}>
                    {TYPE_LABEL[ev.type]}
                  </span>
                  <span style={{ color: "var(--fg, #eee)" }}>
                    {ev.orderId.slice(0, 8)}
                  </span>
                  <span style={{ color: "var(--dim)" }}>{ev.message ?? "—"}</span>
                  <span style={{ color: "var(--phosphor)", textAlign: "right" }}>
                    {ev.status}
                  </span>
                </button>
                {open && <DetailPanel ev={ev} />}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function DetailPanel({ ev }: { ev: ExecutionEvent }) {
  const fill = asFill(ev);
  const qc = asQuoteContext(ev);
  const qd = asQuoteDecision(ev);
  const ts = new Date(ev.timestamp);
  const notional = fill ? fill.price * fill.quantity : null;
  return (
    <div
      style={{
        margin: "0.4rem 0 0.75rem 1.75rem",
        padding: "0.65rem 0.85rem",
        border: `1px solid ${TYPE_COLOR[ev.type]}`,
        background: "rgba(255,255,255,0.02)",
        display: "grid",
        gap: "0.6rem",
        fontFamily: "var(--mono, monospace)",
        fontSize: "0.78rem"
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: "0.4rem"
        }}
      >
        <DetailStat label="時間" value={`${ts.toISOString()} (${ts.toLocaleString("zh-TW", { hour12: false })})`} />
        <DetailStat label="Type" value={TYPE_LABEL[ev.type]} accent={TYPE_COLOR[ev.type]} />
        <DetailStat label="Status" value={ev.status} accent="var(--phosphor)" />
        <DetailStat label="Order ID" value={ev.orderId} mono />
        <DetailStat label="Client Order ID" value={ev.clientOrderId} mono />
        {ev.message && <DetailStat label="Message" value={ev.message} accent="var(--amber)" />}
      </div>

      {fill && (
        <div
          style={{
            paddingTop: "0.4rem",
            borderTop: "1px dashed var(--line, #2a2a2a)",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            gap: "0.4rem"
          }}
        >
          <DetailStat label="Symbol / Side" value={`${fill.symbol} ${fill.side.toUpperCase()}`} />
          <DetailStat
            label="成交量"
            value={`${fill.quantity.toLocaleString()} 股`}
            accent="var(--phosphor)"
          />
          <DetailStat
            label="成交價"
            value={fill.price.toLocaleString()}
            accent="var(--phosphor)"
          />
          {notional !== null && (
            <DetailStat
              label="名目"
              value={notional.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            />
          )}
          <DetailStat label="手續費" value={fill.fee.toFixed(2)} />
          <DetailStat label="證交稅" value={fill.tax.toFixed(2)} />
          <DetailStat label="Fill ID" value={fill.id} mono />
        </div>
      )}

      {qc && <QuoteContextBlock qc={qc.qc} kind={qc.kind} />}
      {qd && <QuoteDecisionBlock qd={qd} />}

      {ev.payload != null && !fill && !qc && !qd && (
        <details>
          <summary style={{ color: "var(--dim)", cursor: "pointer" }}>Raw payload</summary>
          <pre
            style={{
              marginTop: "0.4rem",
              padding: "0.5rem",
              background: "rgba(0,0,0,0.35)",
              color: "var(--phosphor)",
              fontSize: "0.75rem",
              overflowX: "auto"
            }}
          >
            {JSON.stringify(ev.payload, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}

function QuoteContextBlock({
  qc,
  kind
}: {
  qc: QuoteContext;
  kind: "current" | "original";
}) {
  const readinessColor = QC_READINESS_COLOR[qc.readiness] ?? "var(--dim)";
  const heading =
    kind === "original"
      ? "[ORIGINAL QUOTE CONTEXT · 原送單時的報價狀態 (cancel 不重讀報價)]"
      : "[QUOTE CONTEXT · 送單當下的報價狀態]";
  return (
    <div
      style={{
        paddingTop: "0.4rem",
        borderTop: "1px dashed var(--line, #2a2a2a)"
      }}
    >
      <div style={{ color: "var(--dim)", marginBottom: "0.35rem", fontSize: "0.7rem" }}>
        {heading}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: "0.4rem"
        }}
      >
        <DetailStat label="來源" value={qc.source ?? "—"} />
        <DetailStat
          label="readiness"
          value={qc.readiness.toUpperCase()}
          accent={readinessColor}
        />
        <DetailStat
          label="freshness"
          value={qc.freshnessStatus}
          accent={qc.freshnessStatus === "fresh" ? "var(--phosphor)" : "var(--amber)"}
        />
        <DetailStat
          label="paper-usable"
          value={qc.paperUsable ? "YES" : "NO"}
          accent={qc.paperUsable ? "var(--phosphor)" : "var(--amber)"}
        />
        <DetailStat
          label="connected"
          value={qc.providerConnected ? "YES" : "NO"}
          accent={qc.providerConnected ? "var(--phosphor)" : "var(--amber)"}
        />
        <DetailStat
          label="last / bid / ask"
          value={`${qc.last ?? "—"} / ${qc.bid ?? "—"} / ${qc.ask ?? "—"}`}
        />
        {qc.fallbackReason && qc.fallbackReason !== "none" && (
          <DetailStat label="fallback" value={qc.fallbackReason} accent="var(--amber)" />
        )}
        {qc.staleReason && qc.staleReason !== "none" && (
          <DetailStat label="stale" value={qc.staleReason} accent="var(--amber)" />
        )}
      </div>
      {qc.reasons.length > 0 && (
        <ul
          style={{
            margin: "0.4rem 0 0 1rem",
            padding: 0,
            color: "var(--dim)",
            fontSize: "0.72rem"
          }}
        >
          {qc.reasons.map((r, i) => (
            <li key={`qc-r-${i}`}>{r}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function QuoteDecisionBlock({ qd }: { qd: QuoteDecision }) {
  const readinessColor = QC_READINESS_COLOR[qd.readiness] ?? "var(--dim)";
  const renderMode = (label: string, mode: QuoteDecisionMode | undefined) =>
    mode ? (
      <DetailStat
        label={label}
        value={`${mode.decision.toUpperCase()} / ${mode.usable ? "usable" : "hold"} / ${
          mode.safe ? "safe" : "unsafe"
        }`}
        accent={mode.safe ? "var(--phosphor)" : "var(--amber)"}
      />
    ) : null;

  return (
    <div
      style={{
        paddingTop: "0.4rem",
        borderTop: "1px dashed var(--line, #2a2a2a)"
      }}
    >
      <div style={{ color: "var(--dim)", marginBottom: "0.35rem", fontSize: "0.7rem" }}>
        [QUOTE DECISION]
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: "0.4rem"
        }}
      >
        <DetailStat label="selected" value={qd.selectedSource ?? "??"} />
        <DetailStat
          label="readiness"
          value={qd.readiness.toUpperCase()}
          accent={readinessColor}
        />
        <DetailStat
          label="freshness"
          value={qd.freshnessStatus}
          accent={qd.freshnessStatus === "fresh" ? "var(--phosphor)" : "var(--amber)"}
        />
        <DetailStat
          label="primary"
          value={qd.primaryReason || "none"}
          accent={qd.primaryReason && qd.primaryReason !== "none" ? "var(--amber)" : undefined}
        />
        <DetailStat
          label="quote"
          value={
            qd.quote
              ? `${qd.quote.last ?? "??"} / ${qd.quote.bid ?? "??"} / ${qd.quote.ask ?? "??"}`
              : "none"
          }
        />
        <DetailStat
          label="quote age"
          value={qd.quoteAgeMs === null ? "none" : `${qd.quoteAgeMs}ms`}
          accent={qd.quoteAgeMs !== null && qd.quoteAgeMs > 0 ? "amber" : undefined}
        />
        {renderMode("paper", qd.paper)}
        {renderMode("execution", qd.execution)}
      </div>
      {(() => {
        // Render the gate-override hint per mode so the reader can tell which
        // lane (paper vs. live execution) the constraint belongs to. When both
        // modes are "allow" the mode badges above already say so — no hint
        // needed. When the two modes disagree (e.g. paper allow + execution
        // review), both hints appear so the user sees exactly what each lane
        // would do with this quote.
        const rows: { mode: "paper" | "execution"; decision: "review" | "block" }[] = [];
        if (qd.paper && qd.paper.decision !== "allow") {
          rows.push({ mode: "paper", decision: qd.paper.decision });
        }
        if (qd.execution && qd.execution.decision !== "allow") {
          rows.push({ mode: "execution", decision: qd.execution.decision });
        }
        if (rows.length === 0) return null;
        return (
          <div style={{ display: "grid", gap: "0.2rem", marginTop: "0.35rem" }}>
            {rows.map((r) => (
              <div
                key={r.mode}
                style={{ color: "var(--dim)", fontSize: "0.7rem" }}
              >
                <span style={{ color: "var(--amber)", marginRight: "0.35rem" }}>
                  [{r.mode.toUpperCase()}]
                </span>
                {MODE_DECISION_HINT[r.decision]}
              </div>
            ))}
          </div>
        );
      })()}
      {(qd.fallbackReason && qd.fallbackReason !== "none") || (qd.staleReason && qd.staleReason !== "none") ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
            gap: "0.4rem",
            marginTop: "0.4rem"
          }}
        >
          {qd.fallbackReason && qd.fallbackReason !== "none" && (
            <DetailStat label="fallback" value={qd.fallbackReason} accent="var(--amber)" />
          )}
          {qd.staleReason && qd.staleReason !== "none" && (
            <DetailStat label="stale" value={qd.staleReason} accent="var(--amber)" />
          )}
        </div>
      ) : null}
      {qd.reasons.length > 0 && (
        <ul
          style={{
            margin: "0.4rem 0 0 1rem",
            padding: 0,
            color: "var(--dim)",
            fontSize: "0.72rem"
          }}
        >
          {qd.reasons.map((r, i) => (
            <li key={`qd-r-${i}`}>{r}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DetailStat({
  label,
  value,
  accent,
  mono
}: {
  label: string;
  value: string;
  accent?: string;
  mono?: boolean;
}) {
  return (
    <div>
      <div style={{ color: "var(--dim)", fontSize: "0.7rem" }}>{label}</div>
      <div
        style={{
          color: accent ?? "var(--fg, #eee)",
          wordBreak: mono ? "break-all" : "normal",
          fontSize: mono ? "0.75rem" : "0.85rem"
        }}
      >
        {value}
      </div>
    </div>
  );
}
