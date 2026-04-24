"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { apiLogin, authErrorMessage, setAuthPresence } from "@/lib/auth-client";

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
    if (!password) {
      setError("請輸入密碼");
      return;
    }

    setLoading(true);
    try {
      const result = await apiLogin(email.trim(), password);
      if (!result.ok) {
        setError(authErrorMessage(result.error));
        return;
      }
      // iuf_session cookie is set by API server (HttpOnly)
      // set presence cookie so Next.js middleware can detect auth state
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
          <h1 className="auth-title">台股 AI 交易戰情室</h1>
          <p className="auth-subtitle">IUF Trading Room — Operator Login</p>
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
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="auth-input"
              placeholder="••••••••"
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
                驗證中...
              </>
            ) : (
              "進入戰情室"
            )}
          </button>
        </form>

        {/* Footer */}
        <p className="auth-footer">
          收到邀請碼？{" "}
          <a href="/register" className="auth-link">
            建立帳號
          </a>
        </p>
      </div>
    </div>
  );
}
