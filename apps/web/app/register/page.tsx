"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { apiRegister, authErrorMessage, setAuthPresence } from "@/lib/auth-client";

export default function RegisterPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Client-side validation
    if (!email.trim()) {
      setError("請輸入 Email");
      return;
    }
    if (!password || password.length < 8) {
      setError("密碼至少 8 個字元");
      return;
    }
    if (!inviteCode.trim()) {
      setError("請輸入邀請碼");
      return;
    }

    setLoading(true);
    try {
      const result = await apiRegister(email.trim(), password, inviteCode.trim());
      if (!result.ok) {
        setError(authErrorMessage(result.error));
        return;
      }
      // Auto login on success — iuf_session cookie set by API, mark presence for middleware
      setAuthPresence();
      router.push("/");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        {/* Brand */}
        <div className="auth-brand">
          <div className="auth-logo">IUF</div>
          <h1 className="auth-title">建立帳號</h1>
          <p className="auth-subtitle">使用邀請碼加入 IUF Trading Room</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="auth-form" noValidate>
          <div className="auth-field">
            <label htmlFor="email" className="auth-label">
              EMAIL
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="auth-input"
              placeholder="operator@iuf.tw"
              disabled={loading}
            />
          </div>

          <div className="auth-field">
            <label htmlFor="password" className="auth-label">
              PASSWORD
              <span className="auth-label-hint">（至少 8 字元）</span>
            </label>
            <input
              id="password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="auth-input"
              placeholder="••••••••"
              disabled={loading}
            />
          </div>

          <div className="auth-field">
            <label htmlFor="invite-code" className="auth-label">
              INVITE CODE
            </label>
            <input
              id="invite-code"
              type="text"
              autoComplete="off"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              className="auth-input mono"
              placeholder="IUF-XXXX-XXXX"
              disabled={loading}
            />
          </div>

          {error ? (
            <div className="auth-error" role="alert">
              <span className="auth-error-icon">!</span>
              {error}
            </div>
          ) : null}

          <button
            type="submit"
            className="auth-submit"
            disabled={loading}
          >
            {loading ? (
              <>
                <span className="auth-spinner" aria-hidden="true" />
                建立中...
              </>
            ) : (
              "建立帳號並進入"
            )}
          </button>
        </form>

        {/* Footer */}
        <p className="auth-footer">
          已有帳號？{" "}
          <a href="/login" className="auth-link">
            登入
          </a>
        </p>
      </div>
    </div>
  );
}
