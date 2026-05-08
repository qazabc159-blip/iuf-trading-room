// IUF — 共用 React 組件
const { useState, useEffect, useRef, useMemo } = React;

// 狀態 chip
function StatusChip({ status, size }) {
  const meta = window.IUF_STATUS[status] || window.IUF_STATUS.empty;
  return (
    <span className={`chip ${meta.cls}`} style={size === "sm" ? { height: 18, fontSize: 10, padding: "0 6px" } : null}>
      <span className="dot"></span>
      <span>{meta.label}</span>
      <span style={{ opacity: 0.65, marginLeft: 2 }}>{meta.zh}</span>
    </span>
  );
}

// 數字滾動 (整數 / 小數)
function Counter({ value, decimals = 0, duration = 900, prefix = "", suffix = "" }) {
  const [v, setV] = useState(0);
  const startRef = useRef();
  useEffect(() => {
    let raf;
    const start = performance.now();
    const from = 0, to = value;
    startRef.current = start;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setV(from + (to - from) * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <span className="tnum mono">{prefix}{v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}{suffix}</span>;
}

// 即時心跳秒數 (相對時間)
function HeartbeatClock({ baseTime = "20:51:45", offset = 0 }) {
  const [t, setT] = useState(baseTime);
  useEffect(() => {
    const [hh, mm, ss] = baseTime.split(":").map(Number);
    let totalSec = hh * 3600 + mm * 60 + ss;
    const id = setInterval(() => {
      totalSec += 1;
      const h = String(Math.floor(totalSec / 3600) % 24).padStart(2, "0");
      const m = String(Math.floor(totalSec / 60) % 60).padStart(2, "0");
      const s = String(totalSec % 60).padStart(2, "0");
      setT(`${h}:${m}:${s}`);
    }, 1000);
    return () => clearInterval(id);
  }, [baseTime]);
  return <span className="mono tnum">{t}</span>;
}

// 進度條 (quota / readiness)
function ProgressBar({ value, max, color = "var(--brand)", height = 4 }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div style={{ background: "var(--bg-3)", height, borderRadius: 2, overflow: "hidden", position: "relative" }}>
      <div style={{ width: `${pct}%`, height: "100%", background: color, transition: "width 1.2s cubic-bezier(.2,.8,.2,1)" }} />
    </div>
  );
}

// Sparkline (SVG, 隨機平滑線,模擬資料趨勢) — points 應該由父層 useMemo 提供以避免 re-render 抖動
function Sparkline({ points, color = "var(--brand)", w = 80, h = 24, fill = true }) {
  const d = useMemo(() => {
    const min = Math.min(...points), max = Math.max(...points);
    const range = max - min || 1;
    return points.map((p, i) => {
      const x = (i / (points.length - 1)) * w;
      const y = h - ((p - min) / range) * (h - 2) - 1;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
  }, [points, w, h]);
  const area = `${d} L${w},${h} L0,${h} Z`;
  return (
    <svg width={w} height={h} style={{ display: "block", overflow: "visible" }}>
      {fill && <path d={area} fill={color} opacity="0.12" />}
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function genSpark(n = 24, base = 50, vol = 8) {
  const out = [base];
  for (let i = 1; i < n; i++) out.push(Math.max(5, out[i - 1] + (Math.random() - 0.5) * vol));
  return out;
}

// Cmd+K 命令面板
function CommandPalette({ open, onClose }) {
  const [q, setQ] = useState("");
  const items = [
    { g: "資料", t: "FinMind 健康狀態", k: "finmind" },
    { g: "資料", t: "OpenAlice 每日簡報", k: "openalice" },
    { g: "資料", t: "K 線資料源",          k: "kline" },
    { g: "資料", t: "公司資料",             k: "company" },
    { g: "工作流", t: "查 2330 公司頁",      k: "co/2330" },
    { g: "工作流", t: "紙上交易投組",         k: "paper" },
    { g: "工作流", t: "Portfolio readiness", k: "portfolio" },
    { g: "工作流", t: "營運監控",             k: "ops" },
    { g: "策略",  t: "策略候選池",            k: "ideas" },
    { g: "策略",  t: "策略批次紀錄",          k: "batch" },
    { g: "稽核",  t: "Audit Log",            k: "audit" },
  ];
  const filtered = items.filter(i => !q || i.t.includes(q) || i.k.includes(q.toLowerCase()));

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); onClose(!open); }
      if (e.key === "Escape" && open) onClose(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div onClick={() => onClose(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 100, display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: "12vh", backdropFilter: "blur(4px)" }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 560, maxWidth: "90vw", background: "var(--bg-1)", border: "1px solid var(--line-strong)", borderRadius: 10, boxShadow: "0 24px 60px rgba(0,0,0,0.6)" }}>
        <div style={{ display: "flex", alignItems: "center", padding: "14px 16px", borderBottom: "1px solid var(--line)" }}>
          <span className="mono" style={{ color: "var(--fg-3)", fontSize: 11, marginRight: 10 }}>›</span>
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="搜尋資料源、工作流、策略..." style={{ flex: 1, background: "transparent", border: 0, color: "var(--fg-0)", fontSize: 14, outline: "none", fontFamily: "var(--font-sans)" }} />
          <span className="mono" style={{ color: "var(--fg-3)", fontSize: 10, padding: "2px 6px", border: "1px solid var(--line)", borderRadius: 3 }}>ESC</span>
        </div>
        <div style={{ maxHeight: 380, overflow: "auto" }} className="scroll">
          {filtered.length === 0 && <div style={{ padding: 24, color: "var(--fg-3)", fontSize: 13, textAlign: "center" }}>無相符項目</div>}
          {filtered.map((i, idx) => (
            <div key={idx} className="cmd-row" style={{ display: "flex", alignItems: "center", padding: "10px 16px", cursor: "pointer", borderBottom: "1px solid var(--line)", gap: 12 }}>
              <span className="mono" style={{ fontSize: 10, color: "var(--fg-3)", width: 36 }}>{i.g}</span>
              <span style={{ color: "var(--fg-0)", fontSize: 13, flex: 1 }}>{i.t}</span>
              <span className="mono" style={{ fontSize: 10, color: "var(--fg-3)" }}>{i.k}</span>
            </div>
          ))}
        </div>
        <div style={{ padding: "8px 16px", borderTop: "1px solid var(--line)", color: "var(--fg-3)", fontSize: 10 }} className="mono">↑↓ 選擇 · ⏎ 開啟 · ESC 關閉</div>
      </div>
    </div>
  );
}

// 即時跳動數字 — 在固定範圍內小幅波動,並 flash 背景
function LiveCounter({ base, jitter = 1, decimals = 0, suffix = "", interval = 2400 }) {
  const [v, setV] = useState(base);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    const id = setInterval(() => {
      const delta = (Math.random() - 0.5) * 2 * jitter;
      setV(b => Math.max(0, base + delta));
      setFlash(true);
      setTimeout(() => setFlash(false), 600);
    }, interval);
    return () => clearInterval(id);
  }, [base, jitter, interval]);
  return (
    <span className={`tnum mono ${flash ? "flash" : ""}`} style={{ padding: "0 2px", borderRadius: 2 }}>
      {v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}{suffix}
    </span>
  );
}

// 跑馬燈 — 兩份內容銜接無縫
function Marquee({ children, speed = 60 }) {
  return (
    <div style={{ overflow: "hidden", position: "relative", width: "100%" }}>
      <div className="marquee-track" style={{ animationDuration: `${speed}s` }}>
        <div style={{ display: "inline-flex", gap: 24, paddingRight: 24 }}>{children}</div>
        <div style={{ display: "inline-flex", gap: 24, paddingRight: 24 }} aria-hidden="true">{children}</div>
      </div>
    </div>
  );
}

// SVG 條形脈動 — 用於資料源活躍度
function PulseBars({ count = 24, color = "var(--ok)", w = 72, h = 18 }) {
  const [seed, setSeed] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setSeed(s => s + 1), 800);
    return () => clearInterval(id);
  }, []);
  const bars = useMemo(() => Array.from({ length: count }, () => 0.2 + Math.random() * 0.8), [seed, count]);
  const bw = w / count;
  return (
    <svg width={w} height={h} style={{ display: "block" }}>
      {bars.map((v, i) => (
        <rect key={i} x={i * bw + 0.5} y={h - v * h} width={bw - 1} height={v * h} fill={color} opacity={0.3 + v * 0.7} />
      ))}
    </svg>
  );
}

