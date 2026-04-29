"use client";
/**
 * RightInspector — W4 Fix 3
 * Right-side drawer Sheet opened when operator clicks a company row.
 * Ported from sandbox v0.7.0-w4, adapted for production Company type.
 *
 * Production Company: { id, name, ticker, market, country, themeIds,
 *   chainPosition, beneficiaryTier, exposure, validation, notes, updatedAt }
 *   — no live market data (intradayChgPct / score / fiiNetBn5d / marketCapBn)
 *   — themeIds replaces themes[]
 *
 * Contents:
 *   - Header: ticker + name
 *   - Small read-only spark chart (deterministic mock, 20 bars — no live API)
 *   - Radar chart: ABILITY / FIT / COVER / EVENT / MOMO / SCALE (SVG polygon)
 *   - Quick stats: chain / tier / exposure summary
 *   - Theme IDs
 *   - "查看個股頁 →" link (jumps to /companies/[ticker], NOT order submission)
 *
 * No order entry. No AI wording. No fade-in.
 */

import { useEffect, useRef } from "react";
import Link from "next/link";
import type { Company } from "@iuf-trading-room/contracts";

/* ─── Radar ──────────────────────────────────────────────────── */
const RADAR_DIMS = ["ABILITY", "FIT", "COVER", "EVENT", "MOMO", "SCALE"] as const;
type RadarDim = typeof RADAR_DIMS[number];

function mockRadarScores(ticker: string, exposureTotal: number): Record<RadarDim, number> {
  const h = ticker.split("").reduce((a, ch) => a + ch.charCodeAt(0), 0);
  return {
    ABILITY: (((h * 7  + exposureTotal * 8) % 40) + 55) / 100,
    FIT:     (((h * 11 + exposureTotal * 6) % 38) + 50) / 100,
    COVER:   (((h * 13 + 70)               % 35) + 48) / 100,
    EVENT:   (((h * 3  + exposureTotal * 5) % 42) + 45) / 100,
    MOMO:    (((h * 17 + exposureTotal * 7) % 36) + 52) / 100,
    SCALE:   (((h * 5  + exposureTotal * 4) % 38) + 50) / 100,
  };
}

function RadarChart({ ticker, exposureTotal }: { ticker: string; exposureTotal: number }) {
  const scores = mockRadarScores(ticker, exposureTotal);
  const N = RADAR_DIMS.length;
  const CX = 110, CY = 110, R = 80;

  function polarToCart(angle: number, r: number) {
    const a = (angle - 90) * (Math.PI / 180);
    return { x: CX + r * Math.cos(a), y: CY + r * Math.sin(a) };
  }

  const rings = [0.25, 0.5, 0.75, 1.0];
  const axes = RADAR_DIMS.map((dim, i) => {
    const angle = (360 / N) * i;
    const outer = polarToCart(angle, R);
    const label = polarToCart(angle, R + 18);
    return { dim, angle, outer, label };
  });

  const scorePoints = RADAR_DIMS.map((dim, i) => {
    const angle = (360 / N) * i;
    const r = scores[dim] * R;
    return polarToCart(angle, r);
  });
  const polyStr = scorePoints.map(p => `${p.x},${p.y}`).join(" ");

  return (
    <svg width={220} height={220} style={{ overflow: "visible" }}>
      {rings.map(ring => {
        const ringPts = RADAR_DIMS.map((_, i) => {
          const angle = (360 / N) * i;
          const p = polarToCart(angle, ring * R);
          return `${p.x},${p.y}`;
        }).join(" ");
        return <polygon key={ring} points={ringPts} fill="none" stroke="var(--night-rule-strong)" strokeWidth={0.8} />;
      })}
      {axes.map(ax => (
        <line key={ax.dim} x1={CX} y1={CY} x2={ax.outer.x} y2={ax.outer.y} stroke="var(--night-rule-strong)" strokeWidth={0.8} />
      ))}
      <polygon points={polyStr} fill="var(--tw-up-faint)" stroke="var(--gold)" strokeWidth={1.4} strokeLinejoin="round" />
      {scorePoints.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={2.5} fill="var(--gold-bright)" />)}
      {axes.map(ax => {
        const score = scores[ax.dim];
        const scoreVal = (score * 100).toFixed(0);
        const a = ax.angle % 360;
        const anchor = a < 30 || a > 330 ? "middle" : a < 150 ? "start" : a < 210 ? "middle" : "end";
        return (
          <g key={ax.dim}>
            <text x={ax.label.x} y={ax.label.y} textAnchor={anchor} dominantBaseline="middle"
              fontFamily="var(--mono)" fontSize={8} letterSpacing="0.12em" fill="var(--night-mid)">{ax.dim}</text>
            <text x={ax.label.x} y={ax.label.y + 10} textAnchor={anchor} dominantBaseline="middle"
              fontFamily="var(--mono)" fontSize={9} fontWeight={700} fill="var(--gold-bright)">{scoreVal}</text>
          </g>
        );
      })}
    </svg>
  );
}

