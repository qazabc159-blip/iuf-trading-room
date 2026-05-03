"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { apiLogin, authErrorMessage, setAuthPresence } from "@/lib/auth-client";

const ACCOUNT_CAPABILITIES = [
  {
    label: "帳號資料",
    state: "已啟用",
    body: "保存戰情台設定、觀察清單、策略偏好與模擬交易紀錄。",
  },
  {
    label: "模擬交易",
    state: "已啟用",
    body: "正式券商送單前，先做報價、風控、委託與成交流程演練。",
  },
  {
    label: "券商綁定",
    state: "規劃中",
    body: "之後一個網站帳號可綁定自己的證券帳號，凱基 SDK 補齊後接上。",
  },
  {
    label: "訂閱權限",
    state: "規劃中",
    body: "公開測試後逐步開放月費方案、進階資料與 AI 摘要功能。",
  },
];

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
            <div className="tg gold">帳號入口 · 台股交易工作台</div>
            <h2>登入你的戰情室</h2>
            <p className="login-intro">
              一個 IUF 帳號會保存你的觀察清單、策略想法、模擬交易紀錄與之後的券商綁定狀態。
              現階段採邀請碼開通，公開測試時會開放自助建立帳號。
            </p>
            <div className="login-capability-list">
              {ACCOUNT_CAPABILITIES.map((item) => (
                <div className="login-capability-card" key={item.label}>
                  <div>
                    <span className="tg gold">{item.label}</span>
                    <p>{item.body}</p>
                  </div>
                  <span className={`tg capability-state ${item.state === "已啟用" ? "up" : "gold"}`}>
                    {item.state}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <form className="login-panel" onSubmit={submit} noValidate>
            <div className="panel-head">
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
              {loading ? "登入中..." : "登入戰情室"}
            </button>

            <div className="login-action-row">
              <span className="tc soft">還沒有帳號？</span>
              <Link href="/register" className="login-secondary-link">建立帳號</Link>
            </div>

            <div className="tg soft login-foot">
              IUF-01 / 真實登入工作階段 / 安全登入
            </div>
          </form>
        </div>
      </section>
    </main>
  );
}
