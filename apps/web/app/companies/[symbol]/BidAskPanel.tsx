"use client";

import { useCallback, useEffect, useState } from "react";
import { getKgiBidAsk, type KgiBidAskData } from "@/lib/api";
import { isKgiTradingHours, kgiNextOpenLabel } from "@/lib/kgi-trading-hours";

const POLL_MS = 30_000;

type BidAskState =
  | { status: "loading" }
  | { status: "closed"; reason: string }
  | { status: "blocked"; reason: string }
  | { status: "live"; data: KgiBidAskData; updatedAt: string };

const LIVE_CSS = `
._ba-panel { font-family: var(--mono); }
._ba-live-badge {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 10px; color: var(--tac-ok, #4ade80); letter-spacing: 0.05em;
}
._ba-live-ring {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--tac-ok, #4ade80);
  animation: _ba-pulse 2s ease-in-out infinite;
}
@keyframes _ba-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%       { opacity: 0.5; transform: scale(1.35); }
}
._ba-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11.5px;
  margin-top: 8px;
}
._ba-table th {
  font-size: 9.5px;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: var(--night-mid, #91a0b5);
  text-align: right;
  padding: 2px 6px 4px;
  border-bottom: 1px solid rgba(220,228,240,0.08);
}
._ba-table th:first-child { text-align: left; }
._ba-table td {
  padding: 3px 6px;
  text-align: right;
  font-variant-numeric: tabular-nums;
  border-bottom: 1px solid rgba(220,228,240,0.04);
}
._ba-table td:first-child { text-align: left; color: var(--night-mid,#91a0b5); font-size: 10px; }
._ba-ask { color: var(--tw-up-bright, #e63946); font-weight: 700; }
._ba-bid { color: var(--tac-ok, #4ade80); font-weight: 700; }
._ba-vol { color: var(--night-mid, #91a0b5); }
._ba-mid-row { background: rgba(226,184,92,0.04); }
._ba-mid-label { color: var(--gold-bright, #e2b85c) !important; font-size: 10.5px !important; }
._ba-mid-price { color: var(--gold-bright, #e2b85c) !important; font-weight: 700 !important; }
@media (prefers-reduced-motion: reduce) {
  ._ba-live-ring { animation: none; }
}
`;

function blockedReason(error: unknown) {
  const msg = error instanceof Error ? error.message : String(error);
  if (/KGI_QUOTE_AUTH_UNAVAILABLE|QUOTE_AUTH_UNAVAILABLE/i.test(msg)) {
    return "KGI SIM 已登入，但凱基沒有提供 SIM 行情權限/token；五檔面板降級，不補假委買委賣。";
  }
  if (/SYMBOL_NOT_ALLOWED/i.test(msg)) {
    return "此股票尚未列入唯讀五檔行情覆蓋清單；不顯示假委買委賣。";
  }
  if (/GATEWAY_UNREACHABLE|unreachable/i.test(msg)) {
    return "KGI 唯讀行情暫時無法連線；請稍後再讀取。";
  }
  if (/QUOTE_DISABLED/i.test(msg)) {
    return "KGI 唯讀行情目前停用；正式委託路徑仍保持封鎖。";
  }
  if (/GATEWAY_AUTH/i.test(msg)) {
    return "KGI 唯讀行情憑證暫時失效；此面板保持降級，不顯示假資料。";
  }
  return `五檔報價暫時無法讀取：${msg.slice(0, 80)}`;
}

function offHoursReason() {
  return `目前為盤外/休市時段，KGI 唯讀五檔不會回傳即時委買委賣；下一次讀取窗口：${kgiNextOpenLabel()}。`;
}