// 角落十字準星標記
function CornerMarks() {
  return (
    <>
      <span className="corner-mark tl"></span>
      <span className="corner-mark tr"></span>
      <span className="corner-mark bl"></span>
      <span className="corner-mark br"></span>
    </>
  );
}

// 小型雷達掃描 (徽章用)
function MiniRadar({ size = 36, color = "var(--brand)" }) {
  return (
    <div style={{ width: size, height: size, position: "relative", borderRadius: "50%", border: "1px solid var(--line-strong)", overflow: "hidden" }}>
      <div style={{ position: "absolute", inset: "20%", borderRadius: "50%", border: `1px solid ${color}`, opacity: 0.3 }}></div>
      <div style={{ position: "absolute", inset: "40%", borderRadius: "50%", border: `1px solid ${color}`, opacity: 0.5 }}></div>
      <div style={{ position: "absolute", inset: 0, background: `conic-gradient(from 0deg, transparent 0deg, ${color}66 30deg, transparent 60deg)`, animation: "radar-sweep 3s linear infinite" }}></div>
      <div style={{ position: "absolute", left: "50%", top: "50%", width: 3, height: 3, borderRadius: "50%", background: color, transform: "translate(-50%,-50%)" }}></div>
    </div>
  );
}

// 入場 stagger 容器 — 直接子元素依序進場
function Stagger({ children, delay = 60 }) {
  const arr = React.Children.toArray(children);
  return arr.map((child, i) =>
    React.cloneElement(child, {
      style: { ...(child.props.style || {}), animationDelay: `${i * delay}ms` },
      className: ((child.props.className || "") + " card-in").trim(),
      key: child.key ?? i,
    })
  );
}

