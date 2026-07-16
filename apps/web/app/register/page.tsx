"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiRegister, setAuthPresence, authErrorMessage } from "@/lib/auth-client";

// /register v3 — byte-exact port of design draft (2026-07-16, Jim).
// Source: reports/design_redesign_20260716/register_redesign_v1.html
// Two real states driven by the actual `?invite=` URL param (the draft's
// `.demoswitch` two-state toggle was a review-only affordance and is not
// ported — it never ships). DOM/CSS scoped under `.authv3-register`.

// ── Password policy ───────────────────────────────────────────────────────────
// Frontend enforces 12 chars + complexity; backend minimum is 8 (legacy).
// Real-time hints so users don't get surprised on submit.

type PolicyRule = { key: "len" | "upper" | "lower" | "digit"; label: string; met: boolean };

function passwordPolicyRules(p: string): PolicyRule[] {
  return [
    { key: "len", label: "至少 12 字元", met: p.length >= 12 },
    { key: "upper", label: "含大寫字母", met: /[A-Z]/.test(p) },
    { key: "lower", label: "含小寫字母", met: /[a-z]/.test(p) },
    { key: "digit", label: "含數字", met: /[0-9]/.test(p) },
  ];
}

function policyPassed(p: string): boolean {
  return passwordPolicyRules(p).every((r) => r.met);
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

export default function RegisterPage() {
  const router = useRouter();

  // URL param read (client-side, avoids Suspense boundary requirement)
  const [inviteToken, setInviteToken] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setInviteToken(params.get("invite") ?? "");
    setLoaded(true);
  }, []);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const hasInvite = loaded && Boolean(inviteToken);
  const rules = passwordPolicyRules(password);

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
        setError(ERROR_TEXT[result.error] ?? authErrorMessage(result.error));
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
    <div className="login-route authv3-register">
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
        <section className="av3-console" aria-label="建立帳號">
          <span className="av3-corner tr" />
          <span className="av3-corner bl" />
          <div className="av3-console-bar">
            <span className="av3-dot" />
            <span className="av3-lbl">{hasInvite ? "受邀開通 · 建立操作員帳號" : "邀請制 · 尚未帶入邀請碼"}</span>
            <span className="av3-rt">IUF-01 · TAIPEI</span>
          </div>

          {!hasInvite ? (
            // ══ State A：無邀請碼（邀請制占位態） ══
            <div className="av3-gate">
              <div className="av3-boot">
                <span className="av3-tick" />
                ACCESS GATE / 邀請制
              </div>
              <h1>
                台股 AI <span className="av3-em">交易戰情室</span>
              </h1>
              <div className="av3-gatecard">
                <div className="av3-gh">本系統採邀請制</div>
                <p className="av3-gp">請聯繫系統管理員取得邀請連結，再開啟連結建立個人帳號。</p>
                <div className="av3-fmt">
                  <div className="av3-k">收到的邀請連結格式為</div>
                  <div className="av3-v">https://app.eycvector.com/register?invite=…</div>
                </div>
                <Link className="av3-gcta" href="/login">
                  已有帳號，前往登入 →
                </Link>
              </div>
            </div>
          ) : (
            // ══ State B：有邀請碼（開表單態） ══
            <div className="av3-grille">
              <div className="av3-brandpane">
                <div className="av3-boot">
                  <span className="av3-tick" />
                  受邀開通席位 / SEAT
                </div>
                <h1>
                  設定帳號後
                  <br />
                  <span className="av3-em">即可進入戰情室</span>
                </h1>
                <p className="av3-lede">
                  這裡建立的是 IUF 網站帳號，帳號建立後即可進入戰情室，保存個人設定與觀察清單。
                  <b>券商帳號綁定與訂閱權限</b>會依流程另行開通。
                </p>
                <div className="av3-rulecard">
                  <div className="av3-rc-h">密碼規則</div>
                  <ul>
                    <li>至少 12 個字元</li>
                    <li>包含至少 1 個大寫英文字母</li>
                    <li>包含至少 1 個小寫英文字母</li>
                    <li>包含至少 1 個數字</li>
                  </ul>
                </div>
                <Link className="av3-back" href="/login">
                  <span className="av3-ar">←</span> 已有帳號，前往登入
                </Link>
                <div className="av3-regmarks">◹ EYCVECTOR · TRADING ROOM ◸</div>
              </div>

              <div className="av3-regpane">
                <div className="av3-reg-head">
                  <span className="av3-tab">
                    受邀開通 <span className="av3-cd">REG</span>
                  </span>
                  <span className="av3-badge">邀請制</span>
                </div>
                <form className="av3-reg-body" onSubmit={submit} noValidate>
                  <label className="av3-field">
                    <span className="av3-lab">姓名 / 暱稱</span>
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      type="text"
                      autoComplete="name"
                      placeholder="輸入你的姓名或暱稱"
                    />
                  </label>
                  <label className="av3-field">
                    <span className="av3-lab">電子信箱</span>
                    <input
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      type="email"
                      autoComplete="email"
                      placeholder="輸入你的電子信箱"
                    />
                  </label>
                  <label className="av3-field">
                    <span className="av3-lab">
                      密碼 <span className="av3-hint">至少 12 字元</span>
                    </span>
                    <input
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      type="password"
                      autoComplete="new-password"
                      placeholder="至少 12 個字元，含大小寫與數字"
                      className={password.length === 0 ? "" : policyPassed(password) ? "av3-good" : "av3-bad"}
                    />
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
                    <span className="av3-lab">確認密碼</span>
                    <input
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      type="password"
                      autoComplete="new-password"
                      placeholder="再次輸入密碼"
                      className={
                        confirmPassword.length === 0
                          ? ""
                          : confirmPassword === password && policyPassed(password)
                            ? "av3-good"
                            : "av3-bad"
                      }
                    />
                  </label>

                  <div className={`av3-err-persist${error ? " av3-on" : ""}`} role="alert" aria-live="polite">
                    {error || "錯誤訊息會顯示在這裡"}
                  </div>

                  <button className="av3-submit" type="submit" disabled={loading || !loaded}>
                    {loading ? "建立中…" : "建立帳號"}
                  </button>
                  <p className="av3-reg-foot">邀請碼已隨連結帶入並綁定此次註冊；建立成功後直接進入戰情室首頁。</p>
                </form>
              </div>
            </div>
          )}
        </section>
      </main>

      <footer className="av3-footband">
        <div className="av3-footband-inner">
          <span>
            IUF TRADING ROOM · <b>台股 AI 交易戰情室</b>
          </span>
          <span>受邀開通 · 邀請制 BETA</span>
        </div>
      </footer>
    </div>
  );
}
