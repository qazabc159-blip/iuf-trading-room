"use client";
/**
 * /plans — 計畫板 (3 tabs)
 *   BRIEF  · 盤前簡報 (market state · top themes · open ideas · watchlist · risk)
 *   REVIEW · 盤後檢討 (today P&L · trades · idea hit-rate · signal recap · notes)
 *   WEEKLY · 週計畫    (week summary · theme rotation · strategy tweaks · lessons)
 */
import { useEffect, useMemo, useState } from "react";
import { PageFrame, SectHead } from "@/components/PageFrame";
import { KpiStrip, ThemeChip, MomentumBadge, LockBadge, SideBadge, QualityBadge } from "@/components/research";
import type {
  BriefBundle, ReviewBundle, WeeklyPlan,
  Theme, Idea, RiskLimit, ExecutionEvent,
} from "@/lib/radar-types";

const TABS = ["BRIEF", "REVIEW", "WEEKLY"] as const;
type Tab = typeof TABS[number];

export function PlansPageClient(props: {
  brief: BriefBundle;
  review: ReviewBundle;
  weekly: WeeklyPlan;
  topThemes: Theme[];
  openIdeas: Idea[];
  riskLimits: RiskLimit[];
  todaysFills: ExecutionEvent[];
}) {
  const [tab, setTab] = useState<Tab>("BRIEF");
  return (
    <PageFrame code="08" title="Plans" sub="計畫板">
      <TabBar value={tab} onChange={setTab} />
      {tab === "BRIEF"  && <BriefPanel  b={props.brief} themes={props.topThemes} ideas={props.openIdeas} risk={props.riskLimits} />}
      {tab === "REVIEW" && <ReviewPanel r={props.review} fills={props.todaysFills} />}
      {tab === "WEEKLY" && <WeeklyPanel w={props.weekly} />}
    </PageFrame>
  );
}