// 報價跑馬燈項目 — 個股 / 指數共用
function QuoteItem({ q, kind = "stock" }) {
  const up = q.chg > 0, down = q.chg < 0;
  const color = up ? "var(--bad)" : down ? "var(--ok)" : "var(--fg-2)"; // 台股慣例:漲紅跌綠
  const arrow = up ? "▲" : down ? "▼" : "—";
  const fmt = (n, dp) => Number(n).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
  const dp = q.price >= 1000 ? 0 : q.price >= 100 ? 1 : 2;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12 }}>
      <span className="mono" style={{ color: "var(--brand)", fontWeight: 700, letterSpacing: "0.04em" }}>{q.sym}</span>
      <span style={{ color: "var(--fg-1)" }}>{q.name}</span>
      <span className="mono tnum" style={{ color: "var(--fg-0)", fontWeight: 600 }}>{fmt(q.price, dp)}</span>
      <span className="mono tnum" style={{ color, fontSize: 11 }}>
        {arrow} {q.chg > 0 ? "+" : ""}{fmt(q.chg, dp)} {q.pct != null && <span style={{ opacity: 0.85 }}>({q.pct > 0 ? "+" : ""}{q.pct.toFixed(2)}%)</span>}
      </span>
      <span style={{ color: "var(--fg-4)", margin: "0 4px" }}>·</span>
    </span>
  );
}

// 法人買賣超項目
function FlowItem({ q }) {
  const up = q.price > 0;
  const color = up ? "var(--bad)" : "var(--ok)";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12 }}>
      <span className="mono" style={{ color: "var(--fg-3)", letterSpacing: "0.06em" }}>{q.sym}</span>
      <span style={{ color: "var(--fg-1)" }}>{q.name}</span>
      <span className="mono tnum" style={{ color, fontWeight: 600 }}>{q.price > 0 ? "+" : ""}{q.price.toLocaleString()} {q.unit}</span>
      <span style={{ color: "var(--fg-4)", margin: "0 4px" }}>·</span>
    </span>
  );
}

// 漲跌家數圖
function BreadthBar({ b }) {
  const total = b.total || 1;
  const upPct = (b.up / total) * 100;
  const flatPct = (b.flat / total) * 100;
  const downPct = (b.down / total) * 100;
  return (
    <div>
      <div style={{ display: "flex", height: 8, borderRadius: 2, overflow: "hidden", background: "var(--bg-3)" }}>
        <div style={{ width: `${upPct}%`,   background: "var(--bad)" }}></div>
        <div style={{ width: `${flatPct}%`, background: "var(--fg-3)" }}></div>
        <div style={{ width: `${downPct}%`, background: "var(--ok)" }}></div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 10 }} className="mono">
        <span style={{ color: "var(--bad)" }}>▲ 漲 {b.up}</span>
        <span style={{ color: "var(--fg-3)" }}>— 平 {b.flat}</span>
        <span style={{ color: "var(--ok)" }}>▼ 跌 {b.down}</span>
      </div>
    </div>
  );
}

