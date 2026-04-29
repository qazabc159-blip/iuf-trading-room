"use client";
/**
 * Positions table — Taiwan red/green allowed (exec layer).
 *
 * Click any row → seed an IdeaHandoff-shaped session entry that primes the
 * OrderTicket form with SELL/TRIM for that symbol. We reuse the IdeaHandoff
 * shuttle even though it's not from an idea — the form treats it identically.
 */
import { useRouter } from "next/navigation";
import type { Position } from "@/lib/radar-types";
import { setIdeaHandoff } from "@/lib/radar-handoff";

export function PositionsTable({ positions }: { positions: Position[] }) {
  const router = useRouter();
  const seedTrim = (p: Position) => {
    setIdeaHandoff({
      ideaId: `POS-${p.symbol}`,
      symbol: p.symbol,
      side: "TRIM",
      rationale: `來自持倉列點選 · ${p.name} · 帶入 TRIM 預設`,
      themeCode: "—",
      emittedAt: new Date().toISOString(),
    });
    // scroll to ticket
    document.getElementById("order-ticket")?.scrollIntoView({ behavior: "smooth", block: "start" });
    router.refresh();
  };

  return (
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead>
        <tr style={{ borderBottom: "1px solid var(--exec-rule-strong)", color: "var(--exec-mid)" }}>
          {["SYMBOL","NAME","QTY","AVG","LAST","Δ%","P&L · TWD","%NAV",""].map(h => (
            <th key={h} className="tg" style={{ textAlign: "left", padding: "8px 6px", fontWeight: 500 }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {positions.map(p => (
          <tr key={p.symbol}
              onClick={() => seedTrim(p)}
              style={{
                borderBottom: "1px solid var(--exec-rule)",
                cursor: "pointer",
              }}
              onMouseEnter={e => (e.currentTarget.style.background = "rgba(184,138,62,0.06)")}
              onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
          >
            <td className="tg" style={{ padding: "10px 6px", color: "var(--gold)" }}>{p.symbol}</td>
            <td style={{ padding: "10px 6px", fontFamily: "var(--serif-tc)", fontSize: 15, color: "var(--exec-ink)" }}>{p.name}</td>
            <td style={{ padding: "10px 6px", color: "var(--exec-ink)", fontFamily: "var(--mono)", fontSize: 12, fontFeatureSettings: '"tnum","lnum"' }}>{p.qty.toLocaleString()}</td>
            <td style={{ padding: "10px 6px", color: "var(--exec-mid)", fontFamily: "var(--mono)", fontSize: 12, fontFeatureSettings: '"tnum","lnum"' }}>{p.avgPx.toFixed(2)}</td>
            <td style={{ padding: "10px 6px", color: "var(--exec-ink)", fontFamily: "var(--mono)", fontSize: 12, fontFeatureSettings: '"tnum","lnum"' }}>{p.lastPx.toFixed(2)}</td>
            <td style={{ padding: "10px 6px", color: p.changePct >= 0 ? "var(--tw-up)" : "var(--tw-dn)", fontFamily: "var(--mono)", fontSize: 12, fontWeight: 600, fontFeatureSettings: '"tnum","lnum"' }}>{p.changePct.toFixed(2)}%</td>
            <td style={{ padding: "10px 6px", color: p.pnlTwd >= 0 ? "var(--tw-up)" : "var(--tw-dn)", fontFamily: "var(--mono)", fontSize: 12, fontWeight: 600, fontFeatureSettings: '"tnum","lnum"' }}>{p.pnlTwd >= 0 ? "+" : ""}{p.pnlTwd.toLocaleString()}</td>
            <td style={{ padding: "10px 6px", color: "var(--exec-mid)", fontFamily: "var(--mono)", fontSize: 12, fontFeatureSettings: '"tnum","lnum"' }}>{p.pctNav.toFixed(1)}%</td>
            <td style={{ padding: "10px 6px", color: "var(--exec-soft)", fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.16em", textAlign: "right" }}>↘ TRIM</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
