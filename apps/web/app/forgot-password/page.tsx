"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { apiRequestPasswordReset, authErrorMessage } from "@/lib/auth-client";

// /forgot-password v3 (2026-07-17, Jim) — authv3 console language, same
// scoping/vars strategy as /login + /register (see .authv3-forgot block in
// globals.css). Backend contract: #1288 (admin-mediated reset, migration
// 0060) — this app has no mailer that can send to an arbitrary user
// address, so there is no "email sent" state here. Submitting always shows
// the same neutral confirmation regardless of whether the address matched
// an account (mirrors the backend's own anti-enumeration behavior) — copy
// must never claim a message was emailed.

const ERROR_TEXT: Record<string, string> = {
  invalid_body: "請輸入正確格式的電子信箱。",
};

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [submittedMessage, setSubmittedMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (!email.trim()) {
      setError("請輸入電子信箱。");
      return;
    }

    setLoading(true);
    try {
      const result = await apiRequestPasswordReset(email.trim());
      if (!result.ok) {
        setError(ERROR_TEXT[result.error] ?? authErrorMessage(result.error));
        return;
      }
      setSubmittedMessage(result.message || "申請已送出，請等待管理員審核並提供重設連結。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-route authv3-forgot">
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
        <span className="av3-beta">邀請制 BETA</span>
      </header>

      <main className="av3-stage">
        <section className="av3-console" aria-label="忘記密碼申請">
          <span className="av3-corner tr" />
          <span className="av3-corner bl" />
          <div className="av3-console-bar">
            <span className="av3-dot" />
            <span className="av3-lbl">帳號復原 · 密碼重設申請</span>
            <span className="av3-rt">IUF-01 · TAIPEI</span>
          </div>

          <div className="av3-panel-body">
            <div className="av3-boot">
              <span className="av3-tick" />
              ACCESS RECOVERY / 帳號復原
            </div>
            <h1>忘記密碼？</h1>

            {submittedMessage ? (
              <div className="av3-neutral">
                <div className="av3-neutral-h">申請已送出</div>
                <p>{submittedMessage}</p>
                <p>本系統沒有自動寄信功能，管理員會透過既有聯繫管道（例如 Line、當面）把重設連結交給你，請留意通知。</p>
              </div>
            ) : (
              <>
                <p className="av3-lede">
                  輸入你註冊時使用的<b>電子信箱</b>並送出申請；管理員審核後，會透過既有聯繫管道把重設連結交給你。
                </p>
                <form onSubmit={submit} noValidate>
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

                  {error && (
                    <div className="av3-err" role="alert" aria-live="polite">
                      {error}
                    </div>
                  )}

                  <button className="av3-submit" type="submit" disabled={loading}>
                    {loading ? "送出中…" : "送出重設申請"}
                  </button>
                </form>
              </>
            )}

            <Link className="av3-back" href="/login">
              <span className="av3-ar">←</span> 已有帳號，前往登入
            </Link>
          </div>
        </section>
      </main>

      <footer className="av3-footband">
        <div className="av3-footband-inner">
          <span>
            IUF TRADING ROOM · <b>台股 AI 交易戰情室</b>
          </span>
          <span>帳號復原 · 邀請制 BETA</span>
        </div>
      </footer>
    </div>
  );
}
