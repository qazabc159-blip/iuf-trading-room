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

const REGISTER_STEPS = [
  {
    label: "邀請開通",
    state: "現在",
    body: "現在先用邀請碼保護測試名單；公開測試時會改成自助註冊。",
  },
  {
    label: "個人工作台",
    state: "建立後",
    body: "帳號建立後會保留觀察清單、策略草稿、模擬交易與風控設定。",
  },
  {
    label: "券商綁定預留",
    state: "預留",
    body: "未來可將自己的證券帳號接到同一個 IUF 帳號底下。",
  },
  {
    label: "分級功能",
    state: "後續",
    body: "進階資料、AI 摘要、量化研究包與自動化功能會依權限逐步開放。",
  },
];

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
        setError(ERROR_TEXT[result.error] ?? "註冊暫時無法完成，請稍後再試。");
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
            <div className="tg gold">建立帳號 · 測試席位開通</div>
            <h2>先建立網站帳號，券商綁定之後再接</h2>
            <p className="login-intro">
              這裡建立的是 IUF 網站帳號，不是券商帳號，也不會觸發任何下單功能。
              帳號建立後可以進入戰情室、保存個人設定，之後再逐步開放券商綁定與訂閱權限。
            </p>
            <div className="login-copy-actions">
              <Link href="/login" className="login-secondary-cta">已有帳號，前往登入</Link>
              <span className="tc soft">目前採邀請碼測試；公開測試時會改成一般使用者可自行申請。</span>
            </div>
            <div className="login-capability-list">
              {REGISTER_STEPS.map((item) => (
                <div className="login-capability-card" key={item.label}>
                  <div>
                    <span className="tg gold">{item.label}</span>
                    <p>{item.body}</p>
                  </div>
                  <span className={`tg capability-state ${item.state === "現在" || item.state === "建立後" ? "status-ok" : "gold"}`}>
                    {item.state}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <form className="login-panel" onSubmit={submit} noValidate>
            <div className="panel-head">
              <div>
                <span className="tg panel-code">註冊</span>
                <span className="tg muted"> · </span>
                <span className="tg gold">測試帳號開通</span>
                <div className="panel-sub">邀請碼 / 電子信箱 / 密碼 / 確認</div>
              </div>
              <span className="tg gold">邀請制</span>
            </div>

            <label className="login-field">
              <span className="tg soft">邀請碼</span>
              <input value={invite} onChange={(event) => setInvite(event.target.value)} type="text" autoComplete="off" placeholder="IUF-XXXX-XXXX" required />
            </label>

            <label className="login-field">
              <span className="tg soft">電子信箱</span>
              <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" placeholder="輸入你的電子信箱" required />
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
              {loading ? "建立中..." : "建立帳號"}
            </button>

            <div className="tg soft login-foot">
              已有帳號？ <Link href="/login" style={{ color: "var(--gold-bright)" }}>前往登入</Link>
              <br />
              管理員可前往 <Link href="/admin/invites" style={{ color: "var(--gold-bright)" }}>邀請碼管理</Link>
            </div>
          </form>
        </div>
      </section>
    </main>
  );
}
