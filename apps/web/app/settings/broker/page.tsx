import Link from "next/link";
import { LockKeyhole, Radio, ShieldCheck, WalletCards } from "lucide-react";

import { getMyEntitlements } from "@/lib/api";
import { featureStatusLabel, type MyEntitlements, type SubscriptionFeatureId } from "@/lib/subscription-entitlements";

type BrokerFeatureId = Extract<SubscriptionFeatureId, "trading_room_paper" | "kgi_read_only" | "kgi_sim">;

const brokerFeatureIds: Array<{ id: BrokerFeatureId; label: string; note: string }> = [
  { id: "trading_room_paper", label: "Paper 模擬交易室", note: "平台內紙上委託，不會送到券商。" },
  { id: "kgi_read_only", label: "KGI Read-only", note: "讀取券商模擬/唯讀資訊，例如連線、庫存與資金狀態。" },
  { id: "kgi_sim", label: "KGI SIM", note: "送出券商模擬委託，仍受平台風控與 SIM 模式限制。" },
];

const modes = [
  {
    label: "Paper 模擬",
    state: "正式可用",
    tone: "#34d399",
    body: "平台內模擬帳本，可預覽與送出紙上委託。這不會讀取券商，也不會送任何委託到外部券商。",
  },
  {
    label: "KGI Read-only",
    state: "高級方案 + 憑證設定",
    tone: "#fbbf24",
    body: "用來讀取券商模擬或唯讀資料，例如連線狀態、庫存、資金與回報。它不提供下單能力。",
  },
  {
    label: "KGI SIM",
    state: "高級方案 + SIM 憑證",
    tone: "#fbbf24",
    body: "用來送出券商模擬委託。憑證只從安全環境讀取，頁面不顯示帳號、密碼或任何參數路徑。",
  },
  {
    label: "Real Order",
    state: "正式封鎖",
    tone: "#f87171",
    body: "正式實單目前停用。高級方案不會自動開啟實單，必須另有合規、風控與 Owner 核准流程。",
  },
];

const secureRules = [
  "本頁不收券商帳號、密碼、憑證路徑，也不把秘密值寫進瀏覽器、localStorage 或畫面文字。",
  "KGI SIM 目前應使用安全環境中的模擬憑證；不要在聊天、截圖、PR 或前端表單貼出密碼。",
  "券商憑證更新後，由後端 gateway / 安全環境讀取；前端只顯示連線與權限狀態。",
  "Real Order 維持停用；任何正式下單能力都不能因訂閱方案或 UI 按鈕被誤開。",
];

function brokerFeatureStatus(entitlements: MyEntitlements | null, id: BrokerFeatureId) {
  return entitlements?.features.find((feature) => feature.id === id) ?? null;
}

export default async function BrokerSettingsPage() {
  const entitlementEnvelope = await getMyEntitlements().catch(() => null);
  const entitlements = entitlementEnvelope?.data ?? null;

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
              <h1 style={{ margin: "4px 0 0", fontSize: 24, letterSpacing: 0 }}>券商連線與安全模式</h1>
            </div>
          </div>
          <p style={{ maxWidth: 820, color: "var(--fg-3, #8a93a3)", lineHeight: 1.7, fontSize: 14 }}>
            這裡只顯示券商功能的權限與安全狀態。憑證應放在受控安全環境，由後端讀取；前端不收、不存、不顯示任何密碼或參數路徑。
          </p>
        </header>

        <section
          style={{
            border: "1px solid rgba(52,211,153,0.20)",
            background: "rgba(52,211,153,0.045)",
            padding: 20,
            marginBottom: 22,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
            <ShieldCheck size={18} strokeWidth={1.8} style={{ color: "#34d399" }} />
            <h2 style={{ margin: 0, fontSize: 16 }}>目前帳號的券商權限</h2>
          </div>
          {entitlements ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 10 }}>
              {brokerFeatureIds.map((feature) => {
                const status = brokerFeatureStatus(entitlements, feature.id);
                const access = status?.access === true;
                return (
                  <div
                    key={feature.id}
                    style={{
                      border: `1px solid ${access ? "rgba(52,211,153,0.28)" : "rgba(251,191,36,0.28)"}`,
                      background: access ? "rgba(52,211,153,0.055)" : "rgba(251,191,36,0.055)",
                      padding: "12px 14px",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                      <b>{feature.label}</b>
                      <span style={{ color: access ? "#34d399" : "#fbbf24", fontSize: 12, fontWeight: 900 }}>
                        {status ? featureStatusLabel(status.status) : "未包含"}
                      </span>
                    </div>
                    <p style={{ margin: "8px 0 0", color: "var(--fg-3, #8a93a3)", fontSize: 12, lineHeight: 1.55 }}>
                      {feature.note} {status?.reason ?? "權限資料尚未回傳。"}
                    </p>
                  </div>
                );
              })}
              <p style={{ gridColumn: "1 / -1", margin: "4px 0 0", color: "var(--fg-3, #8a93a3)", fontSize: 13, lineHeight: 1.6 }}>
                目前方案：{entitlements.subscription.tierName}。KGI read-only / SIM 即使在高級方案，也仍需要憑證設定與後端 gateway 正常連線。
              </p>
            </div>
          ) : (
            <p style={{ margin: 0, color: "#fbbf24", fontSize: 13, lineHeight: 1.7 }}>
              目前無法讀取帳號權限 API；為安全起見，KGI read-only 與 SIM 會視為尚未開通。
            </p>
          )}
        </section>

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
              <b>方案決定能不能看到券商功能</b>
              <p style={{ margin: "6px 0 0", color: "var(--fg-3, #8a93a3)", fontSize: 13, lineHeight: 1.6 }}>
                入門與中級不開 KGI SIM；高級才會顯示券商 SIM/read-only 能力，但仍要完成安全設定。
              </p>
            </div>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <WalletCards size={18} strokeWidth={1.8} style={{ color: "var(--accent, #c8943f)", flexShrink: 0, marginTop: 2 }} />
            <div>
              <b>連線狀態由後端與安全環境決定</b>
              <p style={{ margin: "6px 0 0", color: "var(--fg-3, #8a93a3)", fontSize: 13, lineHeight: 1.6 }}>
                這頁只讀取權限與安全模式；實際 gateway、quote、trade 連線狀態由後端 API 回報，不由前端假裝成功。
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
