"use client";

import { useMemo, useState } from "react";

type Side = "BUY" | "SELL";
type OrderType = "LMT" | "MKT";
type Tif = "ROD" | "IOC" | "FOK";

function formatMoney(value: number) {
  return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

export function PaperOrderPanel({
  symbol,
  latestPrice,
}: {
  symbol: string;
  latestPrice: number;
}) {
  const [side, setSide] = useState<Side>("BUY");
  const [orderType, setOrderType] = useState<OrderType>("LMT");
  const [qty, setQty] = useState(1);
  const [limitPx, setLimitPx] = useState(() => Number(latestPrice.toFixed(2)));
  const [tif, setTif] = useState<Tif>("ROD");
  const [previewed, setPreviewed] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const shares = Math.max(1, qty) * 1000;
  const px = orderType === "MKT" ? latestPrice : limitPx;
  const notional = Math.round(shares * px);
  const estimatedFee = Math.round(notional * 0.001425);
  const canSubmit = previewed && notional > 0;

  const guards = useMemo(() => [
    { label: "單筆名目金額", result: notional <= 500_000 ? "PASS" : "WARN", value: `${formatMoney(notional)} TWD` },
    { label: "KILL 模式", result: "PASS", value: "ARMED mock" },
    { label: "送單路由", result: "BLOCK", value: "本機預覽，不送出" },
  ], [notional]);

  function reset() {
    setSide("BUY");
    setOrderType("LMT");
    setQty(1);
    setLimitPx(Number(latestPrice.toFixed(2)));
    setTif("ROD");
    setPreviewed(false);
    setSubmitted(false);
  }

  return (
    <section className="panel company-sticky-panel">
      <div className="panel-head">
        <div>
          <span className="tg panel-code">PPR-ORD</span>
          <span className="tg muted"> - </span>
          <span className="tg gold">紙上預覽</span>
          <div className="panel-sub">不連線、不送單、不碰 KGI gateway</div>
        </div>
        <div className="tg soft">{symbol}</div>
      </div>

      <div className="paper-order-panel">
        <div className="paper-banner tg">Paper preview only — no real order routing</div>

        <div className="paper-segment">
          {(["BUY", "SELL"] as const).map((item) => (
            <button
              className={side === item ? `paper-chip active ${item === "BUY" ? "up" : "down"}` : "paper-chip"}
              key={item}
              onClick={() => setSide(item)}
              type="button"
            >
              {item === "BUY" ? "買進" : "賣出"}
            </button>
          ))}
        </div>

        <div className="paper-segment">
          {(["LMT", "MKT"] as const).map((item) => (
            <button className={orderType === item ? "paper-chip active" : "paper-chip"} key={item} onClick={() => setOrderType(item)} type="button">
              {item === "LMT" ? "限價" : "市價"}
            </button>
          ))}
        </div>

        <label className="paper-field">
          <span className="tg soft">張數</span>
          <input min={1} onChange={(event) => setQty(Number(event.target.value) || 1)} type="number" value={qty} />
        </label>

        <label className="paper-field">
          <span className="tg soft">限價</span>
          <input disabled={orderType === "MKT"} min={0} onChange={(event) => setLimitPx(Number(event.target.value) || 0)} step="0.1" type="number" value={limitPx} />
        </label>

        <div className="paper-segment">
          {(["ROD", "IOC", "FOK"] as const).map((item) => (
            <button className={tif === item ? "paper-chip active" : "paper-chip"} key={item} onClick={() => setTif(item)} type="button">
              {item}
            </button>
          ))}
        </div>

        <div className="paper-actions">
          <button className="outline-button" onClick={() => setPreviewed(true)} type="button">預覽</button>
          <button className="mini-button" disabled={!canSubmit} onClick={() => setSubmitted(true)} type="button">本機提交</button>
          <button className="paper-reset tg" onClick={reset} type="button">RESET</button>
        </div>

        {previewed && (
          <div className="paper-preview">
            <div className="row paper-preview-row">
              <span className="tg soft">標的</span><b className="tg">{symbol}</b>
              <span className="tg soft">方向</span><b className={side === "BUY" ? "up" : "down"}>{side === "BUY" ? "買進" : "賣出"}</b>
            </div>
            <div className="row paper-preview-row">
              <span className="tg soft">股數</span><b>{shares.toLocaleString("en-US")}</b>
              <span className="tg soft">金額</span><b>{formatMoney(notional)}</b>
            </div>
            <div className="row paper-preview-row">
              <span className="tg soft">估手續費</span><b>{formatMoney(estimatedFee)}</b>
              <span className="tg soft">TIF</span><b>{tif}</b>
            </div>
            <div className="company-guard-list">
              {guards.map((guard) => (
                <div className="row company-guard-row" key={guard.label}>
                  <span className="tg">{guard.label}</span>
                  <span className={`badge ${guard.result === "PASS" ? "badge-green" : guard.result === "WARN" ? "badge-yellow" : "badge-red"}`}>{guard.result}</span>
                  <span className="tg soft">{guard.value}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {submitted && <div className="terminal-note paper-local-result">紙上預覽，尚未送出</div>}
      </div>
    </section>
  );
}

