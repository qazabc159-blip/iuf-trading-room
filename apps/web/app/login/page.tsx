"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { apiLogin, authErrorMessage, setAuthPresence } from "@/lib/auth-client";

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
            <div className="tg soft">交易戰情室 · 操作員登入</div>
            <h1>台股 AI 交易戰情室</h1>
          </div>
        </div>

        <div className="login-grid">
          <div className="login-copy">
            <div className="tg gold">登入檢查 · 安全工作階段</div>
            <h2>操作員入口</h2>
            <div className="login-scan">
              {[
                ["01", "身分驗證", "待確認"],
                ["02", "工作階段", "待確認"],
                ["03", "角色權限", "待確認"],
                ["04", "風控狀態", "唯讀"],
                ["05", "稽核紀錄", "啟用"],
              ].map(([idx, label, state]) => (
                <div className="login-scan-row" key={idx}>
                  <span className="tg">{idx}</span>
                  <span className="tg gold">{label}</span>
                  <span className="scan-line" />
                  <span className="tg soft">{state}</span>
                </div>
              ))}
            </div>
          </div>

          <form className="login-panel" onSubmit={submit} noValidate>
            <div className="panel-head" style={{ paddingTop: 0 }}>
              <div>
                <span className="tg panel-code">登入</span>
                <span className="tg muted"> · </span>
                <span className="tg gold">操作員驗證</span>
                <div className="panel-sub">電子信箱 / 密碼 / 工作階段記憶</div>
              </div>
              <span className="tg soft">盤後工作階段</span>
            </div>

            <label className="login-field">
              <span className="tg soft">電子信箱</span>
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                type="email"
                autoComplete="email"
                placeholder="operator@iuf.local"
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

            <div className={`login-error ${error ? "active" : ""}`} role="alert" aria-live="polite">
              {error || "錯誤訊息會顯示在這裡"}
            </div>

            <button className="login-submit" type="submit" disabled={loading}>
              {loading ? "登入中..." : "登入戰情室 ->"}
            </button>

            <div className="tg soft login-foot">
              IUF-01 / RADAR-0.8 / 安全登入
            </div>
          </form>
        </div>
      </section>
    </main>
  );
}
