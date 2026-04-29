"use client";
/**
 * /signals — research-layer signal feed.
 * §A KPI · §B FilterBar · §C Day-grouped timeline · §D Channel legend (sticky)
 */
import { useMemo, useState } from "react";
import { PageFrame, SectHead } from "@/components/PageFrame";
import { KpiStrip, FilterBar, Seg, MultiChip, TextInput, Sort, QualityBadge } from "@/components/research";
import type { Signal } from "@/lib/radar-types";

const CHANNELS = ["MOM", "FII", "KW", "VOL", "THM", "MAN"] as const;
const QUALITIES = ["ALL", "HIGH", "MED", "LOW"] as const;
const STATES = ["ALL", "EMITTED", "MUTED"] as const;
const RANGES = ["1H", "4H", "1D", "1W", "ALL"] as const;
const SORTS = [
  { key: "ts-desc", label: "TS · NEW → OLD" },
  { key: "ts-asc", label: "TS · OLD → NEW" },
  { key: "q-desc", label: "QUALITY · HIGH → LOW" },
] as const;

const CHANNEL_INFO: Record<typeof CHANNELS[number], { name: string; desc: string }> = {
  MOM: { name: "動能", desc: "個股 MOM ACL/DCL · 量價同步" },
  FII: { name: "外資", desc: "三大法人買賣超 · 連續日數" },
  KW:  { name: "關鍵字", desc: "新聞 / 社群關鍵字熱度突起" },
  VOL: { name: "波動",   desc: "Volatility breakout / compression" },
  THM: { name: "主題",   desc: "主題 heat / breadth 變化" },
  MAN: { name: "人工",   desc: "操盤人手動標記" },
};

const RANGE_HOURS: Record<typeof RANGES[number], number | null> = {
  "1H": 1, "4H": 4, "1D": 24, "1W": 168, ALL: null,
};

const QUALITY_RANK: Record<Signal["quality"], number> = { HIGH: 3, MED: 2, LOW: 1 };

