"use client";

import { useCallback, useEffect, useState } from "react";

// Phase 2 broker connection manager. Gateway model: NO credentials are entered or
// stored here — a connection is just an account reference/label pointing at the
// customer-side gateway. Real Order stays locked; this only registers connections.

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";
const WORKSPACE_SLUG = process.env.NEXT_PUBLIC_DEFAULT_WORKSPACE_SLUG ?? "primary-desk";

type Connection = {
  id: string;
  adapterKey: string;
  displayName: string;
  accountRef: string;
  accountLabel: string;
  isPrimary: boolean;
  status: string;
};

const CONNECTABLE = [
  { key: "kgi", label: "凱基 KGI" },
  { key: "paper", label: "模擬 Paper" },
];

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", "x-workspace-slug": WORKSPACE_SLUG, ...(init?.headers || {}) },
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error((json && (json.error || json.message)) || `api_${res.status}`);
  return json;
}

export function BrokerConnections() {
  const [conns, setConns] = useState<Connection[] | null>(null);
  const [adapterKey, setAdapterKey] = useState("kgi");
  const [accountRef, setAccountRef] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const j = await api("/api/v1/uta/accounts");
      setConns((j?.data as Connection[]) ?? []);
    } catch {
      setErr("無法讀取連線清單，請稍後再試。");
      setConns([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const connect = async () => {
    if (!accountRef.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await api("/api/v1/uta/accounts", {
        method: "POST",
        body: JSON.stringify({ adapterKey, accountRef: accountRef.trim(), accountLabel: label.trim() }),
      });
      setAccountRef("");
      setLabel("");
      await load();
    } catch {
      setErr("連線失敗，請確認帳號代號是否正確。");
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async (id: string) => {
    setBusy(true);
    setErr(null);
    try {
      await api("/api/v1/uta/accounts/disconnect", { method: "POST", body: JSON.stringify({ id }) });
      await load();
    } catch {
      setErr("斷線失敗，請稍後再試。");
    } finally {
      setBusy(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    background: "rgba(8,8,8,0.6)",
    border: "1px solid rgba(200,148,63,0.28)",
    color: "var(--fg-1, #ddd)",
    padding: "9px 11px",
    fontSize: 13,
    borderRadius: 4,
  };

  return (
    <section
      style={{
        border: "1px solid rgba(200,148,63,0.22)",
        background: "linear-gradient(180deg, rgba(18,18,18,0.96), rgba(8,8,8,0.98))",
        padding: 20,
        marginBottom: 22,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>我的券商連線</h2>
        <span style={{ color: "var(--fg-3, #8a93a3)", fontSize: 12 }}>不在此頁輸入帳密；憑證留在你的安全環境</span>
      </div>

      {/* Connected list */}
      <div style={{ display: "grid", gap: 8, marginBottom: 16 }}>
        {conns === null ? (
          <div style={{ color: "var(--fg-3, #8a93a3)", fontSize: 13 }}>讀取中…</div>
        ) : conns.length === 0 ? (
          <div style={{ color: "var(--fg-3, #8a93a3)", fontSize: 13 }}>尚未連線任何券商。在下方加入一個連線。</div>
        ) : (
          conns.map((c) => (
            <div
              key={c.id}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                border: "1px solid rgba(52,211,153,0.22)",
                background: "rgba(52,211,153,0.045)",
                padding: "11px 13px",
                borderRadius: 5,
              }}
            >
              <div style={{ minWidth: 0 }}>
                <b>{c.displayName}</b>
                <span style={{ color: "var(--fg-3, #8a93a3)", fontSize: 12, marginLeft: 8 }}>
                  {c.accountLabel}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ color: c.status === "connected" ? "#34d399" : "#8a93a3", fontSize: 12, fontWeight: 900 }}>
                  {c.status === "connected" ? "已連線 · SIM" : "已停用"}
                </span>
                <button
                  type="button"
                  onClick={() => disconnect(c.id)}
                  disabled={busy}
                  style={{
                    border: "1px solid rgba(248,113,113,0.4)",
                    background: "transparent",
                    color: "#f87171",
                    padding: "5px 11px",
                    fontSize: 12,
                    borderRadius: 4,
                    cursor: busy ? "default" : "pointer",
                  }}
                >
                  斷線
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Connect form — no credential fields */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <select value={adapterKey} onChange={(e) => setAdapterKey(e.target.value)} style={inputStyle}>
          {CONNECTABLE.map((b) => (
            <option key={b.key} value={b.key}>
              {b.label}
            </option>
          ))}
          <option value="fubon" disabled>
            富邦 Fubon（即將開放）
          </option>
        </select>
        <input
          value={accountRef}
          onChange={(e) => setAccountRef(e.target.value)}
          maxLength={64}
          placeholder="帳號代號（非密碼）"
          style={{ ...inputStyle, flex: "1 1 160px" }}
        />
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          maxLength={64}
          placeholder="顯示名稱（選填）"
          style={{ ...inputStyle, flex: "1 1 140px" }}
        />
        <button
          type="button"
          onClick={connect}
          disabled={busy || !accountRef.trim()}
          style={{
            border: "1px solid rgba(200,148,63,0.5)",
            background: "rgba(200,148,63,0.12)",
            color: "var(--accent, #c8943f)",
            padding: "9px 16px",
            fontSize: 13,
            fontWeight: 700,
            borderRadius: 4,
            cursor: busy || !accountRef.trim() ? "default" : "pointer",
            opacity: busy || !accountRef.trim() ? 0.5 : 1,
          }}
        >
          連線券商
        </button>
      </div>

      {err ? <p style={{ margin: "12px 0 0", color: "#f87171", fontSize: 13 }}>{err}</p> : null}
    </section>
  );
}
