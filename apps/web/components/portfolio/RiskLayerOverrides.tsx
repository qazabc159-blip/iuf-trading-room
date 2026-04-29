"use client";
/**
 * RiskLayerOverrides — strategy / symbol tabs with inline upsert/delete.
 *
 * null in any numeric column = "inherit from layer above" (rendered as «·»).
 * For the mock backend, edits are local-only (state); when backend wired,
 * pipe through api.upsertStrategyLimit / api.upsertSymbolLimit.
 */
import { useState } from "react";
import type { StrategyRiskLimit, SymbolRiskLimit } from "@/lib/radar-types";

type AnyOverride = StrategyRiskLimit | SymbolRiskLimit;
type OverridePatch = Partial<Omit<AnyOverride, "scope">>;
type Tab = "strategy" | "symbol";

const COLS: { key: keyof Omit<AnyOverride, "id" | "scope" | "scopeKey" | "updatedAt" | "note">; label: string; format: (n: number) => string }[] = [
  { key: "maxPerTrade",   label: "MAX·TRADE", format: n => n.toLocaleString() },
  { key: "dailyPnl",      label: "DAILY·PNL", format: n => n.toLocaleString() },
  { key: "singlePosPct",  label: "SINGLE %",  format: n => `${(n * 100).toFixed(1)}%` },
  { key: "themePosPct",   label: "THEME %",   format: n => `${(n * 100).toFixed(1)}%` },
  { key: "grossPosPct",   label: "GROSS %",   format: n => `${(n * 100).toFixed(1)}%` },
];

export function RiskLayerOverrides({
  strategy, symbol,
}: { strategy: StrategyRiskLimit[]; symbol: SymbolRiskLimit[] }) {
  const [tab, setTab] = useState<Tab>("strategy");
  const [stratState, setStratState] = useState(strategy);
  const [symState, setSymState] = useState(symbol);
  const rows: AnyOverride[] = tab === "strategy" ? stratState : symState;

  const updateRow = (id: string, patch: OverridePatch) => {
    if (tab === "strategy") setStratState(s => s.map(r => r.id === id ? { ...r, ...patch } : r));
    else setSymState(s => s.map(r => r.id === id ? { ...r, ...patch } : r));
  };
  const removeRow = (id: string) => {
    if (tab === "strategy") setStratState(s => s.filter(r => r.id !== id));
    else setSymState(s => s.filter(r => r.id !== id));
  };
  const addRow = () => {
    const newRow = {
      id: `NEW-${Date.now().toString(36)}`,
      scopeKey: tab === "strategy" ? "NEW·STRAT" : "0000",
      maxPerTrade: null, dailyPnl: null, singlePosPct: null,
      themePosPct: null, grossPosPct: null,
      updatedAt: new Date().toISOString(),
    };
    if (tab === "strategy") setStratState(s => [...s, { ...newRow, scope: "strategy" } as StrategyRiskLimit]);
    else setSymState(s => [...s, { ...newRow, scope: "symbol" } as SymbolRiskLimit]);
  };

  return (
    <div>
      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: "1px solid var(--exec-rule-strong)", marginBottom: 8 }}>
        {(["strategy", "symbol"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: "10px 16px", background: "transparent", border: "none",
            borderBottom: tab === t ? "2px solid var(--gold)" : "2px solid transparent",
            color: tab === t ? "var(--gold-bright)" : "var(--exec-mid)",
            fontFamily: "var(--mono)", letterSpacing: "0.22em", fontWeight: 700, cursor: "pointer",
          }}>{t.toUpperCase()} · {t === "strategy" ? stratState.length : symState.length}</button>
        ))}
        <button onClick={addRow} style={{
          marginLeft: "auto", padding: "10px 16px", background: "transparent",
          border: "none", color: "var(--gold)", fontFamily: "var(--mono)",
          letterSpacing: "0.22em", fontWeight: 700, cursor: "pointer", fontSize: 11,
        }}>+ ADD OVERRIDE</button>
      </div>

      {/* Header */}
      <div style={{
        display: "grid", gridTemplateColumns: "120px repeat(5, 1fr) 80px",
        gap: 8, padding: "6px 4px", borderBottom: "1px solid var(--exec-rule-strong)",
        color: "var(--exec-mid)", fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.18em",
      }}>
        <span>{tab === "strategy" ? "STRATEGY" : "SYMBOL"}</span>
        {COLS.map(c => <span key={c.key} style={{ textAlign: "right" }}>{c.label}</span>)}
        <span style={{ textAlign: "right" }}>·</span>
      </div>

      {/* Rows */}
      {rows.map(r => (
        <div key={r.id} style={{
          display: "grid", gridTemplateColumns: "120px repeat(5, 1fr) 80px",
          gap: 8, padding: "8px 4px", borderBottom: "1px solid var(--exec-rule)",
          fontFamily: "var(--mono)", fontSize: 11.5, alignItems: "center",
        }}>
          <input
            value={r.scopeKey}
            onChange={e => updateRow(r.id, { scopeKey: e.target.value })}
            style={{
              background: "transparent", border: "1px solid var(--exec-rule)",
              color: "var(--gold)", fontFamily: "var(--mono)", fontWeight: 700, fontSize: 12,
              padding: "4px 6px", outline: "none",
            }}
          />
          {COLS.map(c => {
            const val = r[c.key] as number | null;
            return (
              <input
                key={c.key}
                value={val === null ? "" : val}
                placeholder="·"
                onChange={e => {
                  const v = e.target.value === "" ? null : Number(e.target.value);
                  updateRow(r.id, { [c.key]: v } as OverridePatch);
                }}
                style={{
                  background: "transparent", border: "1px solid var(--exec-rule)",
                  color: val === null ? "var(--exec-soft)" : "var(--exec-ink)",
                  fontFamily: "var(--mono)", fontSize: 11.5, padding: "4px 6px",
                  textAlign: "right", outline: "none",
                  fontFeatureSettings: '"tnum","lnum"',
                }}
              />
            );
          })}
          <button onClick={() => removeRow(r.id)} style={{
            background: "transparent", border: "none",
            color: "var(--tw-up-bright)", fontFamily: "var(--mono)",
            fontSize: 10, letterSpacing: "0.18em", cursor: "pointer", textAlign: "right",
          }}>✕ DELETE</button>
        </div>
      ))}
      <div style={{ marginTop: 8, color: "var(--exec-soft)", fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.16em" }}>
        · 任一欄空白 = 繼承上一層 · ACCT → STRAT → SYM → SESS
      </div>
    </div>
  );
}
