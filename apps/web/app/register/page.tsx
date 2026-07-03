"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiRegister, setAuthPresence, authErrorMessage } from "@/lib/auth-client";

// ── Password policy ───────────────────────────────────────────────────────────
// Frontend enforces 12 chars + complexity; backend minimum is 8 (legacy).
// We surface real-time hints so users don't get surprised on submit.

type PolicyHint = { label: string; met: boolean };

function passwordPolicyHints(p: string): PolicyHint[] {
  return [
    { label: "至少 12 個字元", met: p.length >= 12 },
    { label: "至少 1 個大寫字母", met: /[A-Z]/.test(p) },
    { label: "至少 1 個小寫字母", met: /[a-z]/.test(p) },
    { label: "至少 1 個數字", met: /[0-9]/.test(p) },
  ];
}

function policyPassed(p: string): boolean {
  return passwordPolicyHints(p).every((h) => h.met);
}

// ── Error message map ─────────────────────────────────────────────────────────

const ERROR_TEXT: Record<string, string> = {
  invalid_or_expired: "邀請連結無效或已過期，請聯繫邀請人。",
  invalid_invite_code: "邀請連結無效或已過期，請聯繫邀請人。",
  invite_already_used: "此邀請連結已被使用。",
  invite_expired: "此邀請連結已過期，請重新申請。",
  email_already_registered: "此電子信箱已註冊，請直接登入。",
  network_error: "無法連線到驗證服務，請稍後再試。",
  invalid_request_body: "表單資料有誤，請確認所有欄位後重試。",
};

// ── No-token notice ───────────────────────────────────────────────────────────

function NoTokenNotice() {
  return (
    <main className="login-route">
      <section className="login-shell" style={{ maxWidth: 520 }}>
        <div className="login-brand">
          <div className="brand-mark">IUF</div>
          <div>
            <div className="tg soft">交易戰情室</div>
            <h1>台股 AI 交易戰情室</h1>
          </div>
        </div>
        <div className="login-panel" style={{ textAlign: "center", gap: 20, padding: "32px 28px" }}>
          <div className="tg gold" style={{ fontSize: 15 }}>本系統採邀請制</div>
          <p style={{ color: "rgba(255,255,255,0.65)", lineHeight: 1.7, margin: "12px 0 0" }}>
            請聯繫系統管理員取得邀請連結，<br />再開啟連結建立個人帳號。
          </p>
          <p style={{ color: "rgba(255,255,255,0.42)", fontSize: 12, marginTop: 16 }}>
            收到的邀請連結格式為：<br />
            <span style={{ fontFamily: "monospace", color: "rgba(255,184,0,0.7)" }}>
              https://app.eycvector.com/register?invite=...
            </span>
          </p>
          <div style={{ marginTop: 24 }}>
            <Link href="/login" className="login-secondary-cta">已有帳號，前往登入</Link>
          </div>
        </div>
      </section>
    </main>
  );
}

// ── Register form ─────────────────────────────────────────────────────────────

