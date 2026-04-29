"use client";
/**
 * Shared research-layer primitives — KPI strip, FilterBar atoms, badges.
 * Night-layer (monochrome + gold) only. Exec-layer pages use their own atoms.
 */
import type { ReactNode } from "react";

/* ─── KpiStrip ──────────────────────────────────────────────────────── */
export interface KpiCell {
  label: string;
  value: string | number;
  sub?: string;
  /** mono = telegraph (default for counts/codes). serif = italic display (for ratios). */
  format?: "mono" | "serif";
  tone?: "default" | "gold";
}

export function KpiStrip({ cells }: { cells: KpiCell[] }) {
  return (
    <div style={{
      display: "grid", gridTemplateColumns: `repeat(${cells.length}, 1fr)`,
      border: "1px solid var(--night-rule-strong)", marginBottom: 18,
    }}>
      {cells.map((c, i) => (
        <div key={c.label} style={{
          padding: "12px 14px",
          borderRight: i < cells.length - 1 ? "1px solid var(--night-rule-strong)" : "none",
        }}>
          <div className="tg" style={{ color: "var(--night-mid)" }}>{c.label}</div>
          <div style={{
            marginTop: 4,
            fontFamily: c.format === "serif" ? "var(--serif-en)" : "var(--mono)",
            fontStyle: c.format === "serif" ? "italic" : "normal",
            fontWeight: c.format === "serif" ? 300 : 700,
            fontSize: c.format === "serif" ? 24 : 20,
            color: c.tone === "gold" ? "var(--gold-bright)" : "var(--night-ink)",
            fontFeatureSettings: '"tnum","lnum"',
          }}>{c.value}</div>
          {c.sub && <div className="tg" style={{ color: "var(--night-soft)", marginTop: 2 }}>{c.sub}</div>}
        </div>
      ))}
    </div>
  );
}

/* ─── FilterBar wrappers ────────────────────────────────────────────── */
export function FilterBar({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div style={{
      display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center",
      padding: "10px 0 12px", borderBottom: "1px solid var(--night-rule)", marginBottom: 12,
    }}>
      {children}
      {right && <span style={{ marginLeft: "auto" }}>{right}</span>}
    </div>
  );
}

export function Seg<T extends string>({
  label, value, options, onChange,
}: { label: string; value: T; options: readonly T[]; onChange: (v: T) => void }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span className="tg" style={{ color: "var(--night-mid)" }}>{label}</span>
      <span style={{ display: "inline-flex", border: "1px solid var(--night-rule-strong)" }}>
        {options.map(o => {
          const active = o === value;
          return (
            <button key={o} onClick={() => onChange(o)} style={{
              padding: "5px 10px", fontFamily: "var(--mono)", fontSize: 11, letterSpacing: "0.16em",
              background: active ? "var(--gold)" : "transparent",
              color: active ? "var(--night)" : "var(--night-ink)",
              border: "none", cursor: "pointer", fontWeight: 700,
              borderRight: o === options[options.length - 1] ? "none" : "1px solid var(--night-rule-strong)",
            }}>{o}</button>
          );
        })}
      </span>
    </span>
  );
}

export function TextInput({
  label, value, onChange, placeholder,
}: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span className="tg" style={{ color: "var(--night-mid)" }}>{label}</span>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} style={{
        background: "transparent", border: "1px solid var(--night-rule-strong)",
        color: "var(--night-ink)", fontFamily: "var(--mono)", fontSize: 11.5,
        padding: "5px 8px", outline: "none", minWidth: 160,
      }} />
    </span>
  );
}