// 加權指數當日走勢
function IntradayChart({ points, w = 320, h = 80 }) {
  const min = Math.min(...points), max = Math.max(...points);
  const open = points[0], close = points[points.length - 1];
  const range = max - min || 1;
  const path = points.map((p, i) => {
    const x = (i / (points.length - 1)) * w;
    const y = h - ((p - min) / range) * (h - 4) - 2;
    return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const area = `${path} L${w},${h} L0,${h} Z`;
  const color = close < open ? "var(--ok)" : "var(--bad)"; // 跌綠漲紅
  // 開盤水平線
  const openY = h - ((open - min) / range) * (h - 4) - 2;
  return (
    <svg width={w} height={h} style={{ display: "block" }}>
      <defs>
        <linearGradient id="grad-twii" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <line x1="0" x2={w} y1={openY} y2={openY} stroke="var(--fg-4)" strokeDasharray="2 3" strokeWidth="1" />
      <path d={area} fill="url(#grad-twii)" />
      <path d={path} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

// Heatmap 方塊 — 字級隨格子尺寸縮放,留白足夠
function HeatmapTile({ s, big }) {
  const intensity = Math.min(1, Math.abs(s.pct) / 2);
  const isUp = s.pct > 0, isFlat = s.pct === 0;
  const bg = isFlat
    ? `rgba(138,150,168,${0.18 + intensity * 0.25})`
    : isUp
      ? `rgba(255,90,110,${0.22 + intensity * 0.5})`
      : `rgba(61,220,151,${0.22 + intensity * 0.5})`;
  const border = isFlat ? "rgba(138,150,168,0.28)" : isUp ? "rgba(255,90,110,0.4)" : "rgba(61,220,151,0.4)";
  return (
    <div style={{ width: "100%", height: "100%", background: bg, border: `1px solid ${border}`, padding: big ? 14 : 8, display: "flex", flexDirection: "column", justifyContent: "space-between", cursor: "pointer", transition: "filter 0.15s", overflow: "hidden", position: "relative", borderRadius: 2 }}
         onMouseEnter={e => { e.currentTarget.style.filter = "brightness(1.2)"; }}
         onMouseLeave={e => { e.currentTarget.style.filter = "none"; }}>
      <div style={{ display: "flex", flexDirection: "column", gap: big ? 2 : 1 }}>
        <span className="mono" style={{ fontSize: big ? 14 : 10, color: "var(--fg-0)", fontWeight: 700, letterSpacing: "0.02em", lineHeight: 1 }}>{s.sym}</span>
        <span style={{ fontSize: big ? 12 : 9, color: "var(--fg-1)", opacity: 0.75, lineHeight: 1 }}>{s.name}</span>
      </div>
      <span className="mono tnum" style={{ fontSize: big ? 22 : 12, color: "var(--fg-0)", fontWeight: 600, lineHeight: 1, alignSelf: "flex-end" }}>
        {s.pct > 0 ? "+" : ""}{s.pct.toFixed(2)}%
      </span>
    </div>
  );
}

// 任務節奏橫條
function AgendaTimeline({ items }) {
  return (
    <div style={{ position: "relative", padding: "20px 8px 8px" }}>
      <div style={{ position: "absolute", left: 8, right: 8, top: 32, height: 1, background: "var(--line)" }}></div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${items.length}, 1fr)`, gap: 0 }}>
        {items.map((a, i) => {
          const map = { done: "var(--ok)", doing: "var(--warn)", todo: "var(--fg-4)", now: "var(--brand)" };
          const c = map[a.state];
          const isNow = a.state === "now";
          return (
            <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", position: "relative" }}>
              <div className="mono" style={{ fontSize: 10, color: "var(--fg-3)", marginBottom: 8 }}>{a.time}</div>
              <div style={{ width: isNow ? 14 : 10, height: isNow ? 14 : 10, borderRadius: "50%", background: c, border: isNow ? "2px solid var(--brand)" : "none", boxShadow: isNow ? "0 0 12px var(--brand)" : "none", animation: a.state === "doing" ? "pulse-warn 1.4s infinite" : "none" }} className={isNow ? "blink" : ""}></div>
              <div style={{ fontSize: 11, color: isNow ? "var(--brand)" : a.state === "todo" ? "var(--fg-3)" : "var(--fg-1)", marginTop: 8, fontWeight: isNow ? 600 : 400, textAlign: "center", letterSpacing: "0.02em" }}>{a.label}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// 資料新鮮度時間軸 — 每個來源獨立一條 lane(類似 Grafana row)
function FreshnessTimeline({ sources }) {
  const ticks = [
    { v: 0,        label: "1 分" },
    { v: 33,       label: "1 時" },
    { v: 66,       label: "1 日" },
    { v: 100,      label: "15 日+" },
  ];
  return (
    <div style={{ padding: "12px 18px 16px" }}>
      {/* 軸標籤 */}
      <div style={{ position: "relative", height: 14, marginBottom: 8 }}>
        {ticks.map((t, i) => (
          <span key={i} className="mono" style={{ position: "absolute", left: `${t.v}%`, transform: i === 0 ? "translateX(0)" : i === ticks.length - 1 ? "translateX(-100%)" : "translateX(-50%)", fontSize: 9, color: "var(--fg-3)", letterSpacing: "0.04em" }}>{t.label}</span>
        ))}
      </div>
      {/* lanes */}
      <div>
        {sources.map((s, i) => {
          const left = Math.min(100, (Math.log10(s.staleness + 1) / Math.log10(21600 + 1)) * 100);
          const c = s.staleness < 60 ? "var(--ok)" : s.staleness < 1440 ? "var(--warn)" : "var(--bad)";
          const ago = s.staleness < 60 ? `${s.staleness} 分內`
                    : s.staleness < 1440 ? `${Math.round(s.staleness / 60)} 小時前`
                    : `${Math.round(s.staleness / 1440)} 天前`;
          return (
            <div key={s.key} style={{ display: "grid", gridTemplateColumns: "78px 1fr 64px", gap: 12, alignItems: "center", padding: "6px 0", borderBottom: i < sources.length - 1 ? "1px dashed var(--line)" : "none" }}>
              <span className="mono" style={{ fontSize: 11, color: "var(--fg-1)", fontWeight: 500 }}>{s.short}</span>
              <div style={{ position: "relative", height: 14 }}>
                {/* 三段背景 (新鮮 / 過期 / 嚴重過期) */}
                <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to right, rgba(61,220,151,0.10) 0%, rgba(61,220,151,0.10) 33%, rgba(255,181,71,0.10) 33%, rgba(255,181,71,0.10) 66%, rgba(255,90,110,0.10) 66%, rgba(255,90,110,0.10) 100%)", borderRadius: 2 }}></div>
                {/* 分隔線 */}
                <span style={{ position: "absolute", left: "33%", top: 0, bottom: 0, width: 1, background: "var(--line)" }}></span>
                <span style={{ position: "absolute", left: "66%", top: 0, bottom: 0, width: 1, background: "var(--line)" }}></span>
                {/* 標記點 */}
                <div style={{ position: "absolute", left: `${left}%`, top: "50%", transform: "translate(-50%, -50%)", width: 10, height: 10, borderRadius: "50%", background: c, boxShadow: `0 0 0 2px var(--bg-1), 0 0 0 3px ${c}66` }}></div>
              </div>
              <span className="mono tnum" style={{ fontSize: 10, color: c, textAlign: "right", fontWeight: 600 }}>{ago}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Detail Drawer
function Drawer({ open, onClose, src }) {
  if (!open || !src) return null;
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 90, backdropFilter: "blur(2px)" }}>
      <div onClick={e => e.stopPropagation()} style={{ position: "absolute", top: 0, right: 0, bottom: 0, width: 460, background: "var(--bg-1)", borderLeft: "1px solid var(--line-strong)", boxShadow: "-12px 0 40px rgba(0,0,0,0.5)", animation: "drawer-in 0.25s cubic-bezier(.2,.8,.2,1)", overflowY: "auto" }} className="scroll">
        <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div className="mono uppercase" style={{ fontSize: 10, color: "var(--brand)", letterSpacing: "0.16em" }}>資料源 · DETAIL</div>
            <div style={{ fontSize: 18, color: "var(--fg-0)", fontWeight: 600, marginTop: 6 }}>{src.name}</div>
          </div>
          <button onClick={onClose} className="btn ghost" style={{ width: 28, height: 28, padding: 0, justifyContent: "center" }}>✕</button>
        </div>
        <div style={{ padding: 24 }}>
          <div style={{ marginBottom: 18 }}><StatusChip status={src.status} /></div>
          <div style={{ fontSize: 12, color: "var(--fg-2)", lineHeight: 1.7, marginBottom: 18 }}>{src.desc}</div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 14, marginBottom: 22 }}>
            <div>
              <div className="mono uppercase" style={{ fontSize: 10, color: "var(--fg-3)", marginBottom: 6 }}>更新時間</div>
              <div className="mono" style={{ fontSize: 13, color: "var(--fg-0)" }}>{src.updated}</div>
            </div>
            <div>
              <div className="mono uppercase" style={{ fontSize: 10, color: "var(--fg-3)", marginBottom: 6 }}>新鮮度</div>
              <div className="mono" style={{ fontSize: 13, color: src.staleness < 60 ? "var(--ok)" : src.staleness < 1440 ? "var(--warn)" : "var(--bad)" }}>{src.staleness < 60 ? `${src.staleness} 分內` : src.staleness < 1440 ? `${Math.round(src.staleness/60)} 小時前` : `${Math.round(src.staleness/1440)} 天前`}</div>
            </div>
          </div>

          <div className="mono uppercase" style={{ fontSize: 10, color: "var(--fg-3)", marginBottom: 10 }}>近期軌跡</div>
          <div style={{ background: "var(--bg-2)", padding: 14, borderRadius: 6 }}>
            <Sparkline points={genSpark(40, 50, 8)} w={400} h={50} color={src.status === "live" ? "var(--ok)" : src.status === "stale" ? "var(--warn)" : "var(--fg-3)"} />
          </div>

          {src.detail && (
            <div style={{ marginTop: 22 }}>
              <div className="mono uppercase" style={{ fontSize: 10, color: "var(--fg-3)", marginBottom: 10 }}>診斷</div>
              <div style={{ padding: 14, background: "var(--bg-2)", borderRadius: 6, fontSize: 12, color: "var(--fg-1)", lineHeight: 1.7 }}>{src.detail}</div>
            </div>
          )}

          <div style={{ marginTop: 22 }}>
            <div className="mono uppercase" style={{ fontSize: 10, color: "var(--fg-3)", marginBottom: 10 }}>下一步</div>
            <button className="btn primary" style={{ width: "100%", justifyContent: "center" }}>{src.cta || "進入該頁面 ›"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// 背景粒子 — canvas
function ParticleField() {
  const ref = useRef();
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = canvas.width = canvas.offsetWidth * dpr;
    const H = canvas.height = canvas.offsetHeight * dpr;
    const ctx = canvas.getContext("2d");
    const N = 60;
    const pts = Array.from({ length: N }, () => ({
      x: Math.random() * W, y: Math.random() * H,
      vx: (Math.random() - 0.5) * 0.15 * dpr,
      vy: (Math.random() - 0.5) * 0.15 * dpr,
      r: 0.6 + Math.random() * 1.2,
    }));
    let raf;
    const tick = () => {
      ctx.clearRect(0, 0, W, H);
      for (const p of pts) {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0 || p.x > W) p.vx *= -1;
        if (p.y < 0 || p.y > H) p.vy *= -1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * dpr, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,230,0,0.18)";
        ctx.fill();
      }
      // 連線
      for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
        const dx = pts[i].x - pts[j].x, dy = pts[i].y - pts[j].y;
        const d2 = dx*dx + dy*dy;
        const max = 140 * dpr;
        if (d2 < max * max) {
          ctx.beginPath();
          ctx.moveTo(pts[i].x, pts[i].y);
          ctx.lineTo(pts[j].x, pts[j].y);
          const a = (1 - d2 / (max * max)) * 0.06;
          ctx.strokeStyle = `rgba(255,230,0,${a})`;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={ref} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", opacity: 0.7 }} />;
}

// 強化版 Cmd+K — 含分組、最近瀏覽、即時搜尋
function CommandPaletteV2({ open, onClose }) {
  const [q, setQ] = useState("");
  const groups = useMemo(() => [
    { g: "資料源", items: [
      { t: "FinMind 健康狀態", k: "finmind", state: "live" },
      { t: "K 線資料源",          k: "kline", state: "live" },
      { t: "公司資料",             k: "company", state: "live" },
      { t: "OpenAlice 每日簡報",   k: "openalice", state: "review" },
      { t: "主題資料",             k: "theme", state: "stale" },
      { t: "策略想法",             k: "ideas", state: "live" },
      { t: "訊號證據",             k: "signal", state: "stale" },
      { t: "重大訊息",             k: "news", state: "empty" },
    ]},
    { g: "工作流", items: [
      { t: "查 2330 公司頁",      k: "co/2330" },
      { t: "查 2317 公司頁",      k: "co/2317" },
      { t: "紙上交易投組",         k: "paper" },
      { t: "Portfolio readiness", k: "portfolio" },
      { t: "今日 OpenAlice 簡報",  k: "brief/today" },
      { t: "營運監控",             k: "ops" },
    ]},
    { g: "個股報價", items: window.IUF_QUOTES.stocks.slice(0, 10).map(s => ({ t: `${s.sym} ${s.name}`, k: `co/${s.sym}` })) },
    { g: "稽核",  items: [
      { t: "Audit Log",            k: "audit" },
      { t: "策略批次紀錄",          k: "batch" },
      { t: "風控閘門記錄",          k: "risk" },
    ]},
  ], []);

  const filtered = useMemo(() => {
    if (!q) return groups;
    return groups.map(g => ({ ...g, items: g.items.filter(i => i.t.includes(q) || i.k.toLowerCase().includes(q.toLowerCase())) })).filter(g => g.items.length);
  }, [q, groups]);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); onClose(!open); }
      if (e.key === "Escape" && open) onClose(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  const stateMap = { live: "var(--ok)", stale: "var(--warn)", empty: "var(--fg-3)", review: "var(--warn)" };
  return (
    <div onClick={() => onClose(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 100, display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: "10vh", backdropFilter: "blur(6px)" }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 620, maxWidth: "90vw", background: "var(--bg-1)", border: "1px solid var(--line-strong)", borderRadius: 10, boxShadow: "0 32px 80px rgba(0,0,0,0.7)", animation: "card-in 0.25s cubic-bezier(.2,.8,.2,1)" }}>
        <div style={{ display: "flex", alignItems: "center", padding: "14px 18px", borderBottom: "1px solid var(--line)" }}>
          <span className="mono" style={{ color: "var(--brand)", fontSize: 11, marginRight: 12, letterSpacing: "0.12em" }}>›</span>
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="搜尋資料源、個股代號、工作流..." style={{ flex: 1, background: "transparent", border: 0, color: "var(--fg-0)", fontSize: 14, outline: "none", fontFamily: "var(--font-sans)" }} />
          <span className="mono" style={{ color: "var(--fg-3)", fontSize: 10, padding: "2px 6px", border: "1px solid var(--line)", borderRadius: 3 }}>ESC</span>
        </div>
        <div style={{ maxHeight: 460, overflow: "auto" }} className="scroll">
          {filtered.length === 0 && <div style={{ padding: 28, color: "var(--fg-3)", fontSize: 13, textAlign: "center" }}>無相符項目</div>}
          {filtered.map((grp, gi) => (
            <div key={gi}>
              <div className="mono uppercase" style={{ fontSize: 9, color: "var(--fg-3)", padding: "10px 18px 6px", letterSpacing: "0.12em", background: "var(--bg-2)" }}>{grp.g}</div>
              {grp.items.map((i, idx) => (
                <div key={idx} className="row-hover" style={{ display: "flex", alignItems: "center", padding: "10px 18px", cursor: "pointer", borderBottom: "1px solid var(--line)", gap: 12 }}>
                  {i.state && <span style={{ width: 6, height: 6, borderRadius: "50%", background: stateMap[i.state] }}></span>}
                  <span style={{ color: "var(--fg-0)", fontSize: 13, flex: 1 }}>{i.t}</span>
                  <span className="mono" style={{ fontSize: 10, color: "var(--fg-3)" }}>{i.k}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div style={{ padding: "10px 18px", borderTop: "1px solid var(--line)", color: "var(--fg-3)", fontSize: 10, display: "flex", justifyContent: "space-between" }} className="mono">
          <span>↑↓ 選擇 · ⏎ 開啟 · ESC 關閉</span>
          <span style={{ color: "var(--fg-4)" }}>共 {filtered.reduce((a, g) => a + g.items.length, 0)} 項</span>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { StatusChip, Counter, HeartbeatClock, ProgressBar, Sparkline, genSpark, CommandPalette, LiveCounter, Marquee, PulseBars, CornerMarks, MiniRadar, Stagger, QuoteItem, FlowItem, BreadthBar, IntradayChart, HeatmapTile, AgendaTimeline, FreshnessTimeline, Drawer, ParticleField, CommandPaletteV2 });
