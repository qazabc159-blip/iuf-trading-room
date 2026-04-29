"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { apiRegister } from "@/lib/auth-client";

const ERROR_TEXT: Record<string, string> = {
  invalid_invite_code: "邀請碼無效，請確認是否完整輸入。",
  invite_already_used: "此邀請碼已被使用。",
  invite_expired: "此邀請碼已過期，請重新申請。",
  email_already_registered: "此電子信箱已註冊。",
  network_error: "無法連線到驗證服務，請稍後再試。",
};

export default function RegisterPage() {
  const router = useRouter();
  const [invite, setInvite] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (!invite.trim() || !email.trim() || !password || !confirmPassword) {
      setError("請填完整邀請碼、電子信箱與密碼。");
      return;
    }
    if (password.length < 8) {
      setError("密碼至少需要 8 個字元。");
      return;
    }
    if (password !== confirmPassword) {
      setError("兩次輸入的密碼不一致。");
      return;
    }

    setLoading(true);
    try {
      const result = await apiRegister(email.trim(), password, invite.trim());
      if (!result.ok) {
        setError(ERROR_TEXT[result.error] ?? `註冊失敗：${result.error}`);
        return;
      }
      router.push("/login?registered=1");
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
            <div className="tg soft">交易戰情室 · 操作員註冊</div>
            <h1>台股 AI 交易戰情室</h1>
          </div>
        </div>

        <div className="login-grid">
          <div className="login-copy">
            <div className="tg gold">邀請註冊 · 操作員開通</div>
            <h2>建立操作員帳號</h2>
            <div className="login-scan">
              {[
                ["01", "邀請碼", "必填"],
                ["02", "電子信箱", "必填"],
                ["03", "密碼", "必填"],
                ["04", "角色權限", "開通後確認"],
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
                <span className="tg panel-code">註冊</span>
                <span className="tg muted"> · </span>
                <span className="tg gold">邀請驗證</span>
                <div className="panel-sub">邀請碼 / 電子信箱 / 密碼</div>
              </div>
              <span className="tg soft">僅限受邀</span>
            </div>

            <label className="login-field">
              <span className="tg soft">邀請碼</span>
              <input value={invite} onChange={(event) => setInvite(event.target.value)} type="text" autoComplete="off" placeholder="IUF-XXXX-XXXX" required />
            </label>

            <label className="login-field">
              <span className="tg soft">電子信箱</span>
              <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" placeholder="operator@iuf.local" required />
            </label>

            <label className="login-field">
              <span className="tg soft">密碼</span>
              <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="new-password" placeholder="至少 8 個字元" required />
            </label>

            <label className="login-field">
              <span className="tg soft">確認密碼</span>
              <input value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} type="password" autoComplete="new-password" placeholder="再次輸入密碼" required />
            </label>

            <div className={`login-error ${error ? "active" : ""}`} role="alert" aria-live="polite">
              {error || "錯誤訊息會顯示在這裡"}
            </div>

            <button className="login-submit" type="submit" disabled={loading}>
              {loading ? "建立中..." : "建立帳號 ->"}
            </button>

            <div className="tg soft login-foot">
              已有帳號？ <Link href="/login" style={{ color: "var(--gold-bright)" }}>前往登入</Link>
            </div>
          </form>
        </div>
      </section>
    </main>
  );
}