export function BidAskPanel({ symbol }: { symbol: string }) {
  const [state, setState] = useState<BidAskState>({ status: "loading" });

  const fetchData = useCallback(async () => {
    if (!isKgiTradingHours()) {
      setState({ status: "closed", reason: offHoursReason() });
      return;
    }
    try {
      const data = await getKgiBidAsk(symbol);
      if (!data) {
        setState({ status: "blocked", reason: "KGI 唯讀五檔資料暫時無回傳；不顯示假委買委賣。" });
        return;
      }
      setState({ status: "live", data, updatedAt: new Date().toLocaleTimeString("zh-TW", { hour12: false }) });
    } catch (err) {
      setState({ status: "blocked", reason: blockedReason(err) });
    }
  }, [symbol]);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, isKgiTradingHours() ? POLL_MS : 60_000);
    return () => clearInterval(id);
  }, [fetchData]);

  const bidPrices = state.status === "live" ? (state.data.bid_prices ?? []) : [];
  const bidVolumes = state.status === "live" ? (state.data.bid_volumes ?? []) : [];
  const askPrices = state.status === "live" ? (state.data.ask_prices ?? []) : [];
  const askVolumes = state.status === "live" ? (state.data.ask_volumes ?? []) : [];
  const bestAsk = askPrices[0] ?? null;
  const bestBid = bidPrices[0] ?? null;
  const midPrice = bestAsk != null && bestBid != null ? ((bestAsk + bestBid) / 2).toFixed(2) : null;

  return (
    <section className="panel hud-frame _ba-panel" style={{ marginBottom: 12 }}>
      <style>{LIVE_CSS}</style>
      <h3 className="ascii-head" style={{ marginBottom: 6 }}>
        <span className="ascii-head-bracket">五檔</span> 委買委賣
        {state.status === "live" && (
          <span className="_ba-live-badge" style={{ marginLeft: 10 }}>
            <span className="_ba-live-ring" />
            LIVE 於 {state.updatedAt}
          </span>
        )}
        {state.status === "loading" && (
          <span className="dim" style={{ fontSize: 10, marginLeft: 8 }}>讀取中</span>
        )}
      </h3>

      {state.status === "closed" && (
        <div className="state-panel">
          <span className="badge badge-yellow">休市</span>
          <span className="tg soft">資料源：KGI 唯讀五檔</span>
          <span className="state-reason">{state.reason} 這不是系統故障；正式五檔只在盤中顯示，不使用假委買委賣補畫。</span>
        </div>
      )}

      {state.status === "blocked" && (
        <div className="state-panel">
          <span className="badge badge-red">BLOCKED</span>
          <span className="tg soft">資料源：KGI 唯讀五檔</span>
          <span className="state-reason">{state.reason}</span>
        </div>
      )}

      {state.status === "loading" && (
        <div className="state-panel">
          <span className="badge badge-blue">讀取中</span>
          <span className="tg soft">正在讀取 KGI 唯讀五檔資料。</span>
        </div>
      )}

      {state.status === "live" && (
        <table className="_ba-table">
          <thead>
            <tr>
              <th>檔位</th>
              <th>賣量</th>
              <th>賣價</th>
              <th>買價</th>
              <th>買量</th>
            </tr>
          </thead>
          <tbody>
            {[0, 1, 2, 3, 4].map((i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td className="_ba-vol">{askVolumes[i] != null ? askVolumes[i].toLocaleString("zh-TW") : "--"}</td>
                <td className="_ba-ask">{askPrices[i] != null ? askPrices[i].toFixed(2) : "--"}</td>
                <td className="_ba-bid">{bidPrices[i] != null ? bidPrices[i].toFixed(2) : "--"}</td>
                <td className="_ba-vol">{bidVolumes[i] != null ? bidVolumes[i].toLocaleString("zh-TW") : "--"}</td>
              </tr>
            ))}
            {midPrice != null && (
              <tr className="_ba-mid-row">
                <td className="_ba-mid-label">中間價</td>
                <td colSpan={4} className="_ba-mid-price" style={{ textAlign: "center" }}>{midPrice}</td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </section>
  );
}
