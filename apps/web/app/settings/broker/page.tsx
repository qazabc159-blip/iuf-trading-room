import Link from "next/link";
import { LockKeyhole, Radio, ShieldCheck, WalletCards } from "lucide-react";

const modes = [
  {
    label: "Paper 模擬",
    state: "客戶可用",
    tone: "#34d399",
    body: "平台內模擬帳本、委託、成交與資金紀錄；不碰券商，不會產生正式委託。",
  },
  {
    label: "KGI Read-only",
    state: "高級方案 + 安全憑證",
    tone: "#fbbf24",
    body: "讀取券商狀態、庫存或資金摘要；只讀不寫入，憑證不得進聊天或前端表單。",
  },
  {
    label: "KGI SIM",
    state: "高級方案 + SIM 憑證",
    tone: "#fbbf24",
    body: "送到券商模擬環境，仍不是正式實單；目前以 Owner 安全環境驗證，客戶 onboarding 需後端 vault。",
  },
  {
    label: "Real Order",
    state: "正式封鎖",
    tone: "#f87171",
    body: "真實券商寫入不屬於目前客戶方案；必須另外完成法遵、風控、合約與人工開通。",
  },
];

const secureRules = [
  "不要把券商密碼貼在聊天、PR、截圖、瀏覽器 localStorage 或一般環境變數。",
  "現階段 Owner 測試憑證走 AWS SSM 或受控部署環境，例如 /iuf/kgi/sim_person_id 與 /iuf/kgi/sim_person_pwd。",
  "未來客戶憑證必須走後端加密 vault、一次性 onboarding、權限稽核與可撤銷連線。",
  "所有券商連線失敗都要顯示原因；不能用假綠燈或假行情替代。",
];

export default function BrokerSettingsPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        background: "var(--bg-0, #0d0d0d)",
        color: "var(--fg-1, #ddd)",
        padding: "56px 18px",
      }}
    >
      <div style={{ width: "100%", maxWidth: 1100, margin: "0 auto" }}>
        <header style={{ marginBottom: 28 }}>
          <Link href="/settings/account" style={{ color: "var(--fg-3, #888)", fontSize: 12, textDecoration: "none" }}>
            返回帳號設定
          </Link>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 18 }}>
            <Radio size={20} strokeWidth={1.8} style={{ color: "var(--accent, #c8943f)" }} />
            <div>
              <div style={{ color: "var(--accent, #c8943f)", fontSize: 11, fontWeight: 800 }}>
                BROKER CONNECTION
              </div>
              <h1 style={{ margin: "4px 0 0", fontSize: 24, letterSpacing: 0 }}>券商連線與交易模式</h1>
            </div>
          </div>
          <p style={{ maxWidth: 820, color: "var(--fg-3, #8a93a3)", lineHeight: 1.7, fontSize: 14 }}>
            這裡整理客戶能看懂的交易模式邊界：網站帳號不是券商帳號，訂閱方案只決定功能可用性；
            券商憑證必須走安全儲存與後端連線，不在此頁輸入、不在前端保存。
          </p>
        </header>

        <section
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))",
            gap: 12,
            marginBottom: 22,
          }}
        >
          {modes.map((mode) => (
            <article
              key={mode.label}
              style={{
                border: "1px solid rgba(200,148,63,0.22)",
                background: "linear-gradient(180deg, rgba(18,18,18,0.96), rgba(8,8,8,0.98))",
                padding: 18,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <b>{mode.label}</b>
                <span
                  style={{
                    color: mode.tone,
                    border: `1px solid ${mode.tone}55`,
                    background: `${mode.tone}14`,
                    padding: "3px 7px",
                    fontSize: 11,
                    fontWeight: 800,
                  }}
                >
                  {mode.state}
                </span>
              </div>
              <p style={{ color: "var(--fg-3, #8a93a3)", lineHeight: 1.65, fontSize: 13, margin: "12px 0 0" }}>
                {mode.body}
              </p>
            </article>
          ))}
        </section>

        <section
          style={{
            border: "1px solid rgba(248,113,113,0.28)",
            background: "rgba(248,113,113,0.055)",
            padding: 20,
            marginBottom: 22,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <LockKeyhole size={18} strokeWidth={1.8} style={{ color: "#f87171" }} />
            <h2 style={{ margin: 0, fontSize: 16 }}>憑證安全規則</h2>
          </div>
          <div style={{ display: "grid", gap: 9 }}>
            {secureRules.map((rule) => (
              <div key={rule} style={{ color: "var(--fg-2, #bcc4cf)", fontSize: 13, lineHeight: 1.55 }}>
                {rule}
              </div>
            ))}
          </div>
        </section>

        <section
          style={{
            border: "1px solid rgba(200,148,63,0.22)",
            background: "linear-gradient(180deg, rgba(18,18,18,0.96), rgba(8,8,8,0.98))",
            padding: 20,
            display: "grid",
            gap: 14,
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          }}
        >
          <div style={{ display: "flex", gap: 10 }}>
            <ShieldCheck size={18} strokeWidth={1.8} style={{ color: "#34d399", flexShrink: 0, marginTop: 2 }} />
            <div>
              <b>客戶方案與券商模式分開控管</b>
              <p style={{ margin: "6px 0 0", color: "var(--fg-3, #8a93a3)", fontSize: 13, lineHeight: 1.6 }}>
                入門/中級/高級決定資料與功能權限；券商連線還需要安全憑證、風控與連線狀態通過。
              </p>
            </div>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <WalletCards size={18} strokeWidth={1.8} style={{ color: "var(--accent, #c8943f)", flexShrink: 0, marginTop: 2 }} />
            <div>
              <b>下一步：接後端 entitlement 與 vault</b>
              <p style={{ margin: "6px 0 0", color: "var(--fg-3, #8a93a3)", fontSize: 13, lineHeight: 1.6 }}>
                這頁先建立產品邊界；後續才把方案、付款、試用期、券商 vault 與每個 endpoint 的權限檢查接起來。
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
