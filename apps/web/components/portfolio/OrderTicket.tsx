"use client";
/**
 * OrderTicket — the only place an operator submits an order.
 *
 * Composition:
 *   • Top: idea-handoff banner if one is in sessionStorage.
 *   • Left: the form (symbol/side/type/tif/venue/limitPx/qty).
 *   • Right: PREVIEW result · effective limits + sizing breakdown.
 *   • Bottom: PREVIEW · SUBMIT buttons. SUBMIT disabled when KILL ≠ ARMED
 *     OR last preview did not pass.
 *
 * Numbers are mono + tabular-nums (per the small-font escape rule).
 * Chinese is reserved for labels and short rationale only.
 */
import { useEffect, useMemo, useState, useTransition } from "react";
import { api } from "@/lib/radar-api";
import { useIdeaHandoff } from "@/lib/radar-handoff";
import type {
  OrderTicket, OrderPreview, OrderAck, KillMode,
  OrderSide, OrderType, OrderTif, OrderVenue, RiskLayer,
} from "@/lib/radar-types";

const SIDES:   OrderSide[]  = ["BUY", "SELL", "TRIM"];
const TYPES:   OrderType[]  = ["LMT", "MKT", "STOP"];
const TIFS:    OrderTif[]   = ["ROD", "IOC", "FOK"];
const VENUES:  OrderVenue[] = ["TWSE", "TPEX", "DARK"];