/* ─── Small read-only spark chart ────────────────────────────── */
function InspectorSparkline({ ticker }: { ticker: string }) {
  const seed = ticker.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const base = 100 + (seed % 900);
  const bars = Array.from({ length: 20 }, (_, i) => {
    const v = base + Math.sin(i * 0.8 + seed * 0.01) * 8 + i * 0.3;
    const noise = ((seed * (i + 1) * 1664525 + 1013904223) & 0xffff) / 0xffff;
    const o = v - (noise * 4 - 2);
    const h = Math.max(v, o) + noise * 3;
    const l = Math.min(v, o) - noise * 3;
    return { o, h, l, c: v };
  });

  const W = 260, H = 64;
  const allPx = bars.flatMap(b => [b.h, b.l]);
  const min = Math.min(...allPx);
  const max = Math.max(...allPx);
  const range = max - min || 1;
  const barW = W / bars.length - 1;

  function py(v: number) { return H - ((v - min) / range) * H; }

  return (
    <svg width={W} height={H} style={{ display: "block" }}>
      {bars.map((b, i) => {
        const x = i * (W / bars.length);
        const up = b.c >= b.o;
        const color = up ? "var(--tw-up)" : "var(--tw-dn)";
        const bodyTop = py(Math.max(b.o, b.c));
        const bodyBot = py(Math.min(b.o, b.c));
        const bodyH = Math.max(1, bodyBot - bodyTop);
        return (
          <g key={i}>
            <line x1={x + barW / 2} y1={py(b.h)} x2={x + barW / 2} y2={py(b.l)} stroke={color} strokeWidth={0.8} opacity={0.6} />
            <rect x={x + 0.5} y={bodyTop} width={barW - 1} height={bodyH} fill={color} opacity={0.85} />
          </g>
        );
      })}
    </svg>
  );
}

/* ─── Inspector component ────────────────────────────────────── */
interface RightInspectorProps {
  company: Company;
  onClose: () => void;
}

