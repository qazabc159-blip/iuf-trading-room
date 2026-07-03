"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { Check, Clipboard, KeyRound, RefreshCw, ShieldCheck, Unplug } from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";
const WORKSPACE_SLUG = process.env.NEXT_PUBLIC_DEFAULT_WORKSPACE_SLUG ?? "primary-desk";

type GatewayStatus = "unpaired" | "pending" | "paired_unreachable" | "reachable";

type Connection = {
  id: string;
  adapterKey: string;
  displayName: string;
  accountRef: string;
  accountLabel: string;
  isPrimary: boolean;
  status: string;
  gatewayStatus?: GatewayStatus | string | null;
  lastHeartbeatAt?: string | null;
};

type ApiEnvelope<T> = {
  data?: T;
  ok?: boolean;
  error?: string;
  message?: string;
};

type PairTokenResponse = {
  pairingToken?: string;
  expiresAt?: string;
};

type PairingTokenState = {
  token: string;
  expiresAt: string;
  copied: boolean;
};

const CONNECTABLE = [
  { key: "kgi", label: "凱基 KGI" },
  { key: "paper", label: "模擬 Paper" },
];

const dateTimeFormatter = new Intl.DateTimeFormat("zh-TW", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

async function api<T>(path: string, init?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", "x-workspace-slug": WORKSPACE_SLUG, ...(init?.headers || {}) },
  });
  const json = (await res.json().catch(() => null)) as ApiEnvelope<T> | null;
  if (!res.ok) throw new Error((json && (json.error || json.message)) || "request_failed");
  return json ?? {};
}

function normalizeGatewayStatus(status: Connection["gatewayStatus"]): GatewayStatus {
  if (status === "pending" || status === "paired_unreachable" || status === "reachable") return status;
  return "unpaired";
}

function formatDateTime(iso: string | null | undefined) {
  if (!iso) return "尚未收到心跳";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "尚未收到心跳";
  return dateTimeFormatter.format(date);
}

function formatCountdown(ms: number) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function gatewayBadge(status: GatewayStatus, connection: Connection, deadline: string | undefined, nowMs: number) {
  if (status === "reachable") {
    return {
      label: "已連線",
      detail: `最後心跳 ${formatDateTime(connection.lastHeartbeatAt)}`,
      color: "#34d399",
      border: "rgba(52,211,153,0.32)",
      background: "rgba(52,211,153,0.10)",
    };
  }

  if (status === "pending") {
    const expiresAtMs = deadline ? Date.parse(deadline) : NaN;
    const detail = Number.isFinite(expiresAtMs)
      ? `剩餘 ${formatCountdown(expiresAtMs - nowMs)}`
      : "配對碼有效 15 分鐘，若需倒數請重新產生";
    return {
      label: "等待配對",
      detail,
      color: "#fbbf24",
      border: "rgba(251,191,36,0.34)",
      background: "rgba(251,191,36,0.10)",
    };
  }

  if (status === "paired_unreachable") {
    return {
      label: "等待連線",
      detail: `最後心跳 ${formatDateTime(connection.lastHeartbeatAt)}`,
      color: "#fbbf24",
      border: "rgba(251,191,36,0.34)",
      background: "rgba(251,191,36,0.10)",
    };
  }

  return {
    label: "未配對",
    detail: "尚未產生本機連線配對碼",
    color: "#9ca3af",
    border: "rgba(156,163,175,0.26)",
    background: "rgba(156,163,175,0.08)",
  };
}

function removeEntry<T>(prev: Record<string, T>, id: string) {
  const next = { ...prev };
  delete next[id];
  return next;
}

