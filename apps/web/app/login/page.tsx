"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { apiLogin, authErrorMessage, setAuthPresence } from "@/lib/auth-client";

function safeNextPath(value: string | null): string {
  if (!value) return "/";

  try {
    const url = new URL(value, window.location.origin);
    const isSameOrigin = url.origin === window.location.origin;
    const isInternalPath = url.pathname.startsWith("/") && !url.pathname.startsWith("//");
    const isAuthRoute = url.pathname === "/login" || url.pathname === "/register";

    if (!isSameOrigin || !isInternalPath || isAuthRoute) return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (!email.trim() || !password) {
      setError("請輸入電子信箱與密碼。");
      return;
    }

    setLoading(true);
    try {
      const result = await apiLogin(email.trim(), password);
      if (!result.ok) {
        setError(authErrorMessage(result.error));
        return;
      }
      if (remember) setAuthPresence();
      router.push(safeNextPath(new URLSearchParams(window.location.search).get("next")));
    } finally {
      setLoading(false);
    }
  }

  return (
    // `login-signin` is a page-scoped modifier: `/register` shares most of
    // these class names (`.login-route`/`.login-shell`/`.login-grid`/
    // `.login-copy`/`.login-panel`/…) from the same template, so all visual
    // rewrites for this task live under `.login-signin` overrides in
    // globals.css instead of touching the shared base rules — `/register`
    // is out of scope and stays pixel-identical.
    <main className="login-route login-signin">
      <section className="login-shell">
        <div className="login-mast">
          <div className="tac-logo">
            I<span />
          </div>
          <div className="login-mast-brand">
            <span className="tac-brand-kicker">IUF TRADING ROOM</span>
            <span className="tac-brand-version">操作員登入 · SIM 模擬工作台</span>
          </div>
        </div>

        <div className="login-grid">
          <form className="login-panel" onSubmit={submit} noValidate>
            <div className="panel-head">
              <div>
                <span className="tg panel-code">登入</span>
                <span className="tg muted"> · </span>
                <span className="tg gold">IUF 帳號驗證</span>
                <div className="panel-sub">電子信箱 / 密碼 / 裝置記憶</div>
              </div>
            </div>

            <label className="login-field">
              <span className="tg soft">電子信箱</span>
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
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
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                autoComplete="current-password"
                placeholder="請輸入密碼"
                required
              />
            </label>

            <label className="login-check">
              <input
                checked={remember}
                onChange={(event) => setRemember(event.target.checked)}
                type="checkbox"
              />
              <span>
                <span className="tg">記住這台裝置</span>
                <span className="tc soft">下次在此工作台保留登入狀態</span>
              </span>
            </label>

            {error && (
              <div className="login-error active" role="alert" aria-live="polite">
                {error}
              </div>
            )}

            <button className="login-submit" type="submit" disabled={loading}>
              {loading ? "登入中..." : "登入戰情室"}
            </button>

            <div className="login-action-row">
              <span className="tc soft">還沒有帳號？</span>
              <Link href="/register" className="login-secondary-link">用邀請碼建立帳號</Link>
            </div>
          </form>

          <div className="login-copy">
            <div className="tg gold">IUF 帳號 · 台股交易工作台</div>
            <h2>登入你的交易戰情室工作台</h2>
            <p className="login-intro">
              串接即時報價、風控與模擬委託紀錄的操作員工作台。目前為邀請制，取得邀請碼即可開通帳號。
            </p>
            <div className="login-copy-actions">
              <Link href="/register" className="login-secondary-cta">申請測試帳號</Link>
            </div>
            <div className="login-tags">
              <span className="login-tag">報價</span>
              <span className="login-tag">風控</span>
              <span className="login-tag">模擬委託</span>
              <span className="login-tag">操作紀錄</span>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