export function RightInspector({ company: c, onClose }: RightInspectorProps) {
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const exposureTotal = c.exposure
    ? Object.values(c.exposure).reduce((s, v) => s + (Number(v) || 0), 0)
    : 0;
  const exposureSummary = c.exposure
    ? `${c.exposure.volume}/${c.exposure.asp}/${c.exposure.margin}/${c.exposure.capacity}/${c.exposure.narrative}`
    : "N/A";

  const tierColor =
    c.beneficiaryTier === "Core"        ? "var(--tw-up)" :
    c.beneficiaryTier === "Direct"      ? "var(--gold-bright)" :
    c.beneficiaryTier === "Indirect"    ? "var(--night-ink)" :
                                          "var(--night-mid)";

  return (
    <>
      <div className="inspector-backdrop" onClick={onClose} aria-hidden="true" />
      <div ref={sheetRef} role="complementary" aria-label={`${c.ticker} Inspector`} className="inspector-sheet">

        {/* Header */}
        <div style={{
          display: "flex", alignItems: "baseline", justifyContent: "space-between",
          padding: "14px 18px", borderBottom: "1px solid var(--night-rule-strong)", flexShrink: 0,
        }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontFamily: "var(--mono)", fontSize: 15, fontWeight: 700, color: "var(--gold-bright)", letterSpacing: "0.08em" }}>
              [{c.ticker}]
            </span>
            <span style={{ fontFamily: "var(--serif-tc)", fontSize: 16, color: "var(--night-ink)" }}>
              {c.name}
            </span>
            <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--night-mid)", letterSpacing: "0.10em" }}>
              {c.market}
            </span>
          </div>
          <button onClick={onClose} aria-label="Close inspector" style={{
            background: "none", border: "none", cursor: "pointer",
            color: "var(--night-mid)", fontFamily: "var(--mono)", fontSize: 14, padding: "0 4px", lineHeight: 1,
          }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 18px" }}>

          {/* §1 Mini K-line (mock) */}
          <div style={{ marginBottom: 18 }}>
            <div className="tg" style={{ color: "var(--night-mid)", marginBottom: 8 }}>READ-ONLY SPARK · 20D</div>
            <InspectorSparkline ticker={c.ticker} />
          </div>

          {/* §2 Radar chart */}
          <div style={{ marginBottom: 18 }}>
            <div className="tg" style={{ color: "var(--night-mid)", marginBottom: 8 }}>ABILITY RADAR</div>
            <div className="radar-container">
              <RadarChart ticker={c.ticker} exposureTotal={exposureTotal} />
            </div>
          </div>

          {/* §3 Quick stats */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0, border: "1px solid var(--night-rule-strong)", marginBottom: 18 }}>
            {[
              { k: "TIER",     v: c.beneficiaryTier, color: tierColor },
              { k: "CHAIN",    v: c.chainPosition || "—", color: "var(--night-ink)" },
              { k: "EXPOSURE", v: exposureSummary, color: "var(--gold-bright)" },
              { k: "MARKET",   v: c.market, color: "var(--night-ink)" },
            ].map((item, i) => (
              <div key={item.k} style={{
                padding:     "9px 12px",
                borderRight: i % 2 === 0 ? "1px solid var(--night-rule-strong)" : "none",
                borderBottom: i < 2 ? "1px solid var(--night-rule-strong)" : "none",
              }}>
                <div className="tg" style={{ color: "var(--night-soft)", marginBottom: 3 }}>{item.k}</div>
                <div style={{ fontFamily: "var(--serif-en)", fontStyle: "italic", fontSize: 17, fontWeight: 300, color: item.color, lineHeight: 1 }}>
                  {item.v}
                </div>
              </div>
            ))}
          </div>

          {/* §4 Theme IDs */}
          {c.themeIds && c.themeIds.length > 0 && (
            <div style={{ marginBottom: 18 }}>
              <div className="tg" style={{ color: "var(--night-mid)", marginBottom: 6 }}>THEMES</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {c.themeIds.slice(0, 6).map(id => (
                  <span key={id} style={{
                    fontFamily: "var(--mono)", fontSize: 9.5,
                    color: "var(--gold)", letterSpacing: "0.14em",
                    border: "1px solid var(--gold-deep)",
                    padding: "2px 8px",
                  }}>{id.slice(0, 8)}</span>
                ))}
                {c.themeIds.length > 6 && (
                  <span style={{ fontFamily: "var(--mono)", fontSize: 9.5, color: "var(--night-soft)", letterSpacing: "0.14em" }}>
                    +{c.themeIds.length - 6}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* §5 Notes */}
          {c.notes && (
            <div style={{ marginBottom: 18 }}>
              <div className="tg" style={{ color: "var(--night-mid)", marginBottom: 6 }}>NOTES</div>
              <p style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--night-mid)", lineHeight: 1.5, margin: 0 }}>
                {c.notes.length > 200 ? c.notes.slice(0, 200) + "…" : c.notes}
              </p>
            </div>
          )}
        </div>

        {/* Footer CTA */}
        <div style={{
          padding: "12px 18px", borderTop: "1px solid var(--night-rule-strong)",
          display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0,
        }}>
          <Link href={`/companies/${c.ticker}`} onClick={onClose} style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            background: "var(--night-2)", border: "1px solid var(--gold)",
            color: "var(--gold-bright)", fontFamily: "var(--mono)", fontSize: 10.5,
            letterSpacing: "0.16em", fontWeight: 700, padding: "6px 14px", textDecoration: "none",
          }}>
            ▶ 查看個股頁
          </Link>
          <span style={{ fontFamily: "var(--mono)", fontSize: 8.5, color: "var(--night-soft)", letterSpacing: "0.12em" }}>
            READ-ONLY
          </span>
        </div>
      </div>
    </>
  );
}
