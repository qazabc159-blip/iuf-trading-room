"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

import { apiLogin, authErrorMessage, setAuthPresence } from "@/lib/auth-client";

import "./login.css";

const SCAN_ROWS = ["AUTH", "SESSION", "ROLE", "RISK", "AUDIT"] as const;

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

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
            <div className="tg soft">TRADING ROOM / OPERATOR ACCESS</div>
            <h1>Trading Room</h1>
          </div>
        </div>

        <div className="login-grid">
          <div className="login-copy">
            <div className="tg gold">RADAR LOGIN / SECURE SESSION</div>
            <h2>Operator Gate</h2>
            <div className="login-scan">
              {SCAN_ROWS.map((item, index) => (
                <div className="login-scan-row" key={item}>
                  <span className="tg">{String(index + 1).padStart(2, "0")}</span>
                  <span className="tg gold">{item}</span>
                  <span className="scan-line" />
                  <span className="tg soft">{index < 2 ? "READY" : "WAIT"}</span>
                </div>
              ))}
            </div>
          </div>

          <form className="login-panel" onSubmit={handleSubmit} noValidate>
            <div className="panel-head" style={{ paddingTop: 0 }}>
              <div>
                <span className="tg panel-code">AUTH</span>
                <span className="tg muted"> / </span>
                <span className="tg gold">operator login</span>
                <div className="tg panel-sub">email / password / session memory</div>
              </div>
              <span className="tg soft">POST-CLOSE</span>
            </div>

            <label className="login-field">
              <span className="tg soft">EMAIL</span>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                autoComplete="email"
                autoFocus
                placeholder="operator@iuf.tw"
                disabled={loading}
              />
            </label>

            <label className="login-field">
              <span className="tg soft">PASSWORD</span>
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                autoComplete="current-password"
                placeholder="••••••••••••"
                disabled={loading}
              />
            </label>

            <label className="login-check">
              <input
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                type="checkbox"
                disabled={loading}
              />
              <span>
                <span className="tg">REMEMBER ME</span>
                <span className="tg soft">keep operator session on this desk</span>
              </span>
            </label>

            <div
              className={`login-error ${error ? "active" : ""}`}
              role="alert"
              aria-live="polite"
            >
              {error || "ERROR MESSAGE AREA"}
            </div>

            <button className="login-submit" type="submit" disabled={loading}>
              {loading ? "驗證中..." : "ENTER WAR ROOM →"}
            </button>

            <div className="tg soft login-foot">
              IUF-01 / REV RADAR-0.8 / OPERATOR AUTH
            </div>
          </form>
        </div>
      </section>
    </main>
  );
}