export default function RegisterPage() {
  const router = useRouter();

  // URL param read (client-side, avoids Suspense boundary requirement)
  const [inviteToken, setInviteToken] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tokenFromUrl = params.get("invite") ?? "";
    setInviteToken(tokenFromUrl);
    setLoaded(true);
  }, []);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPolicyHints, setShowPolicyHints] = useState(false);

  // Show no-token notice once loaded and no token present
  if (loaded && !inviteToken) {
    return <NoTokenNotice />;
  }

  const hints = passwordPolicyHints(password);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (!inviteToken.trim() || !email.trim() || !name.trim() || !password || !confirmPassword) {
      setError("請填完整所有欄位。");
      return;
    }
    if (!policyPassed(password)) {
      setError("密碼不符合強度要求，請依提示修改。");
      return;
    }
    if (password !== confirmPassword) {
      setError("兩次輸入的密碼不一致。");
      return;
    }

    setLoading(true);
    try {
      const result = await apiRegister(email.trim(), password, inviteToken.trim(), name.trim());
      if (!result.ok) {
        const msg = ERROR_TEXT[result.error] ?? authErrorMessage(result.error);
        setError(msg);
        return;
      }
      // Backend issued session cookie — set presence hint then go to home
      setAuthPresence();
      router.push("/");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-route">
      <section className="login-shell">
        <div className="login-brand">
          <div className="brand-mark">IUF</div>
          <div>
            <div className="tg soft">交易戰情室 · 受邀開通席位</div>
            <h1>台股 AI 交易戰情室</h1>
          </div>
        </div>

        <div className="login-grid">
          <div className="login-copy">
            <div className="tg gold">建立帳號 · 邀請席位開通</div>
            <h2>設定帳號後即可進入戰情室</h2>
            <p className="login-intro">
              這裡建立的是 IUF 網站帳號，帳號建立後即可進入戰情室，保存個人設定與觀察清單。
              券商帳號綁定與訂閱權限會依流程另行開通。
            </p>
            <div className="login-copy-actions">
              <Link href="/login" className="login-secondary-cta">已有帳號，前往登入</Link>
            </div>
            {/* Password policy reference */}
            <div style={{ marginTop: 24, padding: "14px 16px", background: "rgba(255,184,0,0.06)", border: "1px solid rgba(255,184,0,0.18)", borderRadius: 6 }}>
              <div className="tg gold" style={{ fontSize: 11, marginBottom: 8 }}>密碼強度要求</div>
              {passwordPolicyHints("").map((h, i) => (
                <div key={i} style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", lineHeight: 1.8 }}>
                  · {h.label}
                </div>
              ))}
            </div>
          </div>

          <form className="login-panel" onSubmit={submit} noValidate>
            <div className="panel-head">
              <div>
                <span className="tg panel-code">REG</span>
                <span className="tg muted"> · </span>
                <span className="tg gold">受邀開通</span>
                <div className="panel-sub">姓名 / 信箱 / 密碼 / 確認</div>
              </div>
              <span className="tg gold">邀請制</span>
            </div>

            <label className="login-field">
              <span className="tg soft">姓名 / 暱稱</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                type="text"
                autoComplete="name"
                placeholder="輸入你的姓名或暱稱"
                required
              />
            </label>

            <label className="login-field">
              <span className="tg soft">電子信箱</span>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                autoComplete="email"
                placeholder="輸入你的電子信箱"
                required
              />
            </label>

            <label className="login-field">
              <span className="tg soft">密碼</span>
              <input
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setShowPolicyHints(true);
                }}
                onFocus={() => setShowPolicyHints(true)}
                type="password"
                autoComplete="new-password"
                placeholder="至少 12 個字元，含大小寫與數字"
                required
              />
            </label>

            {/* Real-time policy hints */}
            {showPolicyHints && password.length > 0 && (
              <div style={{ marginTop: -6, marginBottom: 4, padding: "8px 10px", background: "rgba(0,0,0,0.25)", borderRadius: 4 }}>
                {hints.map((h, i) => (
                  <div key={i} style={{ fontSize: 11, lineHeight: 1.8, color: h.met ? "#4caf50" : "rgba(255,255,255,0.45)" }}>
                    {h.met ? "✓" : "○"} {h.label}
                  </div>
                ))}
              </div>
            )}

            <label className="login-field">
              <span className="tg soft">確認密碼</span>
              <input
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                type="password"
                autoComplete="new-password"
                placeholder="再次輸入密碼"
                required
              />
            </label>

            {/* Invite token (hidden — pre-filled from URL) */}
            <input type="hidden" value={inviteToken} readOnly />

            <div className={`login-error ${error ? "active" : ""}`} role="alert" aria-live="polite">
              {error || "錯誤訊息會顯示在這裡"}
            </div>

            <button className="login-submit" type="submit" disabled={loading || !loaded}>
              {loading ? "建立中..." : "建立帳號"}
            </button>

            <div className="tg soft login-foot">
              已有帳號？{" "}
              <Link href="/login" style={{ color: "var(--gold-bright)" }}>前往登入</Link>
            </div>
          </form>
        </div>
      </section>
    </main>
  );
}