// ── C-4 信任卡：狀態白話對照，跟 gatewayBadge() 的四個 label 一一對應 ──────────
const GATEWAY_STATE_PLAIN_LANGUAGE: Array<{ label: string; plain: string }> = [
  { label: "未配對", plain: "還沒裝 — 你的電腦上還沒開始設定本機連線程式。" },
  { label: "等待配對", plain: "裝了還沒認親 — 本機連線程式已啟動，但還沒跟你的帳號對上號。" },
  { label: "已連線", plain: "一切正常 — 你的電腦跟這裡互相認得，心跳持續回報。" },
  { label: "等待連線", plain: "失聯 — 你電腦上的本機連線程式停了，或網路斷了，暫時收不到心跳。" },
];

const RECOVERY_STEPS = [
  "重新啟動你電腦上的本機連線程式",
  "回到這頁重新產生一次配對碼，重新貼一次",
  "還是連不上，找我們，不要自己改設定檔",
];

/**
 * C-4 — 「你的憑證在哪裡」固定說明卡。
 * 對應 DAILY_DECISION_FLOW_DESIGN_v1.md §6 四點：
 *   ① 憑證只存你自己電腦，永不上傳
 *   ② 本機連線程式只回報「還活著」的心跳，不經手憑證
 *   ③ 四態白話對照
 *   ④ 失敗自救三步
 */
