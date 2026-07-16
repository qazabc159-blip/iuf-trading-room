"use client";

import { useCallback, useEffect, useState } from "react";
import { getKgiTicks, type KgiTickEntry } from "@/lib/api";
import { isKgiTradingHours, kgiNextOpenLabel } from "@/lib/kgi-trading-hours";

const POLL_MS = 5_000;
const MAX_TICKS = 20;

type TickStreamState =
  | { status: "loading" }
  | { status: "closed"; reason: string }
  | { status: "waiting"; reason: string }
  | { status: "blocked"; reason: string }
  | { status: "live"; ticks: KgiTickEntry[]; updatedAt: string };

const TICK_CSS = `
._ts-panel { font-family: var(--mono); }
/* See BidAskPanel.tsx LIVE_CSS for the same fix — .state-panel default
   padding is sized for full-width empty pages. */
._ts-panel .state-panel { padding: 10px 0 0; gap: 6px 10px; }
._ts-panel .state-reason { font-size: 11px; line-height: 1.6; }
._ts-live-badge {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 10px; color: var(--tac-ok, #4ade80); letter-spacing: 0.05em;
}
._ts-live-ring {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--tac-ok, #4ade80);
  animation: _ts-pulse 2s ease-in-out infinite;
}
@keyframes _ts-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(1.35); }
}
._ts-tape {
  display: flex; flex-direction: column; gap: 1px;
  max-height: 280px; overflow-y: auto;
  margin-top: 8px;
  scrollbar-width: thin;
  scrollbar-color: rgba(226,184,92,0.2) transparent;
}
._ts-row {
  display: grid;
  grid-template-columns: 58px 1fr 1fr 60px;
  gap: 4px;
  padding: 3px 6px;
  font-size: 11px;
  border-bottom: 1px solid rgba(220,228,240,0.04);
  align-items: center;
  transition: background 0.12s;
}
._ts-row:hover { background: rgba(226,184,92,0.04); }
._ts-time { color: var(--night-mid, #91a0b5); font-size: 10px; }
._ts-price-up { color: var(--tw-up-bright, #e63946); font-weight: 700; font-variant-numeric: tabular-nums; }
._ts-price-dn { color: var(--tac-ok, #4ade80); font-weight: 700; font-variant-numeric: tabular-nums; }
._ts-price-flat { color: var(--night-ink, #e7ecf3); font-weight: 600; font-variant-numeric: tabular-nums; }
._ts-vol { color: var(--night-mid, #91a0b5); text-align: right; font-variant-numeric: tabular-nums; }
._ts-side-buy { color: var(--tw-up-bright, #e63946); font-size: 9.5px; text-align: right; }
._ts-side-sell { color: var(--tac-ok, #4ade80); font-size: 9.5px; text-align: right; }
._ts-side-flat { color: var(--night-mid, #91a0b5); font-size: 9.5px; text-align: right; }
._ts-header {
  display: grid;
  grid-template-columns: 58px 1fr 1fr 60px;
  gap: 4px;
  padding: 2px 6px 4px;
  font-size: 9.5px;
  color: var(--night-mid, #91a0b5);
  letter-spacing: 0.05em;
  border-bottom: 1px solid rgba(220,228,240,0.08);
}
@media (prefers-reduced-motion: reduce) {
  ._ts-live-ring { animation: none; }
  ._ts-row { transition: none; }
}
`;

function tickTime(dt: string | null | undefined): string {
  if (!dt) return "--:--:--";
  const date = new Date(dt);
  if (Number.isNaN(date.getTime())) return "--:--:--";
  return date.toLocaleTimeString("zh-TW", { hour12: false });
}

function chgTypeLabel(chgType: number | null | undefined): { cls: string; label: string } {
  if (chgType === 1) return { cls: "_ts-side-buy", label: "買盤" };
  if (chgType === 3) return { cls: "_ts-side-sell", label: "賣盤" };
  return { cls: "_ts-side-flat", label: "-" };
}

function priceClass(chgType: number | null | undefined): string {
  if (chgType === 1) return "_ts-price-up";
  if (chgType === 3) return "_ts-price-dn";
  return "_ts-price-flat";
}

