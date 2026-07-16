"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiLogin, authErrorMessage, setAuthPresence } from "@/lib/auth-client";

// /login v3 — byte-exact port of design draft (2026-07-16, Jim).
// Source: reports/design_redesign_20260716/login_redesign_v1.html
// DOM structure and CSS (scoped under `.authv3-login` in globals.css) are
// carried over verbatim from the approved artifact; only the two inline
// <script> blocks (draft-only clock + fake-error demo) are replaced here
// with real auth wiring. See DESIGN_NOTES.md in the same report folder for
// the full original-vs-redesign rationale.

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

function pad(n: number): string {
  return (n < 10 ? "0" : "") + n;
}

// Real Taipei wall clock (UTC+8) — terminal-alive signal only, never a
// market/quote readout. Same technique as the draft's inline script.
function useTaipeiClock(): string {
  const [time, setTime] = useState("--:--:--");

  useEffect(() => {
    function tick() {
      const d = new Date(Date.now() + 8 * 3600 * 1000);
      setTime(`${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`);
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return time;
}

export default function LoginPage() {
  const router = useRouter();
  const clock = useTaipeiClock();
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
    <div className="login-route authv3-login">
      <div className="av3-ambient" aria-hidden="true" />
      <div className="av3-bggrid" aria-hidden="true" />

      <header className="av3-mast">
        <div className="av3-glyph">
          I<i />
        </div>
        <div className="av3-wordmark">
          <b>IUF TRADING ROOM</b>
          <small>台股 AI 交易戰情室</small>
        </div>
        <div className="av3-spacer" />
        <div className="av3-status">
          <div className="av3-clk">
            <span>{clock}</span>
            <small>台北時間</small>
          </div>
          <span className="av3-beta">邀請制 BETA</span>
        </div>
      </header>

      <main className="av3-stage">
        <section className="av3-console" aria-label="登入戰情室">
          <span className="av3-corner tr" />
          <span className="av3-corner bl" />
          <div className="av3-console-bar">
            <span className="av3-dot" />
            <span className="av3-lbl">操作員終端 · 帳號驗證</span>
            <span className="av3-rt">IUF-01 · TAIPEI</span>
          </div>

          <div className="av3-grille">
            {/* 品牌張力面：大字標＋一句誠實定位（無能力清單、無 SIM 字樣、無假行情） */}
            <div className="av3-brandpane">
              <div className="av3-boot">
                <span className="av3-tick" />
                OPERATOR CONSOLE / 受邀開通
              </div>
              <h1>
                台股 AI
                <br />
                <span className="av3-em">交易戰情室</span>
              </h1>
              <p className="av3-lede">
                串接<b>即時行情</b>、公司研究、下單與<b>風控</b>的操作員工作台。
                登入後進入你的觀察清單與工作區；目前採<b>邀請制</b>開通。
              </p>
              <div className="av3-idline">
                <div className="av3-cell">
                  <span className="av3-k">市場</span>
                  <span className="av3-v">TWSE · 台股</span>
                </div>
                <div className="av3-cell">
                  <span className="av3-k">存取</span>
                  <span className="av3-v">邀請制 · 操作員</span>
                </div>
                <div className="av3-cell">
                  <span className="av3-k">節點</span>
                  <span className="av3-v">IUF-01</span>
                </div>
              </div>
              <div className="av3-regmarks">◹ EYCVECTOR · TRADING ROOM ◸</div>
            </div>

            {/* 登入 + 建立帳號 */}
            <div className="av3-authpane">
              <form className="av3-auth" onSubmit={submit} noValidate>
                <div className="av3-auth-head">
                  <b>帳號登入</b>
                  <small>MEMBER&nbsp;ACCESS</small>
                </div>

                <label className="av3-field">
                  <span className="av3-lab">電子信箱</span>
                  <div className="av3-box">
                    <input
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      type="email"
                      autoComplete="email"
                      placeholder="輸入你的電子信箱"
                    />
                  </div>
                </label>
                <label className="av3-field">
                  <span className="av3-lab">密碼</span>
                  <div className="av3-box">
                    <input
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      type="password"
                      autoComplete="current-password"
                      placeholder="請輸入密碼"
                    />
                  </div>
                </label>

                <div className="av3-row">
                  <label className="av3-check">
                    <input
                      checked={remember}
                      onChange={(event) => setRemember(event.target.checked)}
                      type="checkbox"
                    />
                    <span>記住這台裝置</span>
                  </label>
                  <Link className="av3-help" href="/forgot-password">
                    忘記密碼？
                  </Link>
                </div>

                {error && (
                  <div className="av3-err" role="alert" aria-live="polite">
                    {error}
                  </div>
                )}

                <button className="av3-submit" type="submit" disabled={loading}>
                  {loading ? "登入中…" : "登入戰情室"}
                </button>
              </form>

              <div className="av3-register">
                <div className="av3-txt">
                  <b>還沒有帳號？</b>
                  <span>持邀請碼即可建立帳號並進入戰情室</span>
                </div>
                <Link className="av3-cta" href="/register">
                  用邀請碼建立帳號 →
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="av3-footband">
        <div className="av3-footband-inner">
          <span>
            IUF TRADING ROOM · <b>台股 AI 交易戰情室</b>
          </span>
          <span>操作員登入 · 邀請制 BETA</span>
        </div>
      </footer>
    </div>
  );
}