export function Sort<T extends string>({
  value, options, onChange,
}: { value: T; options: readonly { key: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span className="tg" style={{ color: "var(--night-mid)" }}>SORT</span>
      <select value={value} onChange={e => onChange(e.target.value as T)} style={{
        background: "transparent", border: "1px solid var(--night-rule-strong)",
        color: "var(--night-ink)", fontFamily: "var(--mono)", fontSize: 11.5,
        padding: "5px 8px", outline: "none",
      }}>
        {options.map(o => <option key={o.key} value={o.key} style={{ background: "var(--night)" }}>{o.label}</option>)}
      </select>
    </span>
  );
}

export function MultiChip({
  label, options, value, onChange,
}: { label: string; options: string[]; value: string[]; onChange: (v: string[]) => void }) {
  const toggle = (o: string) => onChange(value.includes(o) ? value.filter(v => v !== o) : [...value, o]);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      <span className="tg" style={{ color: "var(--night-mid)" }}>{label}</span>
      {options.map(o => {
        const on = value.includes(o);
        return (
          <button key={o} onClick={() => toggle(o)} style={{
            padding: "3px 7px", fontFamily: "var(--mono)", fontSize: 10.5, letterSpacing: "0.14em",
            border: "1px solid var(--night-rule-strong)",
            background: on ? "var(--gold)" : "transparent",
            color: on ? "var(--night)" : "var(--night-mid)",
            cursor: "pointer", fontWeight: 700,
          }}>{o}</button>
        );
      })}
    </span>
  );
}

export function Toggle({
  label, value, onChange,
}: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!value)} style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      background: "transparent", border: "1px solid var(--night-rule-strong)",
      color: value ? "var(--gold-bright)" : "var(--night-mid)",
      fontFamily: "var(--mono)", fontSize: 11, letterSpacing: "0.16em",
      padding: "5px 9px", cursor: "pointer", fontWeight: 700,
    }}>
      {value ? "▣" : "▢"} {label}
    </button>
  );
}

/* ─── Badges ────────────────────────────────────────────────────────── */
export function QualityBadge({ q }: { q: "HIGH" | "MED" | "LOW" }) {
  const tone = q === "HIGH" ? "var(--gold-bright)" : q === "MED" ? "var(--night-ink)" : "var(--night-soft)";
  return (
    <span style={{
      fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.18em", fontWeight: 700,
      padding: "2px 6px", border: `1px solid ${tone}`, color: tone,
    }}>Q · {q}</span>
  );
}

export function SideBadge({ s }: { s: "LONG" | "SHORT" | "TRIM" | "EXIT" }) {
  return (
    <span style={{
      fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.18em", fontWeight: 700,
      padding: "2px 6px", border: "1px solid var(--gold)", color: "var(--gold)",
    }}>● {s}</span>
  );
}

export function MomentumBadge({ m }: { m: "ACCEL" | "STEADY" | "DECEL" }) {
  const sym = m === "ACCEL" ? "▲" : m === "DECEL" ? "▼" : "·";
  const tone = m === "ACCEL" ? "var(--gold-bright)" : m === "DECEL" ? "var(--night-soft)" : "var(--night-mid)";
  return <span className="tg" style={{ color: tone }}>{sym} {m}</span>;
}

export function LockBadge({ s }: { s: "LOCKED" | "TRACK" | "WATCH" | "STALE" }) {
  const tone = s === "LOCKED" ? "var(--gold-bright)" : s === "STALE" ? "var(--night-soft)" : "var(--night-mid)";
  return <span className="tg" style={{ color: tone, fontWeight: 700 }}>{s}</span>;
}

export function ThemeChip({ code }: { code: string }) {
  return (
    <span style={{
      display: "inline-block",
      fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.14em", fontWeight: 700,
      padding: "2px 6px", background: "var(--night-2, rgba(255,255,255,0.04))",
      color: "var(--gold)", border: "1px solid var(--night-rule)",
      marginRight: 4, marginBottom: 2,
    }}>{code}</span>
  );
}

/* ─── helpers ──────────────────────────────────────────────────────── */
export function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60), rs = s % 60;
  return rs ? `${m}m ${rs}s` : `${m}m`;
}

export function isoWeek(iso: string): string {
  const d = new Date(iso);
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const wk = Math.ceil(((+t - +yearStart) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(wk).padStart(2, "0")}`;
}