function blockedReason(error: unknown) {
  const msg = error instanceof Error ? error.message : String(error);
  if (/KGI_QUOTE_AUTH_UNAVAILABLE|QUOTE_AUTH_UNAVAILABLE/i.test(msg)) {
    return "KGI SIM 尚未提供唯讀逐筆 token；目前不顯示假逐筆。";
  }
  if (/SYMBOL_NOT_ALLOWED/i.test(msg)) return "此股票尚未訂閱 KGI 唯讀逐筆；訂閱完成後會自動回到 LIVE。";
  if (/GATEWAY_UNREACHABLE|unreachable/i.test(msg)) return "KGI 唯讀逐筆閘道暫時無法連線，稍後會自動重試。";
  if (/QUOTE_DISABLED/i.test(msg)) return "KGI 唯讀逐筆目前被後端暫停，避免顯示錯誤成交。";
  if (/GATEWAY_AUTH/i.test(msg)) return "KGI 唯讀逐筆授權尚未通過，暫不顯示逐筆。";
  return `逐筆成交暫時無法讀取：${msg.slice(0, 80)}`;
}

function offHoursReason() {
  return `盤後・逐筆行情開盤 ${kgiNextOpenLabel()} 起提供，盤中自動回到 LIVE。`;
}

export function LiveTickStreamPanel({ symbol }: { symbol: string }) {
  const [state, setState] = useState<TickStreamState>({ status: "loading" });

  const fetchData = useCallback(async () => {
    if (!isKgiTradingHours()) {
      setState({ status: "closed", reason: offHoursReason() });
      return;
    }
    try {
      const result = await getKgiTicks(symbol, MAX_TICKS);
      if (!result || result.ticks.length === 0) {
        setState({ status: "waiting", reason: "KGI 唯讀逐筆目前尚未回傳有效成交明細，系統會持續輪詢；這不是系統故障。" });
        return;
      }
      setState({ status: "live", ticks: result.ticks, updatedAt: new Date().toLocaleTimeString("zh-TW", { hour12: false }) });
    } catch (err) {
      setState({ status: "blocked", reason: blockedReason(err) });
    }
  }, [symbol]);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, isKgiTradingHours() ? POLL_MS : 60_000);
    return () => clearInterval(id);
  }, [fetchData]);

  // 2026-07-17 empty-state collapse: closed/waiting/blocked all mean "no tick
  // stream to show right now"（同 BidAskPanel 規則，見同檔 comment）。
  if (state.status === "closed" || state.status === "waiting" || state.status === "blocked") {
    return null;
  }

  return (
    <section className="panel hud-frame _ts-panel" style={{ marginBottom: 12 }}>
      <style>{TICK_CSS}</style>
      <h3 className="ascii-head" style={{ marginBottom: 6 }}>
        <span className="ascii-head-bracket">逐筆</span> 即時成交
        {state.status === "live" && (
          <span className="_ts-live-badge" style={{ marginLeft: 10 }}>
            <span className="_ts-live-ring" />
            LIVE / {state.updatedAt}
          </span>
        )}
        {state.status === "loading" && (
          <span className="dim" style={{ fontSize: 10, marginLeft: 8 }}>讀取中</span>
        )}
        <span className="dim" style={{ fontSize: 9.5, marginLeft: 8 }}>最近 {MAX_TICKS} 筆 / 5s 更新</span>
      </h3>

      {state.status === "loading" && (
        <div className="state-panel">
          <span className="badge badge-blue">讀取中</span>
          <span className="tg soft">正在讀取 KGI 唯讀逐筆成交。</span>
        </div>
      )}

      {state.status === "live" && (
        <>
          <div className="_ts-header">
            <span>時間</span>
            <span>成交價</span>
            <span>量</span>
            <span style={{ textAlign: "right" }}>方向</span>
          </div>
          <div className="_ts-tape">
            {state.ticks.map((tick, i) => {
              const { cls, label } = chgTypeLabel(tick.chg_type);
              return (
                <div key={i} className="_ts-row">
                  <span className="_ts-time">{tickTime(tick.datetime ?? tick._received_at)}</span>
                  <span className={priceClass(tick.chg_type)}>
                    {tick.close != null ? tick.close.toFixed(2) : "--"}
                  </span>
                  <span className="_ts-vol">
                    {tick.volume != null ? tick.volume.toLocaleString("zh-TW") : "--"}
                  </span>
                  <span className={cls}>{label}</span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
