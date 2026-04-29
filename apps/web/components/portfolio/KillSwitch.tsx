"use client";
/**
 * KillSwitch — 4-mode segmented control with confirm dialog.
 *
 * Modes:
 *   ARMED   · 全速放行（金色 fill）
 *   SAFE    · 收斂模式 · 拒新單但允許平倉
 *   PEEK    · 唯讀 · 全部下單封死
 *   FROZEN  · 緊急停機 · 連 polling 都停
 *
 * Click → confirm dialog (§-style frame, mono) → POST /api/portfolio/kill-mode.
 * The page passes us `mode` + an updater so server data stays canonical.
 */
import { useState, useTransition } from "react";
import { api } from "@/lib/radar-api";
import type { KillMode } from "@/lib/radar-types";

const MODES: { mode: KillMode; label: string; sub: string; tone: "ok" | "warn" | "block" | "danger" }[] = [
  { mode: "ARMED",  label: "ARMED",  sub: "放行 · LIVE",        tone: "ok"     },
  { mode: "SAFE",   label: "SAFE",   sub: "拒新單 · 允許平倉",  tone: "warn"   },
  { mode: "PEEK",   label: "PEEK",   sub: "唯讀 · 下單封死",    tone: "block"  },
  { mode: "FROZEN", label: "FROZEN", sub: "緊急停機",            tone: "danger" },
];

function toneColor(t: "ok" | "warn" | "block" | "danger") {
  return t === "ok" ? "var(--gold-bright)"
       : t === "warn" ? "var(--gold)"
       : t === "block" ? "var(--exec-mid)"
       : "var(--tw-up-bright)";
}

export function KillSwitch({ mode, onChange }: {
  mode: KillMode; onChange: (m: KillMode) => void;
}) {
  const [pending, setPending] = useState<KillMode | null>(null);
  const [, startTransition] = useTransition();

  const submit = (m: KillMode) => {
    startTransition(async () => {
      try {
        await api.killMode(m);
        onChange(m);
      } finally {
        setPending(null);
      }
    });
  };

  return (
    <>
      <div role="radiogroup" aria-label="Kill mode" style={{
        display: "grid", gridTemplateColumns: "repeat(4, 1fr)",
        border: "1px solid var(--exec-rule-strong)",
      }}>
        {MODES.map((m, i) => {
          const on = m.mode === mode;
          return (
            <button
              key={m.mode}
              role="radio"
              aria-checked={on}
              onClick={() => setPending(m.mode)}
              disabled={on}
              style={{
                padding: "14px 12px",
                background: on ? "rgba(184,138,62,0.18)" : "transparent",
                color: on ? "var(--gold-bright)" : "var(--exec-ink)",
                borderLeft: i === 0 ? "none" : "1px solid var(--exec-rule)",
                borderTop: on ? "2px solid var(--gold)" : "2px solid transparent",
                cursor: on ? "default" : "pointer",
                fontFamily: "var(--mono)", letterSpacing: "0.18em",
                textAlign: "left",
              }}
            >
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ color: toneColor(m.tone), fontSize: 12, fontWeight: 700 }}>● {m.label}</span>
                {on && <span style={{ color: "var(--gold)", fontSize: 9.5 }}>· CURRENT</span>}
              </div>
              <div style={{ fontFamily: "var(--serif-tc)", fontSize: 12.5, color: "var(--exec-mid)", marginTop: 4, letterSpacing: 0 }}>
                {m.sub}
              </div>
            </button>
          );
        })}
      </div>

      {pending && (
        <ConfirmDialog
          target={pending}
          current={mode}
          onCancel={() => setPending(null)}
          onConfirm={() => submit(pending)}
        />
      )}
    </>
  );
}

function ConfirmDialog({ target, current, onCancel, onConfirm }: {
  target: KillMode; current: KillMode;
  onCancel: () => void; onConfirm: () => void;
}) {
  const tgt = MODES.find(m => m.mode === target)!;
  const isEscalation = (current === "ARMED" && target !== "ARMED") || target === "FROZEN";

  return (
    <div onClick={onCancel} style={{
      position: "fixed", inset: 0, zIndex: 9100,
      background: "rgba(8,8,6,0.62)", backdropFilter: "blur(2px)",
      display: "grid", placeItems: "center", fontFamily: "var(--mono)",
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: "min(480px, 92vw)",
        background: "var(--exec-bg-1)",
        border: `1px solid ${isEscalation ? "var(--tw-up)" : "var(--exec-rule-strong)"}`,
        boxShadow: "0 24px 60px rgba(0,0,0,0.55)",
      }}>
        <div style={{
          padding: "10px 14px", borderBottom: "1px solid var(--exec-rule-strong)",
          color: isEscalation ? "var(--tw-up-bright)" : "var(--gold)",
          fontSize: 11, letterSpacing: "0.22em", fontWeight: 700,
        }}>
          § CONFIRM · KILL MODE TRANSITION
        </div>
        <div style={{ padding: "16px", color: "var(--exec-ink)" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 12 }}>
            <span style={{ color: "var(--exec-soft)", fontSize: 11, letterSpacing: "0.18em" }}>FROM</span>
            <span style={{ color: "var(--exec-mid)", fontWeight: 700 }}>{current}</span>
            <span style={{ color: "var(--exec-soft)" }}>→</span>
            <span style={{ color: toneColor(tgt.tone), fontWeight: 700 }}>{target}</span>
          </div>
          <div style={{ fontFamily: "var(--serif-tc)", fontSize: 14, color: "var(--exec-mid)", lineHeight: 1.7 }}>
            {target === "ARMED"  && "回到放行模式。新單將直接送出，請確認你確實要這麼做。"}
            {target === "SAFE"   && "拒絕新單，但允許既有部位平倉。適合震盪過大或訊號異常時使用。"}
            {target === "PEEK"   && "全面唯讀。所有下單請求都會被擋下，僅保留報價與部位查詢。"}
            {target === "FROZEN" && "緊急停機。連背景 polling 都會中止。只在系統失控時使用。"}
          </div>
        </div>
        <div style={{ display: "flex", borderTop: "1px solid var(--exec-rule-strong)" }}>
          <button onClick={onCancel} style={{
            flex: 1, padding: "12px 14px",
            background: "transparent", border: "none",
            borderRight: "1px solid var(--exec-rule-strong)",
            color: "var(--exec-mid)", fontFamily: "var(--mono)",
            letterSpacing: "0.22em", fontWeight: 700, cursor: "pointer",
          }}>CANCEL</button>
          <button onClick={onConfirm} style={{
            flex: 1, padding: "12px 14px",
            background: "transparent", border: "none",
            color: isEscalation ? "var(--tw-up-bright)" : "var(--gold-bright)",
            fontFamily: "var(--mono)", letterSpacing: "0.22em",
            fontWeight: 700, cursor: "pointer",
          }}>● CONFIRM · {target}</button>
        </div>
      </div>
    </div>
  );
}
