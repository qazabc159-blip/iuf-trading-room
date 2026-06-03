import Link from "next/link";
import { CalendarDays, CreditCard, LockKeyhole, ShieldCheck, Sparkles } from "lucide-react";

import {
  billingCycleLabel,
  billingCycles,
  featureStatusLabel,
  subscriptionFeatures,
  subscriptionTiers,
  tierFeatureStatus,
  tierPriceLabel,
  type EntitlementStatus,
} from "@/lib/subscription-entitlements";

const pageStyle = {
  minHeight: "100vh",
  background: "var(--bg-0, #0d0d0d)",
  color: "var(--fg-1, #ddd)",
  padding: "56px 18px",
} as const;

const shellStyle = {
  width: "100%",
  maxWidth: 1160,
  margin: "0 auto",
} as const;

const panelStyle = {
  border: "1px solid rgba(200,148,63,0.22)",
  background: "linear-gradient(180deg, rgba(18,18,18,0.96), rgba(10,10,10,0.98))",
  boxShadow: "0 0 0 1px rgba(255,255,255,0.02), 0 18px 46px rgba(0,0,0,0.28)",
} as const;

const statusTone: Record<EntitlementStatus, { color: string; border: string; background: string }> = {
  included: {
    color: "#34d399",
    border: "rgba(52,211,153,0.35)",
    background: "rgba(52,211,153,0.08)",
  },
  limited: {
    color: "#fbbf24",
    border: "rgba(251,191,36,0.35)",
    background: "rgba(251,191,36,0.08)",
  },
  not_included: {
    color: "#94a3b8",
    border: "rgba(148,163,184,0.22)",
    background: "rgba(148,163,184,0.05)",
  },
  owner_only: {
    color: "#f87171",
    border: "rgba(248,113,113,0.32)",
    background: "rgba(248,113,113,0.08)",
  },
};

function StatusBadge({ status }: { status: EntitlementStatus }) {
  const tone = statusTone[status];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 72,
        border: `1px solid ${tone.border}`,
        background: tone.background,
        color: tone.color,
        padding: "4px 8px",
        fontSize: 11,
        fontWeight: 700,
      }}
    >
      {featureStatusLabel(status)}
    </span>
  );
}