function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}-${String(d.getUTCDate()).padStart(2,"0")}`;
}

function fmtDayHeader(iso: string): string {
  const d = new Date(iso);
  const wd = ["SUN","MON","TUE","WED","THU","FRI","SAT"][d.getUTCDay()];
  return `${dayKey(iso)} · ${wd}`;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("zh-TW", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function SignalsPageClient({ signals }: { signals: Signal[] }) {
  const [channels, setChannels] = useState<string[]>([]); // empty = ALL
  const [quality, setQuality] = useState<typeof QUALITIES[number]>("ALL");
  const [state, setState]     = useState<typeof STATES[number]>("ALL");
  const [range, setRange]     = useState<typeof RANGES[number]>("ALL");
  const [q, setQ]             = useState("");
  const [sort, setSort]       = useState<typeof SORTS[number]["key"]>("ts-desc");

  const now = useMemo(() => Date.parse(signals[0]?.emittedAt ?? new Date().toISOString()), [signals]);

  const filtered = useMemo(() => {
    let xs = signals.slice();
    if (channels.length) xs = xs.filter(s => channels.includes(s.channel));
    if (quality !== "ALL") xs = xs.filter(s => s.quality === quality);
    if (state !== "ALL") xs = xs.filter(s => s.state === state);
    const hours = RANGE_HOURS[range];
    if (hours != null) {
      const cutoff = now - hours * 3600_000;
      xs = xs.filter(s => Date.parse(s.emittedAt) >= cutoff);
    }
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      xs = xs.filter(s =>
        s.trigger.toLowerCase().includes(needle) ||
        (s.symbol ?? "").toLowerCase().includes(needle) ||
        (s.themeCode ?? "").toLowerCase().includes(needle) ||
        s.code.toLowerCase().includes(needle)
      );
    }
    xs.sort((a, b) => {
      if (sort === "ts-desc") return Date.parse(b.emittedAt) - Date.parse(a.emittedAt);
      if (sort === "ts-asc")  return Date.parse(a.emittedAt) - Date.parse(b.emittedAt);
      return QUALITY_RANK[b.quality] - QUALITY_RANK[a.quality]
          || Date.parse(b.emittedAt) - Date.parse(a.emittedAt);
    });
    return xs;
  }, [signals, channels, quality, state, range, q, sort, now]);

  // KPI counts (over full feed, not filtered)
  const kpis = useMemo(() => {
    const total = signals.length;
    const emitted = signals.filter(s => s.state === "EMITTED").length;
    const muted = signals.filter(s => s.state === "MUTED").length;
    const high = signals.filter(s => s.quality === "HIGH").length;
    const byCh: Record<string, number> = {};
    for (const c of CHANNELS) byCh[c] = signals.filter(s => s.channel === c).length;
    return { total, emitted, muted, high, byCh };
  }, [signals]);

  // group filtered by day
  const groups = useMemo(() => {
    const g: Record<string, Signal[]> = {};
    for (const s of filtered) {
      const k = dayKey(s.emittedAt);
      (g[k] ||= []).push(s);
    }
    const orderedKeys = Object.keys(g).sort((a, b) => sort === "ts-asc" ? a.localeCompare(b) : b.localeCompare(a));
    return orderedKeys.map(k => ({ key: k, items: g[k] }));
  }, [filtered, sort]);

  return (
    <PageFrame code="07" title="Signals" sub="訊號板">
      {/* §A · SUMMARY KPI */}
      <SectHead code="§ A · SUMMARY · 訊號摘要" sub="ALL CHANNELS · ALL TIME" live />
      <KpiStrip cells={[
        { label: "TOTAL",   value: kpis.total },
        { label: "EMITTED", value: kpis.emitted },
        { label: "MUTED",   value: kpis.muted, sub: kpis.muted ? `${Math.round(kpis.muted/kpis.total*100)}%` : "0%" },
        { label: "HIGH-Q",  value: kpis.high, tone: "gold" },
        { label: "MOM",     value: kpis.byCh.MOM },
        { label: "FII",     value: kpis.byCh.FII },
        { label: "KW",      value: kpis.byCh.KW },
        { label: "VOL",     value: kpis.byCh.VOL },
        { label: "THM",     value: kpis.byCh.THM },
        { label: "MAN",     value: kpis.byCh.MAN },
      ]} />

      {/* §B · FILTER BAR */}
      <SectHead code="§ B · FILTER · 篩選" sub={`${filtered.length} / ${signals.length} signals`} />
      <FilterBar right={<Sort value={sort} options={SORTS} onChange={setSort} />}>
        <MultiChip label="CH" options={[...CHANNELS]} value={channels} onChange={setChannels} />
        <Seg label="Q"     value={quality} options={QUALITIES} onChange={setQuality} />
        <Seg label="STATE" value={state}   options={STATES}    onChange={setState} />
        <Seg label="RANGE" value={range}   options={RANGES}    onChange={setRange} />
        <TextInput label="FIND" value={q} onChange={setQ} placeholder="symbol / theme / trigger…" />
      </FilterBar>

      {/* §C · TIMELINE */}
      <SectHead code="§ C · TIMELINE · 時間軸" sub="density · high" />
      <div style={{ paddingBottom: 80 }}>
        {groups.length === 0 && (
          <div className="tg" style={{ color: "var(--night-soft)", padding: "20px 0" }}>
            NO MATCH · 調整篩選條件
          </div>
        )}
        {groups.map(g => (
          <div key={g.key} style={{ marginBottom: 18 }}>
            <DayHeader iso={g.items[0].emittedAt} count={g.items.length} />
            {g.items.map(s => <SignalRow key={s.id} s={s} />)}
          </div>
        ))}
      </div>

      {/* §D · CHANNEL LEGEND — sticky bottom */}
      <ChannelLegend />
    </PageFrame>
  );
}

/* ─── pieces ────────────────────────────────────────────────────────── */

function DayHeader({ iso, count }: { iso: string; count: number }) {
  return (
    <div style={{
      display: "flex", alignItems: "baseline", gap: 12,
      padding: "10px 0 6px", borderBottom: "1px solid var(--night-rule-strong)",
      marginBottom: 4,
    }}>
      <span style={{
        fontFamily: "var(--mono)", fontSize: 11, letterSpacing: "0.22em",
        color: "var(--gold)", fontWeight: 700,
      }}>{fmtDayHeader(iso)}</span>
      <span className="tg" style={{ color: "var(--night-mid)" }}>{count} signals</span>
    </div>
  );
}

function SignalRow({ s }: { s: Signal }) {
  const muted = s.state === "MUTED";
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "84px 60px 130px 90px 110px 1fr auto",
      gap: 12, padding: "10px 4px",
      borderBottom: "1px solid var(--night-rule)",
      alignItems: "baseline",
      opacity: muted ? 0.55 : 1,
    }}>
      {/* TS */}
      <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--night-mid)", fontFeatureSettings: '"tnum"' }}>
        {fmtTime(s.emittedAt)}
      </span>
      {/* CHANNEL chip */}
      <ChannelChip ch={s.channel} />
      {/* CODE */}
      <span style={{ fontFamily: "var(--mono)", fontSize: 11.5, color: "var(--gold)", letterSpacing: "0.14em", fontWeight: 700 }}>
        {s.code}
      </span>
      {/* SYMBOL */}
      <span style={{ fontFamily: "var(--mono)", fontSize: 12, color: s.symbol ? "var(--night-ink)" : "var(--night-soft)", fontWeight: 700 }}>
        {s.symbol ?? "—"}
      </span>
      {/* THEME */}
      <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: s.themeCode ? "var(--gold)" : "var(--night-soft)", letterSpacing: "0.12em" }}>
        {s.themeCode ?? "—"}
      </span>
      {/* TRIGGER (serif-tc) */}
      <span style={{ fontFamily: "var(--serif-tc)", fontSize: 14.5, color: "var(--night-ink)", lineHeight: 1.4 }}>
        {s.trigger}
      </span>
      {/* QUALITY + STATE */}
      <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
        <QualityBadge q={s.quality} />
        <span className="tg" style={{ color: muted ? "var(--night-soft)" : "var(--night-mid)" }}>{s.state}</span>
      </span>
    </div>
  );
}

function ChannelChip({ ch }: { ch: Signal["channel"] }) {
  return (
    <span style={{
      display: "inline-block", textAlign: "center", minWidth: 48,
      fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.22em", fontWeight: 700,
      padding: "3px 6px", border: "1px solid var(--night-rule-strong)",
      color: "var(--night-ink)",
    }}>{ch}</span>
  );
}

function ChannelLegend() {
  return (
    <div style={{
      position: "sticky", bottom: 12,
      marginTop: 18,
      background: "var(--night-1, rgba(15,12,8,0.92))",
      backdropFilter: "blur(6px)",
      border: "1px solid var(--night-rule-strong)",
      padding: "10px 14px",
    }}>
      <div className="tg" style={{ color: "var(--night-mid)", marginBottom: 6 }}>§ D · CHANNEL · LEGEND</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 10 }}>
        {CHANNELS.map(c => (
          <div key={c} style={{ display: "flex", flexDirection: "column", gap: 2, paddingRight: 8, borderRight: "1px solid var(--night-rule)" }}>
            <span style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <ChannelChip ch={c} />
              <span style={{ fontFamily: "var(--serif-tc)", fontSize: 13, color: "var(--night-ink)" }}>{CHANNEL_INFO[c].name}</span>
            </span>
            <span className="tg" style={{ color: "var(--night-soft)", fontSize: 9.5 }}>{CHANNEL_INFO[c].desc}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