export function OrderTicketForm({ killMode }: { killMode: KillMode }) {
  const { handoff, clear } = useIdeaHandoff();

  const [ticket, setTicket] = useState<OrderTicket>({
    symbol: "", side: "BUY", type: "LMT", tif: "ROD",
    venue: "TWSE", limitPx: null, qty: 0, fromIdeaId: undefined,
  });
  const [preview, setPreview] = useState<OrderPreview | null>(null);
  const [ack, setAck] = useState<OrderAck | null>(null);
  const [pending, startTransition] = useTransition();

  /* prefill from idea handoff (one-shot) */
  useEffect(() => {
    if (!handoff) return;
    setTicket(t => ({
      ...t,
      symbol: handoff.symbol,
      side: handoff.side,
      fromIdeaId: handoff.ideaId,
    }));
  }, [handoff]);

  const submitDisabled = killMode !== "ARMED" || !preview?.pass || pending;
  const previewDisabled = !ticket.symbol || ticket.qty <= 0 || pending;

  const runPreview = () => {
    setAck(null);
    startTransition(async () => {
      const p = await api.previewOrder(ticket);
      setPreview(p);
    });
  };
  const runSubmit = () => {
    if (!preview?.pass) return;
    startTransition(async () => {
      const a = await api.submitOrder(ticket);
      setAck(a);
      if (a.status === "ACCEPTED") {
        clear();                            // clear handoff once consumed
        setTicket(t => ({ ...t, qty: 0, fromIdeaId: undefined }));
        setPreview(null);
      }
    });
  };

  return (
    <div>
      {/* Idea-handoff banner */}
      {handoff && (
        <div style={{
          padding: "10px 12px", marginBottom: 12,
          border: "1px solid var(--gold)", background: "rgba(184,138,62,0.10)",
          color: "var(--gold-bright)", fontFamily: "var(--mono)", fontSize: 11.5,
          letterSpacing: "0.16em",
        }}>
          ● FROM IDEA <b>{handoff.ideaId}</b> · {handoff.themeCode}
          <div style={{ fontFamily: "var(--serif-tc)", color: "var(--exec-mid)", fontSize: 13, marginTop: 4, letterSpacing: 0 }}>
            {handoff.rationale}
          </div>
          <button onClick={clear} style={{
            float: "right", background: "transparent", border: "none",
            color: "var(--exec-soft)", cursor: "pointer", fontFamily: "var(--mono)",
            fontSize: 10, letterSpacing: "0.18em",
          }}>✕ CLEAR</button>
        </div>
      )}

      {/* Form + Preview side-by-side */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
        {/* ─── FORM ─── */}
        <div style={{ border: "1px solid var(--exec-rule-strong)", padding: 16 }}>
          <Row label="SYMBOL">
            <input
              value={ticket.symbol}
              onChange={e => setTicket(t => ({ ...t, symbol: e.target.value.trim().toUpperCase() }))}
              placeholder="2330"
              style={inputStyle}
            />
          </Row>
          <Row label="SIDE"><Segmented options={SIDES} value={ticket.side} onChange={v => setTicket(t => ({ ...t, side: v }))} /></Row>
          <Row label="TYPE"><Segmented options={TYPES} value={ticket.type} onChange={v => setTicket(t => ({ ...t, type: v }))} /></Row>
          <Row label="TIF"><Segmented options={TIFS} value={ticket.tif} onChange={v => setTicket(t => ({ ...t, tif: v }))} /></Row>
          <Row label="VENUE"><Segmented options={VENUES} value={ticket.venue} onChange={v => setTicket(t => ({ ...t, venue: v }))} /></Row>
          <Row label="LIMIT · PX">
            <input
              type="number" step="0.01"
              value={ticket.limitPx ?? ""}
              onChange={e => setTicket(t => ({ ...t, limitPx: e.target.value === "" ? null : Number(e.target.value) }))}
              placeholder={ticket.type === "MKT" ? "—" : "1084.00"}
              disabled={ticket.type === "MKT"}
              style={inputStyle}
            />
          </Row>
          <Row label="QTY">
            <input
              type="number" step="1000" min={0}
              value={ticket.qty || ""}
              onChange={e => setTicket(t => ({ ...t, qty: Number(e.target.value) }))}
              placeholder="1000"
              style={inputStyle}
            />
          </Row>
        </div>

        {/* ─── PREVIEW PANEL ─── */}
        <div style={{ border: "1px solid var(--exec-rule-strong)", padding: 16, minHeight: 320 }}>
          <div className="tg" style={{ color: "var(--exec-mid)", marginBottom: 8 }}>§ PREVIEW · DRY-RUN RISK</div>
          {!preview && (
            <div style={{ color: "var(--exec-soft)", fontFamily: "var(--mono)", fontSize: 11.5, lineHeight: 1.7 }}>
              填好欄位 · 按 [ PREVIEW ] · 系統會先打 dry-run，逐項列出 risk guard 結果與 sizing 推導。<br/>
              通過後 [ SUBMIT ] 才會啟用。
            </div>
          )}

          {preview && (
            <>
              <Verdict pass={preview.pass} />
              <Group title="EFFECTIVE · LIMITS" subtitle="hit guards · layer 標註">
                {preview.effectiveLimits.map((g, i) => <GuardRow key={i} guard={g} />)}
              </Group>
              <Group title="SIZING · BREAKDOWN" subtitle="qty 是怎麼算出來的">
                <KV k="MODE"        v={preview.sizing.sizingMode} />
                <KV k="EQUITY"      v={`${preview.sizing.equity.toLocaleString()} TWD`} />
                <KV k="RISK / TRD"  v={`${(preview.sizing.riskPerTrade * 100).toFixed(2)}%`} />
                <KV k="LOT"         v={`${preview.sizing.lotSize}`} />
                <KV k="CAP · 8%"    v={`${preview.sizing.capByMaxPositionPct.toLocaleString()}`} />
                <KV k="FINAL · QTY" v={String(preview.sizing.finalQty)} bright />
                {preview.sizing.notes && (
                  <div style={{ fontFamily: "var(--serif-tc)", color: "var(--exec-mid)", fontSize: 12.5, marginTop: 6, lineHeight: 1.6 }}>
                    {preview.sizing.notes}
                  </div>
                )}
              </Group>
            </>
          )}
        </div>
      </div>

      {/* ACTION BAR */}
      <div style={{ display: "flex", gap: 0, marginTop: 14, border: "1px solid var(--exec-rule-strong)" }}>
        <button onClick={runPreview} disabled={previewDisabled} style={{
          ...btnStyle,
          color: previewDisabled ? "var(--exec-soft)" : "var(--gold-bright)",
          borderRight: "1px solid var(--exec-rule-strong)",
          cursor: previewDisabled ? "not-allowed" : "pointer",
        }}>{pending && !ack ? "● PREVIEW … " : "[ PREVIEW ]"}</button>
        <button onClick={runSubmit} disabled={submitDisabled} title={
          killMode !== "ARMED" ? `KILL=${killMode} · 禁止下單` :
          !preview ? "請先 PREVIEW" :
          !preview.pass ? "preview 未通過" : ""
        } style={{
          ...btnStyle,
          color: submitDisabled ? "var(--exec-soft)" : "var(--tw-up-bright)",
          cursor: submitDisabled ? "not-allowed" : "pointer",
        }}>{ack && ack.status === "ACCEPTED" ? "✓ SUBMITTED" : "[ SUBMIT ]"}</button>
      </div>

      {/* ACK */}
      {ack && (
        <div style={{
          marginTop: 12, padding: "10px 12px",
          border: `1px solid ${ack.status === "ACCEPTED" ? "var(--gold)" : "var(--tw-up)"}`,
          background: ack.status === "ACCEPTED" ? "rgba(184,138,62,0.08)" : "rgba(230,57,70,0.10)",
          fontFamily: "var(--mono)", fontSize: 11.5, color: ack.status === "ACCEPTED" ? "var(--gold-bright)" : "var(--tw-up-bright)",
        }}>
          ● {ack.status} · ORDER {ack.orderId || "—"} · CLI {ack.clientOrderId}
          {ack.rejectReason && <span style={{ marginLeft: 10, color: "var(--exec-mid)" }}>· {ack.rejectReason}</span>}
        </div>
      )}

      {/* KILL guard hint */}
      {killMode !== "ARMED" && (
        <div style={{ marginTop: 8, color: "var(--tw-up-bright)", fontFamily: "var(--mono)", fontSize: 10.5, letterSpacing: "0.18em" }}>
          ✕ KILL = {killMode} · SUBMIT BLOCKED
        </div>
      )}
    </div>
  );
}

/* ─── small bits ─── */
const labelStyle: React.CSSProperties = {
  fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.22em",
  color: "var(--exec-mid)", textTransform: "uppercase", width: 90,
  paddingTop: 8,
};
const inputStyle: React.CSSProperties = {
  flex: 1, padding: "8px 10px",
  background: "var(--exec-bg)", border: "1px solid var(--exec-rule-strong)",
  color: "var(--exec-ink)", fontFamily: "var(--mono)", fontSize: 13,
  fontFeatureSettings: '"tnum","lnum"',
  outline: "none",
};
const btnStyle: React.CSSProperties = {
  flex: 1, background: "transparent", border: "none",
  padding: "14px 16px", fontFamily: "var(--mono)", letterSpacing: "0.22em",
  fontWeight: 700, fontSize: 12,
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 10 }}>
      <span style={labelStyle}>{label}</span>
      <div style={{ flex: 1, display: "flex" }}>{children}</div>
    </div>
  );
}

