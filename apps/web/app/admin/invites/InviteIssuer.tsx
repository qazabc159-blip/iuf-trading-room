"use client";

import { useEffect, useState } from "react";

import { apiGetMe, apiIssueInvite, authErrorMessage } from "@/lib/auth-client";

const TTL_OPTIONS = [
  { label: "24 小時", value: 60 * 24 },
  { label: "7 天", value: 60 * 24 * 7 },
  { label: "30 天", value: 60 * 24 * 30 },
] as const;

type SessionState =
  | { status: "loading" }
  | { status: "owner"; email: string }
  | { status: "blocked"; reason: string };

function formatDateTime(value: string | null) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-TW", { hour12: false });
}

export function InviteIssuer() {
  const [session, setSession] = useState<SessionState>({ status: "loading" });
  const [ttlMinutes, setTtlMinutes] = useState<number>(TTL_OPTIONS[1].value);
  const [issuing, setIssuing] = useState(false);
  const [invite, setInvite] = useState<{ code: string; expiresAt: string } | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadSession() {
      const result = await apiGetMe();
      if (cancelled) return;
      if (!result.ok) {
        setSession({ status: "blocked", reason: authErrorMessage(result.error) });
        return;
      }
      if (result.user.role !== "Owner") {
        setSession({ status: "blocked", reason: "只有 Owner 可以產生測試邀請碼。" });
        return;
      }
      setSession({ status: "owner", email: result.user.email });
    }

    void loadSession();
    return () => {
      cancelled = true;
    };
  }, []);

  async function issueInvite() {
    setMessage("");
    setIssuing(true);
    try {
      const result = await apiIssueInvite(ttlMinutes);
      if (!result.ok) {
        setMessage(authErrorMessage(result.error));
        return;
      }
      setInvite({ code: result.code, expiresAt: result.expiresAt });
      setMessage("邀請碼已建立，可以交給測試使用者到註冊頁建立帳號。");
    } finally {
      setIssuing(false);
    }
  }

  async function copyInvite() {
    if (!invite) return;
    await navigator.clipboard.writeText(invite.code);
    setMessage("邀請碼已複製到剪貼簿。");
  }

  if (session.status === "loading") {
    return (
      <div className="state-panel">
        <span className="badge badge-yellow">讀取中</span>
        <span className="state-reason">正在確認目前登入者權限。</span>
      </div>
    );
  }

  if (session.status === "blocked") {
    return (
      <div className="state-panel">
        <span className="badge badge-red">暫停</span>
        <span className="tg soft">來源：登入工作階段</span>
        <span className="state-reason">{session.reason}</span>
      </div>
    );
  }

  return (
    <div className="invite-admin">
      <div className="source-line">
        <span className="badge badge-green">正常</span>
        <span>Owner：{session.email}</span>
        <span>來源：正式邀請碼端點</span>
      </div>

      <div className="invite-admin-grid">
        <label className="field-box">
          <span className="tg gold">有效期限</span>
          <select value={ttlMinutes} onChange={(event) => setTtlMinutes(Number(event.target.value))}>
            {TTL_OPTIONS.map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
        </label>

        <div className="field-box">
          <span className="tg gold">安全規則</span>
          <p>邀請碼只能使用一次；新帳號預設為 Viewer，後續券商綁定與付費權限另行控管。</p>
        </div>
      </div>

      <div className="action-row" style={{ gap: 14, marginTop: 22 }}>
        <button className="mini-button" type="button" onClick={issueInvite} disabled={issuing}>
          {issuing ? "產生中..." : "產生測試邀請碼"}
        </button>
        {invite && (
          <button className="outline-button" type="button" onClick={copyInvite}>
            複製邀請碼
          </button>
        )}
      </div>

      {invite && (
        <div className="invite-result">
          <span className="tg soft">邀請碼</span>
          <strong>{invite.code}</strong>
          <span className="tg soft">到期：{formatDateTime(invite.expiresAt)}</span>
        </div>
      )}

      <div className={`login-error ${message ? "active" : ""}`} role="status" aria-live="polite">
        {message || "操作結果會顯示在這裡。"}
      </div>
    </div>
  );
}
