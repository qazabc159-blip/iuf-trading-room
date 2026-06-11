import Link from "next/link";
import { LockKeyhole, Radio, ShieldCheck, WalletCards } from "lucide-react";

import { getMyEntitlements } from "@/lib/api";
import { featureStatusLabel, type MyEntitlements, type SubscriptionFeatureId } from "@/lib/subscription-entitlements";

type BrokerFeatureId = Extract<SubscriptionFeatureId, "trading_room_paper" | "kgi_read_only" | "kgi_sim">;

const brokerFeatureIds: Array<{ id: BrokerFeatureId; label: string; note: string }> = [
  { id: "trading_room_paper", label: "Paper 模擬交易", note: "平台模擬帳本，不會送到券商。" },
  { id: "kgi_read_only", label: "KGI 唯讀", note: "讀取券商狀態、資金與部位，不送委託。" },
  { id: "kgi_sim", label: "KGI SIM", note: "送到券商模擬環境，和正式下單完全分離。" },
];

const modes = [
  {
    label: "Paper 模擬",
    state: "已開放",
    tone: "#34d399",
    body: "只寫入 IUF 平台模擬帳本，適合演練交易流程、檢查委託預覽與風控邏輯。",
  },
  {
    label: "KGI 唯讀",
    state: "需憑證與連線",
    tone: "#fbbf24",
    body: "讀取券商模擬或唯讀資訊，協助比對資金、部位與連線健康，不會下單。",
  },
  {
    label: "KGI SIM",
    state: "需高級權限",
    tone: "#fbbf24",
    body: "使用安全憑證送到凱基模擬環境。此模式仍不是正式下單，所有結果需標示 SIM。",
  },
  {
    label: "Real Order",
    state: "停用",
    tone: "#f87171",
    body: "正式下單目前維持鎖定。未完成授權、風控與驗收前，產品不提供真實委託入口。",
  },
];

const secureRules = [
  "瀏覽器頁面不收集 KGI SIM 帳號或密碼。",
  "KGI 憑證必須從安全環境讀取，例如 AWS SSM 或 Railway secret，不寫入 localStorage。",
  "Paper、KGI SIM、Real Order 必須在 UI 和事件紀錄中清楚分開。",
  "Real Order 保持停用，避免任何測試流程誤觸正式委託。",
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
          <Link href="/settings" style={{ color: "var(--fg-3, #888)", fontSize: 12, textDecoration: "none" }}>
            返回設定中心
          </Link>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 18 }}>
            <Radio size={20} strokeWidth={1.8} style={{ color: "var(--accent, #c8943f)" }} />
            <div>
              <div style={{ color: "var(--accent, #c8943f)", fontSize: 11, fontWeight: 900 }}>BROKER CONNECTION</div>
              <h1 style={{ margin: "4px 0 0", fontSize: 24, letterSpacing: 0 }}>券商連線與交易模式</h1>
            </div>
          </div>
          <p style={{ maxWidth: 820, color: "var(--fg-3, #8a93a3)", lineHeight: 1.7, fontSize: 14 }}>
            這裡只顯示連線能力與安全邊界。憑證不在網頁輸入；KGI SIM 需要安全環境提供憑證，
            Real Order 在產品內維持鎖定。
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
            <h2 style={{ margin: 0, fontSize: 16 }}>目前帳號可用能力</h2>
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
                        {status ? featureStatusLabel(status.status) : "未回傳"}
                      </span>
                    </div>
                    <p style={{ margin: "8px 0 0", color: "var(--fg-3, #8a93a3)", fontSize: 12, lineHeight: 1.55 }}>
                      {feature.note} {status?.reason ?? "尚未取得權限狀態。"}
                    </p>
                  </div>
                );
              })}
              <p style={{ gridColumn: "1 / -1", margin: "4px 0 0", color: "var(--fg-3, #8a93a3)", fontSize: 13, lineHeight: 1.6 }}>
                目前方案：{entitlements.subscription.tierName}。KGI 唯讀 / SIM 仍需要憑證、連線與風控檢查通過。
              </p>
            </div>
          ) : (
            <p style={{ margin: 0, color: "#fbbf24", fontSize: 13, lineHeight: 1.7 }}>
              暫時無法讀取權限 API；交易室仍會以 Paper 與安全停用狀態呈現。
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
                    fontWeight: 900,
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
            <h2 style={{ margin: 0, fontSize: 16 }}>憑證與下單安全</h2>
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
              <b>客戶頁不要求貼券商密碼</b>
              <p style={{ margin: "6px 0 0", color: "var(--fg-3, #8a93a3)", fontSize: 13, lineHeight: 1.6 }}>
                如果需要更新 KGI SIM 憑證，應透過安全環境與後端服務處理，不透過一般網頁表單。
              </p>
            </div>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <WalletCards size={18} strokeWidth={1.8} style={{ color: "var(--accent, #c8943f)", flexShrink: 0, marginTop: 2 }} />
            <div>
              <b>訂閱方案決定可用模式</b>
              <p style={{ margin: "6px 0 0", color: "var(--fg-3, #8a93a3)", fontSize: 13, lineHeight: 1.6 }}>
                入門、中級、高級會逐步開放 AI、Paper、策略觀察、KGI 唯讀與 KGI SIM。正式下單仍不開放。
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
