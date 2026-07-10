import Link from "next/link";
import { KeyRound, Radio, ShieldCheck, WalletCards } from "lucide-react";

import { PushNotificationSettings } from "./PushNotificationSettings";

const settingCards = [
  {
    href: "/settings/account",
    icon: KeyRound,
    eyebrow: "ACCOUNT",
    title: "帳號與安全",
    body: "變更密碼、重新登入與帳號安全檢查。這裡不保存券商憑證，也不顯示任何密碼內容。",
    status: "可用",
    tone: "#34d399",
  },
  {
    href: "/settings/broker",
    icon: Radio,
    eyebrow: "BROKER",
    title: "券商連線",
    body: "查看 Paper、KGI 唯讀、KGI SIM 與正式下單停用邊界。KGI 憑證只走安全環境，不在瀏覽器輸入。",
    status: "SIM / 唯讀",
    tone: "#fbbf24",
  },
  {
    href: "/settings/subscription",
    icon: WalletCards,
    eyebrow: "PLAN",
    title: "訂閱與權限",
    body: "檢查入門、中級、高級、Owner 內部權限，以及哪些功能已開啟、哪些仍需升級或券商連線。",
    status: "分級權限",
    tone: "#c8943f",
  },
];

export default function SettingsIndexPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        background: "var(--bg-0, #0d0d0d)",
        color: "var(--fg-1, #ddd)",
        padding: "56px 18px",
      }}
    >
      <div style={{ width: "100%", maxWidth: 1120, margin: "0 auto" }}>
        <header style={{ marginBottom: 28 }}>
          <div style={{ color: "var(--accent, #c8943f)", fontSize: 11, fontWeight: 900, letterSpacing: "0.08em" }}>
            SETTINGS
          </div>
          <h1 style={{ margin: "8px 0 0", fontSize: 30, letterSpacing: 0 }}>設定中心</h1>
          <p style={{ maxWidth: 780, color: "var(--fg-3, #8a93a3)", lineHeight: 1.7, fontSize: 14 }}>
            管理帳號安全、券商連線與訂閱權限。正式下單目前維持停用；Paper、KGI SIM 與 KGI
            唯讀會用清楚標示分開，避免把測試環境誤看成真實下單。
          </p>
        </header>

        <section
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: 14,
            marginBottom: 22,
          }}
        >
          {settingCards.map((card) => {
            const Icon = card.icon;
            return (
              <Link
                key={card.href}
                href={card.href}
                style={{
                  display: "block",
                  border: "1px solid rgba(200,148,63,0.22)",
                  background: "linear-gradient(180deg, rgba(18,18,18,0.96), rgba(8,8,8,0.98))",
                  color: "inherit",
                  minHeight: 210,
                  padding: 20,
                  textDecoration: "none",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <Icon size={19} strokeWidth={1.8} style={{ color: card.tone }} />
                    <span style={{ color: card.tone, fontSize: 11, fontWeight: 900, letterSpacing: "0.08em" }}>
                      {card.eyebrow}
                    </span>
                  </div>
                  <span
                    style={{
                      color: card.tone,
                      border: `1px solid ${card.tone}55`,
                      background: `${card.tone}14`,
                      padding: "3px 8px",
                      fontSize: 11,
                      fontWeight: 900,
                    }}
                  >
                    {card.status}
                  </span>
                </div>
                <h2 style={{ margin: "24px 0 10px", fontSize: 20, letterSpacing: 0 }}>{card.title}</h2>
                <p style={{ margin: 0, color: "var(--fg-3, #8a93a3)", lineHeight: 1.65, fontSize: 13 }}>
                  {card.body}
                </p>
                <div style={{ marginTop: 22, color: "var(--accent, #c8943f)", fontSize: 13, fontWeight: 900 }}>
                  進入設定 →
                </div>
              </Link>
            );
          })}
        </section>

        <PushNotificationSettings />

        <section
          style={{
            border: "1px solid rgba(52,211,153,0.20)",
            background: "rgba(52,211,153,0.045)",
            padding: 20,
          }}
        >
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <ShieldCheck size={18} strokeWidth={1.8} style={{ color: "#34d399", flexShrink: 0, marginTop: 2 }} />
            <div>
              <h2 style={{ margin: 0, fontSize: 16 }}>安全邊界</h2>
              <p style={{ margin: "8px 0 0", color: "var(--fg-3, #8a93a3)", fontSize: 13, lineHeight: 1.7 }}>
                客戶帳號只看到正式產品功能；Owner 帳號才看得到後台與內部診斷。KGI SIM 憑證應從安全環境讀取，
                不會要求使用者在一般頁面貼密碼。Real Order 仍維持鎖定，直到風控與授權流程完整驗收。
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
