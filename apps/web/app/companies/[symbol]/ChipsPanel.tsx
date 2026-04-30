"use client";

// ChipsPanel.tsx — Client Component
// Fetches /api/v1/companies/:id/chips?days=30
// Three major institutional buy/sell (外資/投信/自營) + margin/short balance.
// Falls back to placeholder when API not yet integrated.

import { useEffect, useState } from "react";

interface ChipsData {
  foreign: { net30d: number };
  trust: { net30d: number };
  dealer: { net30d: number };
  margin: { balance: number; change: number } | null;
  short: { balance: number; change: number } | null;
}

type ChipsState =
  | { status: "loading" }
  | { status: "not_integrated" }
  | { status: "error"; message: string }
  | { status: "ok"; data: ChipsData };

const API_BASE =
  typeof window !== "undefined"
    ? (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001")
    : "http://localhost:3001";

async function fetchChips(companyId: string): Promise<ChipsState> {
  try {
    const res = await fetch(
      `${API_BASE}/api/v1/companies/${companyId}/chips?days=30`,
      { credentials: "include" }
    );
    if (res.status === 404) return { status: "not_integrated" };
    if (!res.ok) return { status: "error", message: `HTTP ${res.status}` };
    const json = await res.json() as { data: ChipsData };
    return { status: "ok", data: json.data };
  } catch (e) {
    return { status: "error", message: e instanceof Error ? e.message : "fetch error" };
  }
}

function netBadge(val: number) {
  const formatted = val >= 0 ? `+${val.toLocaleString()}` : val.toLocaleString();
  const cls = val > 0 ? "badge-green" : val < 0 ? "badge-red" : "badge";
  return <span className={cls} style={{ fontSize: 11, padding: "2px 8px" }}>{formatted} 張</span>;
}

function NetRow({ label, net30d }: { label: string; net30d: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--night-rule, #222)" }}>
      <span className="tg" style={{ fontSize: 12 }}>{label}</span>
      <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
        {netBadge(net30d)}
        <span className="dim" style={{ fontSize: 10 }}>30D 累計</span>
      </span>
    </div>
  );
}

export function ChipsPanel({ companyId }: { companyId: string }) {
  const [state, setState] = useState<ChipsState>({ status: "loading" });

  useEffect(() => {
    fetchChips(companyId).then(setState);
  }, [companyId]);

  return (
    <section className="panel hud-frame">
      <h3 className="ascii-head">
        <span className="ascii-head-bracket">[04]</span> 籌碼分析
      </h3>

      {state.status === "loading" && (
        <div className="dim" style={{ padding: "16px 0", fontFamily: "var(--mono)", fontSize: 11 }}>LOADING…</div>
      )}

      {(state.status === "not_integrated" || state.status === "error") && (
        <div style={{ padding: "16px 0" }}>
          <span className="badge-yellow" style={{ fontSize: 11 }}>籌碼資料整合中</span>
          <div className="dim" style={{ marginTop: 8, fontFamily: "var(--mono)", fontSize: 11 }}>
            {state.status === "error" ? state.message : "等待 /api/v1/companies/:id/chips 接通"}
          </div>
        </div>
      )}

      {state.status === "ok" && (
        <div style={{ marginTop: 8 }}>
          <div className="tg" style={{ fontSize: 10, color: "var(--night-mid, #888)", marginBottom: 6, letterSpacing: "0.12em" }}>
            三大法人買賣超 (30日累計)
          </div>
          <NetRow label="外資" net30d={state.data.foreign.net30d} />
          <NetRow label="投信" net30d={state.data.trust.net30d} />
          <NetRow label="自營" net30d={state.data.dealer.net30d} />

          {(state.data.margin || state.data.short) && (
            <div style={{ marginTop: 12 }}>
              <div className="tg" style={{ fontSize: 10, color: "var(--night-mid, #888)", marginBottom: 6, letterSpacing: "0.12em" }}>
                信用交易
              </div>
              {state.data.margin && (
                <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--night-rule, #222)" }}>
                  <span className="tg" style={{ fontSize: 12 }}>融資餘額</span>
                  <span style={{ textAlign: "right" }}>
                    <div style={{ fontFamily: "var(--mono)", fontSize: 13 }}>{state.data.margin.balance.toLocaleString()} 張</div>
                    <div style={{ fontSize: 11, color: state.data.margin.change >= 0 ? "var(--tw-up-bright)" : "var(--tw-dn-bright)" }}>
                      {state.data.margin.change >= 0 ? "+" : ""}{state.data.margin.change.toLocaleString()}
                    </div>
                  </span>
                </div>
              )}
              {state.data.short && (
                <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--night-rule, #222)" }}>
                  <span className="tg" style={{ fontSize: 12 }}>融券餘額</span>
                  <span style={{ textAlign: "right" }}>
                    <div style={{ fontFamily: "var(--mono)", fontSize: 13 }}>{state.data.short.balance.toLocaleString()} 張</div>
                    <div style={{ fontSize: 11, color: state.data.short.change >= 0 ? "var(--tw-up-bright)" : "var(--tw-dn-bright)" }}>
                      {state.data.short.change >= 0 ? "+" : ""}{state.data.short.change.toLocaleString()}
                    </div>
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