export function CredentialTrustCard() {
  return (
    <section
      style={{
        border: "1px solid rgba(52,211,153,0.22)",
        background: "linear-gradient(180deg, rgba(18,18,18,0.96), rgba(8,8,8,0.98))",
        padding: 20,
        marginBottom: 22,
        display: "grid",
        gap: 16,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <ShieldCheck size={18} strokeWidth={1.8} style={{ color: "#34d399" }} />
        <h2 style={{ margin: 0, fontSize: 16 }}>你的憑證在哪裡</h2>
      </div>

      <div style={{ display: "grid", gap: 8, color: "var(--fg-2, #bcc4cf)", fontSize: 13, lineHeight: 1.7 }}>
        <p style={{ margin: 0 }}>憑證只存在你自己的電腦，永不上傳。這個網站不會看到、也不會儲存你的券商帳號密碼。</p>
        <p style={{ margin: 0 }}>
          本機連線程式是安裝在你自己電腦上的一個小程式，負責幫你跟券商連線；我們這邊只收得到「它還活著」的心跳，收不到任何帳號或密碼。
        </p>
      </div>

      <div>
        <h3 style={{ margin: "0 0 10px", fontSize: 13, color: "var(--fg-1, #ddd)" }}>連線狀態，白話說</h3>
        <div style={{ display: "grid", gap: 8 }}>
          {GATEWAY_STATE_PLAIN_LANGUAGE.map((entry) => (
            <div key={entry.label} style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
              <b style={{ minWidth: 68, color: "var(--accent, #c8943f)", fontSize: 12 }}>{entry.label}</b>
              <span style={{ color: "var(--fg-3, #8a93a3)", fontSize: 12, lineHeight: 1.6 }}>{entry.plain}</span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 style={{ margin: "0 0 10px", fontSize: 13, color: "var(--fg-1, #ddd)" }}>連不上時，先做這三步</h3>
        <ol style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6, color: "var(--fg-2, #bcc4cf)", fontSize: 12, lineHeight: 1.6 }}>
          {RECOVERY_STEPS.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </div>
    </section>
  );
}

const inputStyle: CSSProperties = {
  background: "rgba(8,8,8,0.6)",
  border: "1px solid rgba(200,148,63,0.28)",
  color: "var(--fg-1, #ddd)",
  padding: "9px 11px",
  fontSize: 13,
  borderRadius: 4,
};

const buttonBaseStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 7,
  minHeight: 34,
  borderRadius: 4,
  fontSize: 12,
  fontWeight: 800,
  cursor: "pointer",
};

export function BrokerConnections() {
  const [conns, setConns] = useState<Connection[] | null>(null);
  const [adapterKey, setAdapterKey] = useState("kgi");
  const [accountRef, setAccountRef] = useState("");
  const [label, setLabel] = useState("");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pairingTokens, setPairingTokens] = useState<Record<string, PairingTokenState>>({});
  const [pairingDeadlines, setPairingDeadlines] = useState<Record<string, string>>({});
  const [nowMs, setNowMs] = useState(() => Date.now());

  const busy = busyAction !== null;

  const load = useCallback(async () => {
    try {
      const j = await api<Connection[]>("/api/v1/uta/accounts");
      setConns(Array.isArray(j.data) ? j.data : []);
    } catch {
      setErr("無法讀取連線清單，請稍後再試。");
      setConns([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const hasPairingCountdown = Object.keys(pairingDeadlines).length > 0;
    if (!hasPairingCountdown) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [pairingDeadlines]);

  const connect = async () => {
    if (!accountRef.trim()) return;
    setBusyAction("connect");
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
      setErr("連線建立失敗，請確認帳號代號是否正確。");
    } finally {
      setBusyAction(null);
    }
  };

  const generatePairingToken = async (id: string) => {
    setBusyAction(`pair:${id}`);
    setErr(null);
    try {
      const j = await api<PairTokenResponse>(`/api/v1/uta/accounts/${encodeURIComponent(id)}/gateway/pair-token`, { method: "POST" });
      const data = j.data;
      if (!data?.pairingToken || !data.expiresAt) throw new Error("missing_pairing_token");
      setPairingTokens((prev) => ({
        ...prev,
        [id]: { token: data.pairingToken ?? "", expiresAt: data.expiresAt ?? "", copied: false },
      }));
      setPairingDeadlines((prev) => ({ ...prev, [id]: data.expiresAt ?? "" }));
      setConns((prev) => prev?.map((conn) => conn.id === id ? { ...conn, gatewayStatus: "pending" } : conn) ?? prev);
      setNowMs(Date.now());
    } catch {
      setErr("配對碼產生失敗，請稍後再試。");
    } finally {
      setBusyAction(null);
    }
  };

  const copyPairingToken = async (id: string) => {
    const token = pairingTokens[id]?.token;
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      setPairingTokens((prev) => ({ ...prev, [id]: { ...prev[id], copied: true } }));
    } catch {
      setErr("無法複製配對碼，請手動選取後複製。");
    }
  };

  const closePairingToken = (id: string) => {
    setPairingTokens((prev) => removeEntry(prev, id));
  };

  const revokePairing = async (id: string) => {
    const confirmed = window.confirm("確定要撤銷這個券商配對嗎？目前配對碼會失效，已連線的本機連線程式也會停止報活。");
    if (!confirmed) return;

    setBusyAction(`revoke:${id}`);
    setErr(null);
    try {
      await api(`/api/v1/uta/accounts/${encodeURIComponent(id)}/gateway/revoke`, { method: "POST" });
      setPairingTokens((prev) => removeEntry(prev, id));
      setPairingDeadlines((prev) => removeEntry(prev, id));
      setConns((prev) => prev?.map((conn) => conn.id === id ? { ...conn, gatewayStatus: "unpaired", lastHeartbeatAt: null } : conn) ?? prev);
      void load();
    } catch {
      setErr("撤銷配對失敗，請稍後再試。");
    } finally {
      setBusyAction(null);
    }
  };

  const disconnect = async (id: string) => {
    setBusyAction(`disconnect:${id}`);
    setErr(null);
    try {
      await api("/api/v1/uta/accounts/disconnect", { method: "POST", body: JSON.stringify({ id }) });
      await load();
    } catch {
      setErr("停用連線失敗，請稍後再試。");
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <>
      <CredentialTrustCard />
      <section
      style={{
        border: "1px solid rgba(200,148,63,0.22)",
        background: "linear-gradient(180deg, rgba(18,18,18,0.96), rgba(8,8,8,0.98))",
        padding: 20,
        marginBottom: 22,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 16 }}>我的券商連線</h2>
          <p style={{ margin: "6px 0 0", color: "var(--fg-3, #8a93a3)", fontSize: 12, lineHeight: 1.6 }}>
            先建立券商帳號代號，再產生一次性配對碼貼到您自己電腦上的本機連線程式。
          </p>
        </div>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            color: "#34d399",
            border: "1px solid rgba(52,211,153,0.22)",
            background: "rgba(52,211,153,0.06)",
            padding: "5px 9px",
            fontSize: 12,
            whiteSpace: "nowrap",
          }}
        >
          <ShieldCheck size={14} strokeWidth={1.8} />
          憑證不進網頁
        </span>
      </div>

      <div style={{ display: "grid", gap: 10, marginBottom: 16 }}>
        {conns === null ? (
          <div style={{ color: "var(--fg-3, #8a93a3)", fontSize: 13 }}>讀取中...</div>
        ) : conns.length === 0 ? (
          <div style={{ color: "var(--fg-3, #8a93a3)", fontSize: 13 }}>尚未連線任何券商。在下方加入一個連線。</div>
        ) : (
          conns.map((c) => {
            const status = normalizeGatewayStatus(c.gatewayStatus);
            const token = pairingTokens[c.id];
            const badge = gatewayBadge(status, c, pairingDeadlines[c.id], nowMs);
            const isPairedOrPending = status !== "unpaired";
            const canGenerateToken = status === "unpaired" || status === "pending";
            const pairBusy = busyAction === `pair:${c.id}`;
            const revokeBusy = busyAction === `revoke:${c.id}`;
            const disconnectBusy = busyAction === `disconnect:${c.id}`;

            return (
              <article
                key={c.id}
                style={{
                  display: "grid",
                  gap: 12,
                  border: `1px solid ${badge.border}`,
                  background: "rgba(0,0,0,0.20)",
                  padding: 14,
                  borderRadius: 6,
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <b style={{ fontSize: 14 }}>{c.displayName}</b>
                      {c.isPrimary ? <span style={{ color: "#fbbf24", fontSize: 11, fontWeight: 900 }}>主要帳號</span> : null}
                    </div>
                    <div style={{ color: "var(--fg-3, #8a93a3)", fontSize: 12, marginTop: 5, lineHeight: 1.55 }}>
                      {c.accountLabel || c.accountRef}
                    </div>
                  </div>

                  <div
                    style={{
                      display: "inline-flex",
                      flexDirection: "column",
                      alignItems: "flex-end",
                      gap: 3,
                      color: badge.color,
                      border: `1px solid ${badge.border}`,
                      background: badge.background,
                      padding: "6px 9px",
                      borderRadius: 4,
                      minWidth: 132,
                    }}
                    aria-label={`本機連線狀態：${badge.label}`}
                  >
                    <span style={{ fontSize: 12, fontWeight: 900 }}>{badge.label}</span>
                    <span style={{ fontSize: 11, color: "var(--fg-2, #bcc4cf)" }}>{badge.detail}</span>
                  </div>
                </div>

                {token ? (
                  <div
                    style={{
                      border: "1px solid rgba(251,191,36,0.30)",
                      background: "rgba(251,191,36,0.07)",
                      padding: 12,
                      display: "grid",
                      gap: 10,
                      borderRadius: 5,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                      <strong style={{ color: "#fbbf24", fontSize: 13 }}>一次性配對碼</strong>
                      <span style={{ color: "#fbbf24", fontSize: 12, fontWeight: 900 }}>
                        倒數 {formatCountdown(Date.parse(token.expiresAt) - nowMs)}
                      </span>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "stretch",
                        gap: 8,
                        flexWrap: "wrap",
                      }}
                    >
                      <code
                        style={{
                          flex: "1 1 260px",
                          minWidth: 0,
                          border: "1px solid rgba(255,255,255,0.12)",
                          background: "rgba(0,0,0,0.36)",
                          color: "#f8fafc",
                          padding: "9px 10px",
                          borderRadius: 4,
                          fontSize: 12,
                          lineHeight: 1.5,
                          wordBreak: "break-all",
                        }}
                      >
                        {token.token}
                      </code>
                      <button
                        type="button"
                        onClick={() => void copyPairingToken(c.id)}
                        disabled={busy}
                        style={{
                          ...buttonBaseStyle,
                          border: "1px solid rgba(251,191,36,0.45)",
                          background: "rgba(251,191,36,0.12)",
                          color: "#fbbf24",
                          padding: "7px 12px",
                          cursor: busy ? "default" : "pointer",
                        }}
                      >
                        {token.copied ? <Check size={14} strokeWidth={2} /> : <Clipboard size={14} strokeWidth={1.9} />}
                        {token.copied ? "已複製" : "複製"}
                      </button>
                    </div>
                    <div style={{ color: "#fbbf24", fontSize: 12, lineHeight: 1.6 }}>
                      此碼只顯示一次，關閉後無法再查看。請貼到您自己電腦上的本機連線程式。
                    </div>
                    <button
                      type="button"
                      onClick={() => closePairingToken(c.id)}
                      style={{
                        ...buttonBaseStyle,
                        justifySelf: "start",
                        minHeight: 30,
                        border: "1px solid rgba(255,255,255,0.16)",
                        background: "transparent",
                        color: "var(--fg-2, #bcc4cf)",
                        padding: "5px 10px",
                      }}
                    >
                      關閉配對碼
                    </button>
                  </div>
                ) : null}

                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  {canGenerateToken ? (
                    <button
                      type="button"
                      onClick={() => void generatePairingToken(c.id)}
                      disabled={busy}
                      style={{
                        ...buttonBaseStyle,
                        border: "1px solid rgba(200,148,63,0.52)",
                        background: "rgba(200,148,63,0.13)",
                        color: "var(--accent, #c8943f)",
                        padding: "7px 12px",
                        cursor: busy ? "default" : "pointer",
                        opacity: busy && !pairBusy ? 0.55 : 1,
                      }}
                    >
                      {pairBusy ? <RefreshCw size={14} strokeWidth={1.8} /> : <KeyRound size={14} strokeWidth={1.8} />}
                      {status === "pending" ? "重新產生配對碼" : "產生配對碼"}
                    </button>
                  ) : null}

                  {isPairedOrPending ? (
                    <button
                      type="button"
                      onClick={() => void revokePairing(c.id)}
                      disabled={busy}
                      style={{
                        ...buttonBaseStyle,
                        border: "1px solid rgba(248,113,113,0.42)",
                        background: "rgba(248,113,113,0.08)",
                        color: "#f87171",
                        padding: "7px 12px",
                        cursor: busy ? "default" : "pointer",
                        opacity: busy && !revokeBusy ? 0.55 : 1,
                      }}
                    >
                      <Unplug size={14} strokeWidth={1.8} />
                      撤銷配對
                    </button>
                  ) : null}

                  <button
                    type="button"
                    onClick={() => void disconnect(c.id)}
                    disabled={busy}
                    style={{
                      ...buttonBaseStyle,
                      border: "1px solid rgba(255,255,255,0.16)",
                      background: "transparent",
                      color: c.status === "connected" ? "var(--fg-2, #bcc4cf)" : "var(--fg-3, #8a93a3)",
                      padding: "7px 12px",
                      cursor: busy ? "default" : "pointer",
                      opacity: busy && !disconnectBusy ? 0.55 : 1,
                    }}
                  >
                    停用連線
                  </button>
                </div>
              </article>
            );
          })
        )}
      </div>

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
            ...buttonBaseStyle,
            border: "1px solid rgba(200,148,63,0.5)",
            background: "rgba(200,148,63,0.12)",
            color: "var(--accent, #c8943f)",
            padding: "9px 16px",
            cursor: busy || !accountRef.trim() ? "default" : "pointer",
            opacity: busy || !accountRef.trim() ? 0.5 : 1,
          }}
        >
          建立連線
        </button>
      </div>

      {err ? <p style={{ margin: "12px 0 0", color: "#f87171", fontSize: 13 }}>{err}</p> : null}
      </section>
    </>
  );
}
