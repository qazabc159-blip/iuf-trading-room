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

function formatLots(value: number) {
  const signed = value >= 0 ? `+${value.toLocaleString()}` : value.toLocaleString();
  return `${signed} lots`;
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
      <span className="num">{value.balance.toLocaleString()}</span>
      <span className={`num ${tone}`}>{value.change >= 0 ? "+" : ""}{value.change.toLocaleString()}</span>
    </div>
  );
}

function StatePanel({ state }: { state: Exclude<ChipsState, { status: "live" | "loading" }> }) {
  const badge = state.status === "blocked" ? "badge-red" : "badge-yellow";
  return (
    <div className="state-panel">
      <span className={`badge ${badge}`}>{state.status.toUpperCase()}</span>
      <span className="tg soft">Source: GET /api/v1/companies/:id/chips?days=30</span>
      <span className="tg soft">Updated {formatTime(state.fetchedAt)}</span>
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
              reason: "FinMind returned zero institutional, margin, and short rows for the last 30 days.",
            });
      })
      .catch((error) => {
        if (!active) return;
        setState({
          status: "blocked",
          fetchedAt: new Date().toISOString(),
          reason: error instanceof Error ? error.message : "chips request failed",
        });
      });

    return () => {
      active = false;
    };
  }, [companyId]);

  return (
    <section className="panel hud-frame">
      <h3 className="ascii-head">
        <span className="ascii-head-bracket">[04]</span> FLOWS
        <span className="dim" style={{ fontSize: 10, marginLeft: 8 }}>FinMind institutional + margin</span>
      </h3>

      {state.status === "loading" && (
        <div className="state-panel">
          <span className="badge badge-blue">LOADING</span>
          <span className="tg soft">Fetching FinMind institutional, margin, and short data.</span>
        </div>
      )}

      {state.status === "blocked" || state.status === "empty" ? <StatePanel state={state} /> : null}

      {state.status === "live" && (
        <div className="market-intel-list">
          <div className="source-line">
            <span className="badge badge-green">LIVE</span>
            <span className="tg soft">Source: GET /api/v1/companies/:id/chips?days=30</span>
            <span className="tg soft">Updated {formatTime(state.fetchedAt)}</span>
          </div>
          <NetRow label="Foreign investors net 30D" value={state.data.foreign.net30d} />
          <NetRow label="Investment trust net 30D" value={state.data.trust.net30d} />
          <NetRow label="Dealer net 30D" value={state.data.dealer.net30d} />
          <BalanceRow label="Margin balance" value={state.data.margin} />
          <BalanceRow label="Short balance" value={state.data.short} />
        </div>
      )}
    </section>
  );
}
