"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiResetPassword, authErrorMessage } from "@/lib/auth-client";
import { passwordPolicyRules, policyPassed } from "@/lib/password-policy";

// /reset-password v3 (2026-07-17, Jim) — authv3 console language, same
// scoping/vars strategy as /login + /register (see .authv3-forgot block in
// globals.css). Backend contract: #1288 — token is a one-time link an admin
// generated and handed to the user out-of-band; this page never claims it
// arrived by email. reset-password never reveals which failure mode a bad
// token hit (missing/expired/used/revoked all collapse to the same real
// backend error), so this page just surfaces that real error text.
//
// Query param read follows the same client-side pattern as /register's
// `?invite=` (avoids the Suspense boundary requirement of useSearchParams).

const ERROR_TEXT: Record<string, string> = {
  invalid_or_expired: "這個重設連結無效或已過期，請重新申請。",
  password_too_short: "密碼至少需要 12 個字元。",
  password_missing_uppercase: "密碼需包含至少 1 個大寫英文字母。",
  password_missing_lowercase: "密碼需包含至少 1 個小寫英文字母。",
  password_missing_digit: "密碼需包含至少 1 個數字。",
  invalid_body: "表單資料有誤，請重新輸入。",
  reset_password_unavailable: "重設密碼服務暫時無法使用，請稍後再試。",
};

export default function ResetPasswordPage() {
  const router = useRouter();

  const [token, setToken] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setToken(params.get("token") ?? "");
    setLoaded(true);
  }, []);

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const hasToken = loaded && Boolean(token);
  const rules = passwordPolicyRules(password);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (!password || !confirmPassword) {
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
      const result = await apiResetPassword(token, password);
      if (!result.ok) {
        setError(ERROR_TEXT[result.error] ?? authErrorMessage(result.error));
        return;
      }
      router.push("/login");
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
        <section className="av3-console" aria-label="設定新密碼">
          <span className="av3-corner tr" />
          <span className="av3-corner bl" />
          <div className="av3-console-bar">
            <span className="av3-dot" />
            <span className="av3-lbl">{hasToken ? "帳號復原 · 設定新密碼" : "帳號復原 · 缺少重設連結"}</span>
            <span className="av3-rt">IUF-01 · TAIPEI</span>
          </div>

          <div className="av3-panel-body">
            <div className="av3-boot">
              <span className="av3-tick" />
              ACCESS RECOVERY / 帳號復原
            </div>

            {!hasToken ? (
              <>
                <h1>缺少重設連結</h1>
                <p className="av3-lede">
                  這個網址缺少必要的重設參數，請確認你開啟的是管理員提供的完整連結，或重新申請一次。
                </p>
                <Link className="av3-back" href="/forgot-password">
                  <span className="av3-ar">←</span> 重新申請密碼重設
                </Link>
              </>
            ) : (
              <>
                <h1>設定新密碼</h1>
                <form onSubmit={submit} noValidate>
                  <label className="av3-field">
                    <span className="av3-lab">
                      新密碼 <span className="av3-hint">至少 12 字元</span>
                    </span>
                    <div className="av3-box">
                      <input
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        type="password"
                        autoComplete="new-password"
                        placeholder="至少 12 個字元，含大小寫與數字"
                        className={password.length === 0 ? "" : policyPassed(password) ? "av3-good" : "av3-bad"}
                      />
                    </div>
                  </label>

                  <div className="av3-pwrules" aria-live="polite">
                    {rules.map((r) => (
                      <div key={r.key} className={`av3-r${r.met ? " av3-ok" : ""}`}>
                        <span className="av3-mk">✓</span>
                        {r.label}
                      </div>
                    ))}
                  </div>

                  <label className="av3-field">
                    <span className="av3-lab">確認新密碼</span>
                    <div className="av3-box">
                      <input
                        value={confirmPassword}
                        onChange={(event) => setConfirmPassword(event.target.value)}
                        type="password"
                        autoComplete="new-password"
                        placeholder="再次輸入新密碼"
                        className={
                          confirmPassword.length === 0
                            ? ""
                            : confirmPassword === password && policyPassed(password)
                              ? "av3-good"
                              : "av3-bad"
                        }
                      />
                    </div>
                  </label>

                  {error && (
                    <div className="av3-err" role="alert" aria-live="polite">
                      {error}
                    </div>
                  )}

                  <button className="av3-submit" type="submit" disabled={loading || !loaded}>
                    {loading ? "更新中…" : "更新密碼"}
                  </button>
                </form>
                <Link className="av3-back" href="/login">
                  <span className="av3-ar">←</span> 已有帳號，前往登入
                </Link>
              </>
            )}
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
