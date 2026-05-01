"use client";

import { useEffect, useState } from "react";

import {
  getCompanyChips,
  type CompanyChipsData,
} from "@/lib/api";

type ChipsState =
  | { status: "loading" }
  | { status: "blocked"; reason: string; fetchedAt: string }
  | { status: "empty"; reason: string; fetchedAt: string }
  | { status: "live"; data: CompanyChipsData; fetchedAt: string };

function formatTime(value: string) {
  return new Date(value).toLocaleString("zh-TW", { hour12: false });
}

function statusLabel(status: ChipsState["status"]) {
  if (status === "live") return "正常";
  if (status === "empty") return "無資料";
  if (status === "loading") return "讀取中";
  return "暫停";
}

function formatLots(value: number) {
  const signed = value >= 0 ? `+${value.toLocaleString("zh-TW")}` : value.toLocaleString("zh-TW");
  return `${signed} 張`;
}

function NetRow({ label, value }: { label: string; value: number }) {
  const cls = value > 0 ? "badge-green" : value < 0 ? "badge-red" : "badge";
  return (
    <div className="market-intel-button market-intel-static" style={{ gridTemplateColumns: "1fr auto" }}>
      <span className="tg" style={{ color: "var(--night-ink)" }}>{label}</span>
      <span className={cls} style={{ fontSize: 11 }}>{formatLots(value)}</span>
    </div>
  );
}

function BalanceRow({ label, value }: { label: string; value: { balance: number; change: number } | null }) {
  if (!value) return null;
  const tone = value.change > 0 ? "up" : value.change < 0 ? "down" : "muted";
  return (
    <div className="market-intel-button market-intel-static" style={{ gridTemplateColumns: "1fr auto auto" }}>
      <span className="tg" style={{ color: "var(--night-ink)" }}>{label}</span>
      <span className="num">{value.balance.toLocaleString("zh-TW")}</span>
      <span className={`num ${tone}`}>{value.change >= 0 ? "+" : ""}{value.change.toLocaleString("zh-TW")}</span>
    </div>
  );
}

function StatePanel({ state }: { state: Exclude<ChipsState, { status: "live" | "loading" }> }) {
  const badge = state.status === "blocked" ? "badge-red" : "badge-yellow";
  return (
    <div className="state-panel">
      <span className={`badge ${badge}`}>{statusLabel(state.status)}</span>
      <span className="tg soft">來源：FinMind 籌碼 / 融資券</span>
      <span className="tg soft">更新 {formatTime(state.fetchedAt)}</span>
      <span className="state-reason">{state.reason}</span>
    </div>
  );
}

export function ChipsPanel({ companyId }: { companyId: string }) {
  const [state, setState] = useState<ChipsState>({ status: "loading" });

  useEffect(() => {
    let active = true;

    getCompanyChips(companyId, { days: 30 })
      .then((response) => {
        if (!active) return;
        const fetchedAt = new Date().toISOString();
        const data = response.data;
        const hasInstitutional = data.foreign.net30d !== 0 || data.trust.net30d !== 0 || data.dealer.net30d !== 0;
        const hasBalances = Boolean(data.margin || data.short);
        setState(hasInstitutional || hasBalances
          ? { status: "live", data, fetchedAt }
          : {
              status: "empty",
              fetchedAt,
              reason: "近 30 天沒有外資、投信、自營商、融資或融券資料列。",
            });
      })
      .catch((error) => {
        if (!active) return;
        setState({
          status: "blocked",
          fetchedAt: new Date().toISOString(),
          reason: error instanceof Error ? error.message : "籌碼資料讀取失敗",
        });
      });

    return () => {
      active = false;
    };
  }, [companyId]);

  return (
    <section className="panel hud-frame">
      <h3 className="ascii-head">
        <span className="ascii-head-bracket">[04]</span> 籌碼流向
        <span className="dim" style={{ fontSize: 10, marginLeft: 8 }}>FinMind 三大法人 / 融資券</span>
      </h3>

      {state.status === "loading" && (
        <div className="state-panel">
          <span className="badge badge-blue">讀取中</span>
          <span className="tg soft">正在讀取三大法人、融資與融券資料。</span>
        </div>
      )}

      {state.status === "blocked" || state.status === "empty" ? <StatePanel state={state} /> : null}

      {state.status === "live" && (
        <div className="market-intel-list">
          <div className="source-line">
            <span className="badge badge-green">正常</span>
            <span className="tg soft">來源：FinMind 籌碼 / 融資券</span>
            <span className="tg soft">更新 {formatTime(state.fetchedAt)}</span>
          </div>
          <NetRow label="外資近 30 日買賣超" value={state.data.foreign.net30d} />
          <NetRow label="投信近 30 日買賣超" value={state.data.trust.net30d} />
          <NetRow label="自營商近 30 日買賣超" value={state.data.dealer.net30d} />
          <BalanceRow label="融資餘額" value={state.data.margin} />
          <BalanceRow label="融券餘額" value={state.data.short} />
        </div>
      )}
    </section>
  );
}