function Segmented<T extends string>({ options, value, onChange }: {
  options: readonly T[]; value: T; onChange: (v: T) => void;
}) {
  return (
    <div style={{ display: "flex", flex: 1, border: "1px solid var(--exec-rule-strong)" }}>
      {options.map((o, i) => {
        const on = o === value;
        return (
          <button key={o} onClick={() => onChange(o)} style={{
            flex: 1, padding: "8px 6px", border: "none",
            borderLeft: i === 0 ? "none" : "1px solid var(--exec-rule)",
            background: on ? "rgba(184,138,62,0.16)" : "transparent",
            color: on ? "var(--gold-bright)" : "var(--exec-mid)",
            fontFamily: "var(--mono)", fontSize: 11, fontWeight: 700,
            letterSpacing: "0.18em", cursor: on ? "default" : "pointer",
          }}>{o}</button>
        );
      })}
    </div>
  );
}

function Verdict({ pass }: { pass: boolean }) {
  return (
    <div style={{
      padding: "10px 12px", marginBottom: 12,
      border: `1px solid ${pass ? "var(--gold)" : "var(--tw-up)"}`,
      background: pass ? "rgba(184,138,62,0.08)" : "rgba(230,57,70,0.10)",
      color: pass ? "var(--gold-bright)" : "var(--tw-up-bright)",
      fontFamily: "var(--mono)", fontWeight: 700, letterSpacing: "0.22em", fontSize: 12,
    }}>
      {pass ? "● PREVIEW PASS · 可下單" : "✕ PREVIEW BLOCKED · 修正後再試"}
    </div>
  );
}

function Group({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 12 }}>
      <div className="tg" style={{ color: "var(--gold)", fontWeight: 700 }}>{title}</div>
      {subtitle && <div style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 12, color: "var(--exec-mid)", marginTop: 2, marginBottom: 6 }}>{subtitle}</div>}
      <div style={{ borderTop: "1px solid var(--exec-rule-strong)" }}>{children}</div>
    </div>
  );
}

function GuardRow({ guard }: { guard: { rule: string; layer: RiskLayer; limit: string; observed: string; result: "PASS"|"WARN"|"BLOCK"; reason?: string } }) {
  const tone = guard.result === "PASS" ? "var(--gold-bright)"
             : guard.result === "WARN" ? "var(--gold)"
             : "var(--tw-up-bright)";
  return (
    <div style={{ display: "grid", gridTemplateColumns: "110px 60px 1fr 70px", gap: 8, padding: "8px 4px", borderBottom: "1px solid var(--exec-rule)", fontFamily: "var(--mono)", fontSize: 11.5 }}>
      <span style={{ color: "var(--exec-ink)", fontWeight: 700 }}>{guard.rule}</span>
      <span style={{ color: "var(--gold)", fontSize: 9.5, letterSpacing: "0.18em", fontWeight: 700 }}>· {guard.layer}</span>
      <span style={{ color: "var(--exec-mid)" }}>
        {guard.limit} · obs {guard.observed}
        {guard.reason && <span style={{ display: "block", color: "var(--exec-soft)", fontFamily: "var(--serif-tc)", fontSize: 12 }}>{guard.reason}</span>}
      </span>
      <span style={{ color: tone, textAlign: "right", fontWeight: 700 }}>● {guard.result}</span>
    </div>
  );
}

function KV({ k, v, bright }: { k: string; v: string; bright?: boolean }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", padding: "5px 4px", borderBottom: "1px solid var(--exec-rule)", fontFamily: "var(--mono)", fontSize: 11.5 }}>
      <span style={{ color: "var(--exec-mid)", letterSpacing: "0.18em" }}>{k}</span>
      <span style={{ color: bright ? "var(--gold-bright)" : "var(--exec-ink)", fontWeight: bright ? 700 : 400, fontFeatureSettings: '"tnum","lnum"' }}>{v}</span>
    </div>
  );
}
