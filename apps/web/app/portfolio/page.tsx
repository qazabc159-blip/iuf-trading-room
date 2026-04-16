import { AppShell } from "@/components/app-shell";

export default function PortfolioPage() {
  return (
    <AppShell eyebrow="持倉部位" title="帳戶 · 部位 · 風控">
      <section className="hud-frame" style={{ padding: "1.5rem" }}>
        <p className="ascii-head" data-idx="01">
          [01] 帳戶總覽
        </p>
        <div
          style={{
            padding: "2rem 1rem",
            textAlign: "center",
            color: "var(--muted)",
            fontFamily: "var(--mono, monospace)",
            lineHeight: 1.9
          }}
        >
          <p style={{ color: "var(--amber)", marginBottom: "0.75rem" }}>
            [WAIT] 尚未連接券商
          </p>
          <p>
            Phase 1 路線：先接 TradingView 報價做 prototype → 建立 market data
            layer → 接凱基 API 進 paper trading → 上線 live。
          </p>
          <p style={{ color: "var(--dim)", marginTop: "0.5rem", fontSize: "0.85rem" }}>
            contracts/broker.ts、contracts/risk.ts、contracts/strategy.ts 骨架已就位，
            等 execution bridge 與 quote provider 實作進來。
          </p>
        </div>
      </section>

      <section className="hud-frame" style={{ padding: "1.5rem", marginTop: "1rem" }}>
        <p className="ascii-head" data-idx="02">
          [02] 風控上限（Phase 1 預設）
        </p>
        <ul
          style={{
            listStyle: "none",
            padding: 0,
            margin: 0,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: "0.75rem",
            fontFamily: "var(--mono, monospace)"
          }}
        >
          <li>
            <span style={{ color: "var(--dim)" }}>單筆風險上限</span>
            <div style={{ color: "var(--phosphor)", fontSize: "1.25rem" }}>1.0%</div>
          </li>
          <li>
            <span style={{ color: "var(--dim)" }}>單日最大損失</span>
            <div style={{ color: "var(--amber)", fontSize: "1.25rem" }}>3.0%</div>
          </li>
          <li>
            <span style={{ color: "var(--dim)" }}>單一標的部位</span>
            <div style={{ color: "var(--phosphor)", fontSize: "1.25rem" }}>15.0%</div>
          </li>
          <li>
            <span style={{ color: "var(--dim)" }}>同主題相關曝險</span>
            <div style={{ color: "var(--phosphor)", fontSize: "1.25rem" }}>25.0%</div>
          </li>
        </ul>
      </section>

      <section className="hud-frame" style={{ padding: "1.5rem", marginTop: "1rem" }}>
        <p className="ascii-head" data-idx="03">
          [03] Kill Switch
        </p>
        <div
          style={{
            fontFamily: "var(--mono, monospace)",
            color: "var(--muted)",
            lineHeight: 1.9
          }}
        >
          <p>
            狀態：<span style={{ color: "var(--phosphor)" }}>[TRADING]</span>
            <span style={{ color: "var(--dim)", marginLeft: "1rem" }}>
              (尚未接券商，為預設值)
            </span>
          </p>
          <p style={{ color: "var(--dim)", fontSize: "0.85rem" }}>
            連續虧損、訊號異常、報價延遲、對帳不一致時會自動切到 HALTED / LIQUIDATE_ONLY。
          </p>
        </div>
      </section>
    </AppShell>
  );
}
