"use client";

// PaperOrderPanel.tsx — Client Component
// Paper trading shell only. NO KGI / NO broker live submit.
// Fields: order type / side / qty / price / TIF
// Preview → POST /api/v1/paper/orders/preview
// Submit → POST /api/v1/paper/orders
//
// HARD LINE: never import KGI SDK / never call broker live submit path.

import { useState } from "react";
import { previewPaperOrder, submitPaperOrder } from "@/lib/api";
import type { PaperOrder, PreviewOrderResult } from "@iuf-trading-room/contracts";

type OrderType = "market" | "limit";
type Side = "buy" | "sell";

interface FormState {
  orderType: OrderType;
  side: Side;
  qty: string;
  price: string;
}

type PreviewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; result: PreviewOrderResult };

type SubmitState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; order: PaperOrder };

const INPUT_STYLE: React.CSSProperties = {
  background: "var(--night-bg, #0a0a08)",
  border: "1px solid var(--night-rule-strong, #333)",
  color: "var(--night-ink, #d8d4c8)",
  fontFamily: "var(--mono, monospace)",
  fontSize: 12,
  padding: "6px 10px",
  width: "100%",
  boxSizing: "border-box",
};

const SELECT_STYLE: React.CSSProperties = {
  ...INPUT_STYLE,
  cursor: "pointer",
};

function RiskCheckBadge({ blocked, riskCheck }: { blocked: boolean; riskCheck: PreviewOrderResult["riskCheck"] }) {
  const failedGuards = riskCheck.guards?.filter((g) => g.decision === "block") ?? [];
  if (blocked) {
    return (
      <div style={{ marginTop: 8 }}>
        <span className="badge-red" style={{ fontSize: 11 }}>BLOCKED</span>
        <div className="dim" style={{ fontFamily: "var(--mono)", fontSize: 11, marginTop: 4 }}>
          {riskCheck.summary}
        </div>
        {failedGuards.map((g, i) => (
          <div key={i} className="dim" style={{ fontFamily: "var(--mono)", fontSize: 11, marginTop: 2 }}>
            [{g.guard}] {g.message}
          </div>
        ))}
      </div>
    );
  }
  return (
    <div style={{ marginTop: 8 }}>
      <span className="badge-green" style={{ fontSize: 11 }}>RISK PASS</span>
      <div className="dim" style={{ fontFamily: "var(--mono)", fontSize: 11, marginTop: 4 }}>
        {riskCheck.summary || `Decision: ${riskCheck.decision}`}
      </div>
    </div>
  );
}

