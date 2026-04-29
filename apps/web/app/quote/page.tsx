"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Chart } from "@/components/Chart";
import { PageFrame, Panel } from "@/components/PageFrame";
import { MetricStrip, signed, toneClass } from "@/components/RadarWidgets";
import type { BidAskLevel, QuoteInterval, QuoteStatus, QuoteTick } from "@/lib/radar-uncovered";
import { fallbackQuote, mockBidAsk, mockTicks, radarUncoveredApi } from "@/lib/radar-uncovered";

const INTERVALS: QuoteInterval[] = ["1m", "5m", "15m", "1d"];

function initialSymbol() {
  if (typeof window === "undefined") return "2330";
  return new URLSearchParams(window.location.search).get("symbol") || "2330";
}

export default function QuotePage() {
  const [symbol, setSymbol] = useState(initialSymbol);
  const [input, setInput] = useState(initialSymbol);
  const [interval, setInterval] = useState<QuoteInterval>("1m");
  const [status, setStatus] = useState<QuoteStatus>(() => fallbackQuote(initialSymbol()));
  const [bidask, setBidask] = useState<BidAskLevel[]>(() => mockBidAsk(initialSymbol()));
  const [ticks, setTicks] = useState<QuoteTick[]>(() => mockTicks(initialSymbol()));

  useEffect(() => {
    let alive = true;

    async function pullFast() {
      const [nextStatus, nextBidask, nextTicks] = await Promise.all([
        radarUncoveredApi.quoteStatus(symbol),
        radarUncoveredApi.quoteBidask(symbol),
        radarUncoveredApi.quoteTicks(symbol),
      ]);
      if (!alive) return;
      setStatus(nextStatus);
      setBidask(nextBidask);
      setTicks(nextTicks);
    }

    pullFast();
    const fast = window.setInterval(pullFast, 5000);
    return () => {
      alive = false;
      window.clearInterval(fast);
    };
  }, [symbol]);

  const cells = useMemo(
    () => [
      { label: "現價", value: status.last.toLocaleString(), delta: status.change },
      { label: "漲跌", value: signed(status.change, 2), tone: toneClass(status.change) },
      { label: "漲跌幅", value: `${signed(status.changePct, 2)}%`, tone: toneClass(status.changePct) },
      { label: "成交量", value: status.volume.toLocaleString(), tone: "muted" as const },
      { label: "買價", value: status.bid.toLocaleString(), tone: "up" as const },
      { label: "賣價", value: status.ask.toLocaleString(), tone: "down" as const },
    ],
    [status],
  );

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = input.trim() || "2330";
    setSymbol(next);
    window.history.replaceState(null, "", `/quote?symbol=${encodeURIComponent(next)}`);
  }

  return (
    <PageFrame
      code="QTE"
      title={`即時報價 · ${symbol}`}
      sub="單檔報價 / K 線 / 五檔 / 成交明細"
      note="[QTE] KGI 報價讀取面 · 五秒刷新 · 不含下單動作"
    >
      <Panel code="QTE-SRC" title="股票代號" right="KGI / 模擬備援">
        <form onSubmit={submit} style={{ display: "flex", gap: 10, padding: "12px 0" }}>
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            style={{
              flex: "0 1 220px",
              minHeight: 34,
              border: "1px solid var(--night-rule-strong)",
              background: "var(--night)",
              color: "var(--night-ink)",
              fontFamily: "var(--mono)",
              padding: "0 10px",
              outline: "none",
            }}
            placeholder="2330"
          />
          <button className="mini-button" type="submit">查詢</button>
          <span className="tg soft" style={{ alignSelf: "center" }}>
            {status.name} · 開 {status.open} / 高 {status.high} / 低 {status.low}
          </span>
        </form>
      </Panel>

      <MetricStrip columns={6} cells={cells} />

      <div className="company-grid">
        <Panel
          code="QTE-K"
          title="K 線"
          right={
            <span style={{ display: "inline-flex", gap: 6 }}>
              {INTERVALS.map((item) => (
                <button
                  className={item === interval ? "mini-button" : "outline-button"}
                  key={item}
                  onClick={() => setInterval(item)}
                  type="button"
                >
                  {item}
                </button>
              ))}
            </span>
          }
        >
          <Chart symbol={symbol} interval={interval} height={520} />
          <div className="terminal-note">目前保留 KGI K 線 adapter 位置；後端 interval 完整開放後，只替換資料來源，不改畫面。</div>
        </Panel>

        <div>
          <Panel code="QTE-BA" title="五檔報價" right="買賣盤">
            <div className="row table-head" style={{ gridTemplateColumns: "64px 1fr 1fr 1fr 1fr", gap: 10 }}>
              <span>檔位</span>
              <span>買量</span>
              <span>買價</span>
              <span>賣價</span>
              <span>賣量</span>
            </div>
            {bidask.map((level) => (
              <div className="row" key={level.level} style={{ gridTemplateColumns: "64px 1fr 1fr 1fr 1fr", gap: 10, padding: "8px 0" }}>
                <span className="tg soft">{level.level}</span>
                <span className="tg up">{level.bidQty}</span>
                <span className="num up">{level.bidPrice}</span>
                <span className="num down">{level.askPrice}</span>
                <span className="tg down">{level.askQty}</span>
              </div>
            ))}
          </Panel>

          <Panel code="QTE-T" title="近 50 筆成交" right="最新在上">
            {ticks.slice(0, 18).map((tick) => (
              <div className="row telex-row" key={tick.id}>
                <span className="tg soft">{tick.ts}</span>
                <span className={`tg ${tick.side === "B" ? "up" : "down"}`}>{tick.side === "B" ? "買" : "賣"}</span>
                <span className="tg">
                  <b>{tick.price}</b> · {tick.qty} 張
                </span>
              </div>
            ))}
          </Panel>
        </div>
      </div>
    </PageFrame>
  );
}