export default function SubscriptionSettingsPage() {
  return (
    <main style={pageStyle}>
      <div style={shellStyle}>
        <header style={{ marginBottom: 28 }}>
          <Link
            href="/settings/account"
            style={{
              color: "var(--fg-3, #888)",
              fontSize: 12,
              textDecoration: "none",
            }}
          >
            返回帳號設定
          </Link>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 18 }}>
            <CreditCard size={20} strokeWidth={1.7} style={{ color: "var(--accent, #c8943f)" }} />
            <div>
              <div style={{ color: "var(--accent, #c8943f)", fontSize: 11, fontWeight: 800 }}>
                SUBSCRIPTION / ENTITLEMENTS
              </div>
              <h1 style={{ margin: "4px 0 0", fontSize: 24, letterSpacing: 0 }}>訂閱與功能權限</h1>
            </div>
          </div>
          <p style={{ maxWidth: 820, color: "var(--fg-3, #8a93a3)", lineHeight: 1.7, fontSize: 14 }}>
            一般使用者會看到完整客戶產品頁，功能依入門、中級、高級方案開啟。Owner 後台是系統治理入口，
            不屬於任何客戶訂閱方案；正式付款、折扣與試用天數尚未串接，不在此頁假裝已收費。
          </p>
        </header>

        <section
          style={{
            ...panelStyle,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: 1,
            marginBottom: 22,
          }}
        >
          {subscriptionTiers.map((tier) => (
            <article key={tier.id} style={{ padding: 22, borderRight: "1px solid rgba(255,255,255,0.04)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <div>
                  <div style={{ color: "var(--accent, #c8943f)", fontSize: 11, fontWeight: 800 }}>
                    {tier.levelLabel}
                  </div>
                  <h2 style={{ margin: "6px 0 0", fontSize: 22 }}>{tier.name}</h2>
                </div>
                {tier.id === "premium" ? (
                  <Sparkles size={21} strokeWidth={1.7} style={{ color: "#fbbf24" }} />
                ) : (
                  <ShieldCheck size={21} strokeWidth={1.7} style={{ color: "var(--fg-3, #888)" }} />
                )}
              </div>
              <p style={{ color: "var(--fg-2, #b9c0cc)", fontSize: 13, lineHeight: 1.6, minHeight: 42 }}>
                {tier.entitlementSummary}
              </p>
              <p style={{ color: "var(--fg-3, #7f8792)", fontSize: 12, lineHeight: 1.6, minHeight: 38 }}>
                {tier.targetUser}
              </p>
              <div style={{ display: "grid", gap: 8, marginTop: 18 }}>
                {billingCycles.map((cycle) => (
                  <div
                    key={cycle}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      border: "1px solid rgba(200,148,63,0.16)",
                      background: "rgba(200,148,63,0.045)",
                      padding: "9px 10px",
                    }}
                  >
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--fg-3, #8a93a3)", fontSize: 12 }}>
                      <CalendarDays size={14} strokeWidth={1.8} />
                      {billingCycleLabel(cycle)}
                    </span>
                    <strong style={{ color: "var(--fg-1, #ddd)", fontSize: 13 }}>{tierPriceLabel(tier, cycle)}</strong>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </section>

        <section style={{ ...panelStyle, padding: 22, marginBottom: 22 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 14 }}>
            <ShieldCheck size={18} strokeWidth={1.7} style={{ color: "var(--accent, #c8943f)" }} />
            <h2 style={{ margin: 0, fontSize: 16 }}>功能權限矩陣</h2>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760, fontSize: 13 }}>
              <thead>
                <tr style={{ color: "var(--fg-3, #8a93a3)", textAlign: "left" }}>
                  <th style={{ padding: "10px 8px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>功能</th>
                  {subscriptionTiers.map((tier) => (
                    <th key={tier.id} style={{ padding: "10px 8px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                      {tier.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {subscriptionFeatures.map((feature) => (
                  <tr key={feature.id}>
                    <td style={{ padding: "12px 8px", borderBottom: "1px solid rgba(255,255,255,0.055)" }}>
                      <div style={{ color: "var(--fg-1, #ddd)", fontWeight: 800 }}>{feature.label}</div>
                      <div style={{ color: "var(--fg-3, #8a93a3)", marginTop: 4, lineHeight: 1.5 }}>
                        {feature.customerCopy}
                        {feature.requiresBroker ? " 需完成券商連線設定。" : ""}
                      </div>
                    </td>
                    {subscriptionTiers.map((tier) => (
                      <td key={`${tier.id}-${feature.id}`} style={{ padding: "12px 8px", borderBottom: "1px solid rgba(255,255,255,0.055)" }}>
                        <StatusBadge status={tierFeatureStatus(tier.id, feature.id)} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section
          style={{
            ...panelStyle,
            padding: 20,
            display: "grid",
            gap: 12,
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          }}
        >
          <div style={{ display: "flex", gap: 10 }}>
            <LockKeyhole size={18} strokeWidth={1.8} style={{ color: "#f87171", flexShrink: 0, marginTop: 2 }} />
            <div>
              <b>Owner 後台不跟訂閱混在一起</b>
              <p style={{ margin: "6px 0 0", color: "var(--fg-3, #8a93a3)", fontSize: 13, lineHeight: 1.6 }}>
                Brain、EventLog、ToolCenter、UTA、內部策略治理只給 Owner 帳號看；客戶方案不會開這些入口。
              </p>
            </div>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <CreditCard size={18} strokeWidth={1.8} style={{ color: "var(--accent, #c8943f)", flexShrink: 0, marginTop: 2 }} />
            <div>
              <b>付款與正式定價尚未接線</b>
              <p style={{ margin: "6px 0 0", color: "var(--fg-3, #8a93a3)", fontSize: 13, lineHeight: 1.6 }}>
                這頁先建立產品權限邊界。之後接 Stripe、綠界或其他金流時，再把真價格、試用、折扣與發票資料接上。
              </p>
            </div>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <ShieldCheck size={18} strokeWidth={1.8} style={{ color: "#34d399", flexShrink: 0, marginTop: 2 }} />
            <div>
              <b>券商連線另有安全邊界</b>
              <p style={{ margin: "6px 0 10px", color: "var(--fg-3, #8a93a3)", fontSize: 13, lineHeight: 1.6 }}>
                KGI read-only / SIM 即使在高級方案，也需要安全憑證、後端 vault、風控與連線狀態通過。
              </p>
              <Link href="/settings/broker" style={{ color: "var(--accent, #c8943f)", fontSize: 13, fontWeight: 800, textDecoration: "none" }}>
                查看券商連線設定
              </Link>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