export function PaperOrderPanel({ symbol }: { symbol: string }) {
  const [form, setForm] = useState<FormState>({
    orderType: "limit",
    side: "buy",
    qty: "1",
    price: "",
  });
  const [preview, setPreview] = useState<PreviewState>({ status: "idle" });
  const [submit, setSubmit] = useState<SubmitState>({ status: "idle" });

  const qtyNum = parseInt(form.qty, 10);
  const priceNum = parseFloat(form.price);
  const isLimitValid = form.orderType === "market" || (!isNaN(priceNum) && priceNum > 0);
  const isQtyValid = !isNaN(qtyNum) && qtyNum > 0;
  const canPreview = isQtyValid && isLimitValid;

  const handlePreview = async () => {
    if (!canPreview) return;
    setPreview({ status: "loading" });
    setSubmit({ status: "idle" });
    try {
      const res = await previewPaperOrder({
        symbol,
        side: form.side,
        orderType: form.orderType,
        qty: qtyNum,
        price: form.orderType === "limit" ? priceNum : null,
      });
      setPreview({ status: "ok", result: res.data });
    } catch (e) {
      setPreview({ status: "error", message: e instanceof Error ? e.message : "preview failed" });
    }
  };

  const canSubmit = preview.status === "ok" && !preview.result.blocked;

  const handleSubmit = async () => {
    if (!canSubmit || !canPreview) return;
    setSubmit({ status: "loading" });
    try {
      const res = await submitPaperOrder({
        symbol,
        side: form.side,
        orderType: form.orderType,
        qty: qtyNum,
        price: form.orderType === "limit" ? priceNum : null,
      });
      setSubmit({ status: "ok", order: res.data });
    } catch (e) {
      setSubmit({ status: "error", message: e instanceof Error ? e.message : "submit failed" });
    }
  };

  return (
    <section className="panel hud-frame">
      <h3 className="ascii-head">
        <span className="ascii-head-bracket">[06]</span> Paper 委託
      </h3>

      {/* PAPER BANNER — must be visible, sticky, unmissable */}
      <div style={{
        background: "var(--tw-up, #c0392b)",
        color: "#fff",
        fontFamily: "var(--mono, monospace)",
        fontWeight: 700,
        fontSize: 12,
        padding: "8px 14px",
        letterSpacing: "0.10em",
        marginBottom: 16,
        borderRadius: 2,
      }}>
        PAPER TRADING · 模擬下單 · 未送任何券商 · 不影響真實帳戶
      </div>

      {/* Form */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
        {/* Order type */}
        <div>
          <label className="tg" style={{ fontSize: 10, color: "var(--night-mid, #888)", display: "block", marginBottom: 4 }}>
            委託類別
          </label>
          <select
            value={form.orderType}
            onChange={(e) => setForm((f) => ({ ...f, orderType: e.target.value as OrderType, price: "" }))}
            style={SELECT_STYLE}
          >
            <option value="limit">限價</option>
            <option value="market">市價</option>
          </select>
        </div>

        {/* Side */}
        <div>
          <label className="tg" style={{ fontSize: 10, color: "var(--night-mid, #888)", display: "block", marginBottom: 4 }}>
            買賣方向
          </label>
          <select
            value={form.side}
            onChange={(e) => setForm((f) => ({ ...f, side: e.target.value as Side }))}
            style={SELECT_STYLE}
          >
            <option value="buy">買進</option>
            <option value="sell">賣出</option>
          </select>
        </div>

        {/* Qty */}
        <div>
          <label className="tg" style={{ fontSize: 10, color: "var(--night-mid, #888)", display: "block", marginBottom: 4 }}>
            委託數量（張）
          </label>
          <input
            type="number"
            min={1}
            value={form.qty}
            onChange={(e) => setForm((f) => ({ ...f, qty: e.target.value }))}
            style={INPUT_STYLE}
          />
        </div>

        {/* Price (hidden for market) */}
        {form.orderType === "limit" && (
          <div>
            <label className="tg" style={{ fontSize: 10, color: "var(--night-mid, #888)", display: "block", marginBottom: 4 }}>
              限價（TWD）
            </label>
            <input
              type="number"
              min={0.01}
              step={0.01}
              value={form.price}
              onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
              placeholder="e.g. 780.5"
              style={INPUT_STYLE}
            />
          </div>
        )}

        {/* TIF — fixed ROD for paper */}
        <div>
          <label className="tg" style={{ fontSize: 10, color: "var(--night-mid, #888)", display: "block", marginBottom: 4 }}>
            委託效期
          </label>
          <select disabled style={{ ...SELECT_STYLE, opacity: 0.5, cursor: "not-allowed" }}>
            <option>ROD（當日有效）</option>
          </select>
        </div>
      </div>

      {/* Symbol display */}
      <div style={{ marginBottom: 12 }}>
        <span className="tg" style={{ fontSize: 10, color: "var(--night-mid, #888)" }}>標的</span>
        <span className="mono" style={{ marginLeft: 10, fontWeight: 700, fontSize: 15 }}>{symbol}</span>
      </div>

      {/* Action row */}
      <div className="action-row" style={{ gap: 8, marginBottom: 16 }}>
        <button
          className="btn-sm"
          onClick={handlePreview}
          disabled={!canPreview || preview.status === "loading"}
        >
          {preview.status === "loading" ? "預覽中…" : "預覽風控"}
        </button>
        <button
          className="btn-sm"
          onClick={handleSubmit}
          disabled={!canSubmit || submit.status === "loading"}
          style={canSubmit ? { borderColor: "var(--gold, #b8960c)", color: "var(--gold, #b8960c)" } : {}}
        >
          {submit.status === "loading" ? "送出中…" : "送出 Paper Order"}
        </button>
      </div>

      {/* Preview result */}
      {preview.status === "error" && (
        <div style={{ padding: "8px 0" }}>
          <span className="badge-red" style={{ fontSize: 11 }}>PREVIEW ERROR</span>
          <div className="dim" style={{ fontFamily: "var(--mono)", fontSize: 11, marginTop: 4 }}>{preview.message}</div>
        </div>
      )}

      {preview.status === "ok" && (
        <div style={{ border: "1px solid var(--night-rule-strong, #333)", padding: "10px 14px", marginBottom: 12 }}>
          <div className="tg" style={{ fontSize: 10, color: "var(--night-mid, #888)", marginBottom: 6, letterSpacing: "0.12em" }}>
            RISK CHECK PREVIEW
          </div>
          <RiskCheckBadge blocked={preview.result.blocked} riskCheck={preview.result.riskCheck} />
          {preview.result.quoteGate && (
            <div className="dim" style={{ fontFamily: "var(--mono)", fontSize: 11, marginTop: 6 }}>
              Quote gate: {preview.result.quoteGate.decision ?? "—"}
            </div>
          )}
        </div>
      )}

      {/* Submit result */}
      {submit.status === "error" && (
        <div style={{ padding: "8px 0" }}>
          <span className="badge-red" style={{ fontSize: 11 }}>SUBMIT ERROR</span>
          <div className="dim" style={{ fontFamily: "var(--mono)", fontSize: 11, marginTop: 4 }}>{submit.message}</div>
        </div>
      )}

      {submit.status === "ok" && (
        <div style={{ padding: "8px 0" }}>
          <span className="badge-green" style={{ fontSize: 11 }}>PAPER ORDER ACCEPTED</span>
          <div className="dim" style={{ fontFamily: "var(--mono)", fontSize: 11, marginTop: 4 }}>
            Order ID: {submit.order.id} · Status: {submit.order.status}
          </div>
        </div>
      )}
    </section>
  );
}