/* ─── Tab bar ───────────────────────────────────────────────────────── */
const TAB_SUB: Record<Tab, string> = { BRIEF: "盤前", REVIEW: "盤後", WEEKLY: "週計畫" };
function TabBar({ value, onChange }: { value: Tab; onChange: (t: Tab) => void }) {
  return (
    <div style={{
      display: "flex", borderBottom: "1px solid var(--night-rule-strong)",
      marginBottom: 18,
    }}>
      {TABS.map(t => {
        const active = t === value;
        return (
          <button key={t} onClick={() => onChange(t)} style={{
            background: "transparent", border: "none",
            padding: "10px 18px", fontFamily: "var(--mono)", fontSize: 11,
            letterSpacing: "0.22em", fontWeight: 700, cursor: "pointer",
            color: active ? "var(--gold-bright)" : "var(--night-mid)",
            borderBottom: active ? "2px solid var(--gold)" : "2px solid transparent",
            marginBottom: -1,
            display: "inline-flex", gap: 8, alignItems: "baseline",
          }}>
            {t}
            <span style={{
              fontFamily: "var(--serif-tc)", fontSize: 13, letterSpacing: "0.05em",
              color: active ? "var(--gold)" : "var(--night-soft)", fontWeight: 400,
            }}>· {TAB_SUB[t]}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════════════ */
/* BRIEF — 盤前簡報                                                       */
/* ═════════════════════════════════════════════════════════════════════ */
function BriefPanel({ b, themes, ideas, risk }: {
  b: BriefBundle; themes: Theme[]; ideas: Idea[]; risk: RiskLimit[];
}) {
  return (
    <>
      {/* §A · MARKET · STATE */}
      <SectHead code="§ A · MARKET · STATE" sub={`${b.date} · 大盤狀態`} live />
      <KpiStrip cells={[
        { label: "STATE",       value: b.market.state, tone: "gold" },
        { label: "OPEN · IN",   value: fmtCountdown(b.market.countdownSec) },
        { label: "FUT · NIGHT", value: b.market.futuresNight.last.toLocaleString(),
          sub: `${b.market.futuresNight.chgPct >= 0 ? "+" : ""}${b.market.futuresNight.chgPct.toFixed(2)}%` },
        { label: `US · ${b.market.usMarket.index}`, value: b.market.usMarket.last.toLocaleString(),
          sub: `${b.market.usMarket.chgPct >= 0 ? "+" : ""}${b.market.usMarket.chgPct.toFixed(2)}%` },
        { label: "EVENTS",      value: b.market.events.length },
      ]} />

      {/* events list */}
      <div style={{ borderTop: "1px solid var(--night-rule-strong)", marginBottom: 24 }}>
        <div style={{
          display: "grid", gridTemplateColumns: "180px 60px 1fr",
          gap: 12, padding: "8px 4px", borderBottom: "1px solid var(--night-rule-strong)",
          fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.18em", color: "var(--night-mid)",
        }}>
          <span>WHEN</span><span>WEIGHT</span><span>EVENT</span>
        </div>
        {b.market.events.map((ev, i) => (
          <div key={i} style={{
            display: "grid", gridTemplateColumns: "180px 60px 1fr",
            gap: 12, padding: "10px 4px", borderBottom: "1px solid var(--night-rule)",
            alignItems: "baseline",
          }}>
            <span style={{ fontFamily: "var(--mono)", fontSize: 11.5, color: "var(--night-mid)" }}>
              {new Date(ev.ts).toLocaleString("zh-TW", { hour12: false })}
            </span>
            <span style={{
              fontFamily: "var(--mono)", fontSize: 9.5, letterSpacing: "0.2em", fontWeight: 700,
              color: ev.weight === "HIGH" ? "var(--gold-bright)" : ev.weight === "MED" ? "var(--night-ink)" : "var(--night-soft)",
            }}>{ev.weight}</span>
            <span style={{ fontFamily: "var(--serif-tc)", fontSize: 15, color: "var(--night-ink)" }}>{ev.label}</span>
          </div>
        ))}
      </div>

      {/* §B · THEMES · 今日重點 */}
      <SectHead code="§ B · THEMES · 今日重點" sub={`${themes.length} themes · LOCKED + ACCEL`} />
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 24,
      }}>
        {themes.map(t => (
          <div key={t.code} style={{
            border: "1px solid var(--night-rule-strong)", padding: "12px 14px",
            display: "flex", flexDirection: "column", gap: 6,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span style={{ fontFamily: "var(--mono)", fontSize: 11, letterSpacing: "0.2em", color: "var(--gold)", fontWeight: 700 }}>
                {String(t.rank).padStart(2,"0")} · {t.code}
              </span>
              <LockBadge s={t.lockState} />
            </div>
            <div style={{ fontFamily: "var(--serif-tc)", fontSize: 18, color: "var(--night-ink)", lineHeight: 1.2 }}>
              {t.name}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 4 }}>
              <span style={{
                fontFamily: "var(--serif-en)", fontStyle: "italic", fontWeight: 300,
                fontSize: 28, color: "var(--gold-bright)", fontFeatureSettings: '"tnum"',
              }}>{t.heat}</span>
              <span className="tg" style={{ color: "var(--night-mid)" }}>
                Δ {t.dHeat >= 0 ? "+" : ""}{t.dHeat} · {t.members} co.
              </span>
            </div>
            <div style={{ marginTop: 4 }}><MomentumBadge m={t.momentum} /></div>
          </div>
        ))}
      </div>

      {/* §C · IDEAS · 待執行 */}
      <SectHead code="§ C · IDEAS · 待執行" sub={`${ideas.length} open · 今日生效`} />
      <div style={{ borderTop: "1px solid var(--night-rule-strong)", marginBottom: 24 }}>
        <div style={{
          display: "grid", gridTemplateColumns: "100px 60px 70px 100px 110px 1fr",
          gap: 12, padding: "8px 4px", borderBottom: "1px solid var(--night-rule-strong)",
          fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.18em", color: "var(--night-mid)",
        }}>
          <span>ID</span><span>SYM</span><span>SIDE</span><span>QUALITY</span><span>THEME</span><span>RATIONALE</span>
        </div>
        {ideas.map(i => (
          <div key={i.id} style={{
            display: "grid", gridTemplateColumns: "100px 60px 70px 100px 110px 1fr",
            gap: 12, padding: "10px 4px", borderBottom: "1px solid var(--night-rule)",
            alignItems: "baseline", fontFamily: "var(--mono)", fontSize: 11.5,
          }}>
            <span style={{ color: "var(--gold)" }}>{i.id}</span>
            <span style={{ color: "var(--night-ink)", fontWeight: 700 }}>{i.symbol}</span>
            <SideBadge s={i.side} />
            <QualityBadge q={i.quality} />
            <ThemeChip code={i.themeCode} />
            <span style={{ fontFamily: "var(--serif-tc)", fontSize: 13.5, color: "var(--night-ink)", lineHeight: 1.4 }}>
              {i.rationale}
            </span>
          </div>
        ))}
      </div>

      {/* §D · WATCHLIST */}
      <SectHead code="§ D · WATCHLIST · 自選股" sub={`${b.watchlist.length} symbols`} />
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(2, 1fr)",
        border: "1px solid var(--night-rule-strong)", marginBottom: 24,
      }}>
        {b.watchlist.map((w, i) => (
          <div key={w.symbol} style={{
            display: "grid", gridTemplateColumns: "70px 1fr 90px 1fr",
            gap: 8, padding: "10px 14px",
            borderBottom: i < b.watchlist.length - 2 ? "1px solid var(--night-rule)" : "none",
            borderRight: i % 2 === 0 ? "1px solid var(--night-rule-strong)" : "none",
            alignItems: "baseline", fontFamily: "var(--mono)", fontSize: 11.5,
          }}>
            <span style={{ color: "var(--gold)", fontWeight: 700 }}>{w.symbol}</span>
            <span style={{ fontFamily: "var(--serif-tc)", fontSize: 14, color: "var(--night-ink)" }}>{w.name}</span>
            <span>{w.themeCode && <ThemeChip code={w.themeCode} />}</span>
            <span className="tg" style={{ color: "var(--night-soft)" }}>{w.note ?? "—"}</span>
          </div>
        ))}
      </div>

      {/* §E · RISK · 今日上限 */}
      <SectHead code="§ E · RISK · 今日上限" sub={`${risk.length} rules`} />
      <div style={{ borderTop: "1px solid var(--night-rule-strong)" }}>
        {risk.map(r => (
          <div key={r.rule} style={{
            display: "grid", gridTemplateColumns: "180px 100px 100px 70px 80px",
            gap: 12, padding: "10px 4px", borderBottom: "1px solid var(--night-rule)",
            alignItems: "baseline", fontFamily: "var(--mono)", fontSize: 12,
          }}>
            <span style={{ color: "var(--night-ink)" }}>{r.rule}</span>
            <span style={{ color: "var(--gold)", textAlign: "right", fontFeatureSettings: '"tnum"' }}>{r.limit}</span>
            <span style={{ color: "var(--night-mid)", fontSize: 10.5 }}>{r.current}</span>
            <span className="tg" style={{ color: "var(--night-mid)" }}>{r.layer}</span>
            <span style={{
              color: r.result === "PASS" ? "var(--gold-bright)" : r.result === "WARN" ? "var(--night-ink)" : "var(--night-soft)",
              fontWeight: 700, letterSpacing: "0.16em", fontSize: 10, textAlign: "right",
            }}>{r.result}</span>
          </div>
        ))}
      </div>
    </>
  );
}

function fmtCountdown(sec: number): string {
  if (sec <= 0) return "OPEN";
  const m = Math.floor(sec / 60), s = sec % 60;
  if (m >= 60) return `${Math.floor(m/60)}h ${m%60}m`;
  return `${m}m ${String(s).padStart(2,"0")}s`;
}

/* ═════════════════════════════════════════════════════════════════════ */
/* REVIEW — 盤後檢討                                                     */
/* ═════════════════════════════════════════════════════════════════════ */
function ReviewPanel({ r, fills }: { r: ReviewBundle; fills: ExecutionEvent[] }) {
  const navDelta = r.pnl.navEnd - r.pnl.navStart;
  const navDeltaPct = (navDelta / r.pnl.navStart) * 100;
  const total = r.pnl.realized + r.pnl.unrealized;

  return (
    <>
      <SectHead code="§ A · TODAY · P&L" sub={r.date} />
      <KpiStrip cells={[
        { label: "NAV · START", value: fmtTwd(r.pnl.navStart) },
        { label: "NAV · END",   value: fmtTwd(r.pnl.navEnd), tone: "gold" },
        { label: "Δ · NAV",     value: `${navDelta >= 0 ? "+" : ""}${fmtTwd(navDelta)}`, sub: `${navDeltaPct >= 0 ? "+" : ""}${navDeltaPct.toFixed(2)}%` },
        { label: "REALIZED",    value: fmtTwd(r.pnl.realized) },
        { label: "UNREALIZED",  value: fmtTwd(r.pnl.unrealized) },
        { label: "TOTAL",       value: fmtTwd(total), tone: "gold" },
      ]} />

      <SectHead code="§ B · TRADES · 今日成交" sub={`${fills.length} fills`} />
      <div style={{ borderTop: "1px solid var(--night-rule-strong)", marginBottom: 24 }}>
        <div style={{
          display: "grid", gridTemplateColumns: "150px 60px 60px 80px 100px 100px 100px",
          gap: 8, padding: "8px 4px", borderBottom: "1px solid var(--night-rule-strong)",
          fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.18em", color: "var(--night-mid)",
        }}>
          <span>TS</span><span>SYM</span><span>SIDE</span>
          <span style={{textAlign:"right"}}>QTY</span>
          <span style={{textAlign:"right"}}>PRICE</span>
          <span style={{textAlign:"right"}}>FEE</span>
          <span style={{textAlign:"right"}}>TAX</span>
        </div>
        {fills.length === 0 && (
          <div className="tg" style={{ color: "var(--night-soft)", padding: "16px 4px" }}>
            NO FILLS · 今日尚無成交
          </div>
        )}
        {fills.map(f => (
          <div key={f.id} style={{
            display: "grid", gridTemplateColumns: "150px 60px 60px 80px 100px 100px 100px",
            gap: 8, padding: "9px 4px", borderBottom: "1px solid var(--night-rule)",
            alignItems: "baseline", fontFamily: "var(--mono)", fontSize: 11.5,
          }}>
            <span style={{ color: "var(--night-mid)", fontSize: 10.5 }}>
              {new Date(f.ts).toLocaleTimeString("zh-TW", { hour12: false })}
            </span>
            <span style={{ color: "var(--night-ink)", fontWeight: 700 }}>{f.symbol}</span>
            <span style={{ color: "var(--gold)", fontWeight: 700, letterSpacing: "0.12em" }}>{f.side}</span>
            <span style={{ textAlign: "right", fontFeatureSettings: '"tnum"' }}>{f.qty?.toLocaleString()}</span>
            <span style={{ textAlign: "right", fontFeatureSettings: '"tnum"' }}>{f.price?.toFixed(2)}</span>
            <span style={{ color: "var(--night-mid)", textAlign: "right", fontFeatureSettings: '"tnum"' }}>{f.fee ?? "—"}</span>
            <span style={{ color: "var(--night-mid)", textAlign: "right", fontFeatureSettings: '"tnum"' }}>{f.tax ?? "—"}</span>
          </div>
        ))}
      </div>

      <SectHead code="§ C · IDEAS · 命中率" sub="emitted → filled" />
      <KpiStrip cells={[
        { label: "EMITTED",  value: r.ideaHitRate.emitted },
        { label: "FILLED",   value: r.ideaHitRate.filled },
        { label: "HIT · %",  value: `${(r.ideaHitRate.pct * 100).toFixed(1)}%`, tone: "gold", format: "serif" },
      ]} />

      <SectHead code="§ D · SIGNALS · 回顧" sub="今日各 channel 觸發數" />
      <div style={{ borderTop: "1px solid var(--night-rule-strong)", marginBottom: 24 }}>
        {r.signalsSummary.map(s => {
          const max = Math.max(...r.signalsSummary.map(x => x.count));
          return (
            <div key={s.channel} style={{
              display: "grid", gridTemplateColumns: "60px 1fr 60px",
              gap: 12, padding: "10px 4px", borderBottom: "1px solid var(--night-rule)",
              alignItems: "center", fontFamily: "var(--mono)", fontSize: 12,
            }}>
              <span style={{
                color: "var(--night-ink)", letterSpacing: "0.22em", fontWeight: 700, fontSize: 10,
                border: "1px solid var(--night-rule-strong)", padding: "2px 6px", textAlign: "center",
              }}>{s.channel}</span>
              <span style={{ height: 6, background: "var(--night-rule)", position: "relative" }}>
                <span style={{
                  position: "absolute", inset: 0, width: `${(s.count/max)*100}%`,
                  background: "var(--gold)", opacity: 0.7,
                }} />
              </span>
              <span style={{ color: "var(--night-mid)", textAlign: "right", fontFeatureSettings: '"tnum"' }}>{s.count}</span>
            </div>
          );
        })}
      </div>

      <SectHead code="§ E · NOTES · 操盤心得" sub="auto-saved · sessionStorage" />
      <NotesBox storageKey="iuf:notes:review:v1" />
    </>
  );
}

function fmtTwd(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toFixed(0);
}

function NotesBox({ storageKey }: { storageKey: string }) {
  const [text, setText] = useState("");
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw) setText(raw);
    } catch {}
  }, [storageKey]);

  useEffect(() => {
    const t = setTimeout(() => {
      try {
        sessionStorage.setItem(storageKey, text);
        setSaved(new Date().toLocaleTimeString("zh-TW", { hour12: false }));
      } catch {}
    }, 600);
    return () => clearTimeout(t);
  }, [text, storageKey]);

  return (
    <div>
      <textarea value={text} onChange={e => setText(e.target.value)}
        placeholder="今天哪一筆做對了？哪一筆該停損沒停？明天的注意事項？"
        style={{
          width: "100%", minHeight: 200, padding: "14px 16px",
          background: "rgba(255,255,255,0.02)",
          border: "1px solid var(--night-rule-strong)",
          color: "var(--night-ink)",
          fontFamily: "var(--serif-tc)", fontSize: 16, lineHeight: 1.7,
          outline: "none", resize: "vertical",
        }} />
      <div className="tg" style={{
        color: "var(--night-soft)", marginTop: 6, display: "flex", justifyContent: "space-between",
      }}>
        <span>{text.length} chars · session-only · 重整不會消失</span>
        <span>{saved ? `SAVED · ${saved}` : "—"}</span>
      </div>
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════════════ */
/* WEEKLY — 週計畫                                                       */
/* ═════════════════════════════════════════════════════════════════════ */
function WeeklyPanel({ w }: { w: WeeklyPlan }) {
  const maxAbs = Math.max(...w.themeRotation.map(t => Math.abs(t.delta)), 1);
  return (
    <>
      <SectHead code="§ A · WEEK · STATE" sub={w.weekNo} />
      <KpiStrip cells={[
        { label: "WEEK",         value: w.weekNo, tone: "gold" },
        { label: "TRADES",       value: w.summary.trades },
        { label: "CUM · P&L",    value: fmtTwd(w.summary.cumPnl), tone: "gold" },
        { label: "WIN · RATE",   value: `${(w.summary.themeWinRate * 100).toFixed(0)}%`, format: "serif" },
        { label: "BEST · THEME", value: w.summary.bestTheme },
      ]} />

      <SectHead code="§ B · THEMES · ROTATION" sub="本週主題 heat 變化" />
      <div style={{ borderTop: "1px solid var(--night-rule-strong)", marginBottom: 24 }}>
        <div style={{
          display: "grid", gridTemplateColumns: "120px 80px 80px 1fr 80px",
          gap: 12, padding: "8px 4px", borderBottom: "1px solid var(--night-rule-strong)",
          fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.18em", color: "var(--night-mid)",
        }}>
          <span>THEME</span><span style={{textAlign:"right"}}>HEAT · 一</span>
          <span style={{textAlign:"right"}}>HEAT · 五</span>
          <span>Δ · ROTATION</span>
          <span style={{textAlign:"right"}}>Δ</span>
        </div>
        {w.themeRotation.map(t => {
          const pct = (Math.abs(t.delta) / maxAbs) * 50; // half-bar
          return (
            <div key={t.code} style={{
              display: "grid", gridTemplateColumns: "120px 80px 80px 1fr 80px",
              gap: 12, padding: "10px 4px", borderBottom: "1px solid var(--night-rule)",
              alignItems: "center", fontFamily: "var(--mono)", fontSize: 12,
            }}>
              <ThemeChip code={t.code} />
              <span style={{ color: "var(--night-mid)", textAlign: "right", fontFeatureSettings: '"tnum"' }}>{t.heatStart}</span>
              <span style={{ color: "var(--night-ink)", textAlign: "right", fontFeatureSettings: '"tnum"', fontWeight: 700 }}>{t.heatEnd}</span>
              {/* center-zero divergent bar */}
              <span style={{ height: 6, background: "var(--night-rule)", position: "relative" }}>
                <span style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "var(--night-mid)" }} />
                <span style={{
                  position: "absolute", top: 0, bottom: 0,
                  left: t.delta >= 0 ? "50%" : `${50 - pct}%`,
                  width: `${pct}%`,
                  background: t.delta >= 0 ? "var(--gold)" : "var(--night-soft)",
                  opacity: 0.75,
                }} />
              </span>
              <span style={{
                color: t.delta >= 0 ? "var(--gold-bright)" : "var(--night-soft)",
                textAlign: "right", fontFeatureSettings: '"tnum"', fontWeight: 700,
              }}>{t.delta >= 0 ? "+" : ""}{t.delta}</span>
            </div>
          );
        })}
      </div>

      <SectHead code="§ C · STRATEGY · TWEAKS" sub={`${w.strategyTweaks.length} changes`} />
      <div style={{ borderTop: "1px solid var(--night-rule-strong)", marginBottom: 24 }}>
        <div style={{
          display: "grid", gridTemplateColumns: "180px 140px 1fr",
          gap: 12, padding: "8px 4px", borderBottom: "1px solid var(--night-rule-strong)",
          fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.18em", color: "var(--night-mid)",
        }}>
          <span>WHEN</span><span>STRATEGY</span><span>CHANGE</span>
        </div>
        {w.strategyTweaks.map((t, i) => (
          <div key={i} style={{
            display: "grid", gridTemplateColumns: "180px 140px 1fr",
            gap: 12, padding: "10px 4px", borderBottom: "1px solid var(--night-rule)",
            alignItems: "baseline", fontFamily: "var(--mono)", fontSize: 11.5,
          }}>
            <span style={{ color: "var(--night-mid)", fontSize: 10.5 }}>
              {new Date(t.ts).toLocaleString("zh-TW", { hour12: false })}
            </span>
            <span style={{ color: "var(--gold)", fontWeight: 700 }}>{t.strategyId}</span>
            <span style={{ fontFamily: "var(--serif-tc)", fontSize: 14, color: "var(--night-ink)" }}>{t.change}</span>
          </div>
        ))}
      </div>

      <SectHead code="§ D · LESSONS · 教訓清單" sub="auto-saved · sessionStorage" />
      <NotesBox storageKey="iuf:notes:weekly:v1" />
    </>
  );
}
