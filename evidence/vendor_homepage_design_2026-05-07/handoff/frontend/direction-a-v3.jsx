// 方向 A v3 — 戰情室究極版
// 在 v2 基礎上加上:報價跑馬燈 / 加權指數走勢 / 漲跌家數 / 公司池 Heatmap / 任務節奏橫條 / 資料新鮮度時間軸 / Detail drawer / 背景粒子 / Cmd+K v2

function DirectionAV3() {
  const D = window.IUF_DATA;
  const [cmdOpen, setCmdOpen] = useState(false);
  const [hoverSrc, setHoverSrc] = useState(null);
  const [drawerSrc, setDrawerSrc] = useState(null);

  // 預先固化每個來源的 sparkline points,避免 hover 重 render 時抖動
  const sourceSparks = useMemo(() => {
    const out = {};
    for (const s of D.sources) {
      const base = s.status === "live" ? 50 : s.status === "stale" ? 20 : 8;
      const vol  = s.status === "live" ? 6 : 2;
      out[s.key] = genSpark(20, base, vol);
    }
    return out;
  }, []);
  const portfolioSpark = useMemo(() => genSpark(16, 30, 4), []);

  return (
    <div style={{ width: 1920, minHeight: 1280, background: "var(--bg-0)", color: "var(--fg-1)", display: "grid", gridTemplateColumns: "240px 1fr", overflow: "hidden", fontFamily: "var(--font-sans)", position: "relative" }} className="grid-bg-anim">
      {/* 全頁掃描覆蓋 */}
      <div className="scanline-overlay"></div>

      <CommandPaletteV2 open={cmdOpen} onClose={setCmdOpen} />
      <Drawer open={!!drawerSrc} onClose={() => setDrawerSrc(null)} src={drawerSrc} />

      {/* 側邊 */}
      <aside style={{ borderRight: "1px solid var(--line)", background: "rgba(7,9,13,0.85)", display: "flex", flexDirection: "column", position: "relative", zIndex: 2 }}>
        <div style={{ padding: "20px 20px 16px", borderBottom: "1px solid var(--line)", position: "relative" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
            <div style={{ width: 26, height: 26, background: "var(--brand)", color: "#000", display: "grid", placeItems: "center", fontFamily: "var(--font-mono)", fontWeight: 900, fontSize: 12, position: "relative" }}>
              I
              <span style={{ position: "absolute", inset: -3, border: "1px solid var(--brand)", opacity: 0.4 }}></span>
            </div>
            <div>
              <div className="mono" style={{ fontSize: 10, letterSpacing: "0.2em", color: "var(--brand)", fontWeight: 600 }}>IUF · 戰情台</div>
              <div className="mono" style={{ fontSize: 9, color: "var(--fg-3)", marginTop: 2 }}>v3.0 · TACTICAL</div>
            </div>
          </div>
          <div style={{ fontSize: 14, color: "var(--fg-0)", fontWeight: 600, marginBottom: 4 }}>台股 AI 交易戰情室</div>
          <div className="mono" style={{ fontSize: 11, color: "var(--fg-3)" }}>操作員 · {D.meta.operator}</div>
          <div style={{ marginTop: 12, padding: "8px 10px", background: "var(--warn-bg)", border: "1px solid var(--warn-line)", borderRadius: 4, color: "var(--warn)", fontSize: 11, display: "flex", alignItems: "center", gap: 8 }} className="mono">
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--warn)" }} className="blink"></span>
            {D.meta.mode}
          </div>
        </div>

        <nav style={{ padding: "12px 0", flex: 1 }}>
          {[
            { t: "戰情台總覽",  s: "盤勢與任務", active: true, k: "01" },
            { t: "主題板",      s: "產業主題",            k: "02" },
            { t: "公司板",      s: "台股公司池",          k: "03" },
            { t: "策略想法",    s: "候選清單",            k: "04" },
            { t: "策略批次",    s: "批次紀錄",            k: "05" },
            { t: "模擬交易室",  s: "委託與部位",          k: "06" },
            { t: "訊號證據",    s: "訊號與依據",          k: "07" },
            { t: "交易計畫",    s: "計畫註記",            k: "08" },
            { t: "營運監控",    s: "系統狀態",            k: "09" },
          ].map((n, i) => (
            <a key={i} href="#" className="row-hover" style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 20px", borderLeft: `2px solid ${n.active ? "var(--brand)" : "transparent"}`, background: n.active ? "rgba(255,230,0,0.05)" : "transparent", textDecoration: "none" }}>
              <span className="mono" style={{ fontSize: 9, color: n.active ? "var(--brand)" : "var(--fg-4)" }}>{n.k}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, color: n.active ? "var(--fg-0)" : "var(--fg-1)", fontWeight: n.active ? 600 : 400 }}>{n.t}</div>
                <div className="mono" style={{ fontSize: 10, color: "var(--fg-3)", marginTop: 2 }}>{n.s}</div>
              </div>
              {n.active && <span style={{ width: 4, height: 4, borderRadius: "50%", background: "var(--brand)" }}></span>}
            </a>
          ))}
        </nav>

        {/* 側邊雷達 */}
        <div style={{ padding: 16, borderTop: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 12 }}>
          <MiniRadar size={42} />
          <div>
            <div className="mono" style={{ fontSize: 9, color: "var(--fg-3)", letterSpacing: "0.1em", marginBottom: 4 }}>SCANNING · 8 SRC</div>
            <div className="mono" style={{ fontSize: 11, color: "var(--ok)", fontWeight: 600 }}>5 LIVE / 3 ALERT</div>
          </div>
        </div>

        <div style={{ padding: 14, borderTop: "1px solid var(--line)", fontSize: 11 }} className="mono">
          <div style={{ color: "var(--fg-3)", marginBottom: 4, fontSize: 10, letterSpacing: "0.1em" }}>本機時鐘 · 台北</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <HeartbeatClock baseTime="20:51:45" />
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--ok)" }} className="blink"></span>
          </div>
        </div>
      </aside>

      {/* 主區 */}
      <main style={{ overflow: "auto", position: "relative", zIndex: 1 }} className="scroll">
        {/* === 頂部跑馬燈 === */}
        <div style={{ borderBottom: "1px solid var(--line)", background: "linear-gradient(to bottom, rgba(255,230,0,0.04), transparent)", padding: "9px 0", position: "relative" }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            <div style={{ flexShrink: 0, padding: "0 16px", borderRight: "1px solid var(--line-strong)", display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--brand)" }} className="blink"></span>
              <span className="mono" style={{ fontSize: 10, color: "var(--brand)", letterSpacing: "0.16em", fontWeight: 700 }}>LIVE FEED</span>
            </div>
            <div style={{ flex: 1, overflow: "hidden", padding: "0 16px", display: "flex", alignItems: "center", gap: 8 }}>
              <span className="mono" style={{ fontSize: 9, color: "var(--warn)", padding: "2px 6px", border: "1px solid var(--warn-line)", background: "var(--warn-bg)", borderRadius: 2, flexShrink: 0, letterSpacing: "0.08em" }}>市場資料 EMPTY · 以下為示意</span>
              <Marquee speed={80}>
                {[
                  ...window.IUF_QUOTES.indices.map((q, i) => <QuoteItem key={`i${i}`} q={q} />),
                  ...window.IUF_QUOTES.flows.map((q, i) => <FlowItem key={`f${i}`} q={q} />),
                  ...window.IUF_QUOTES.stocks.map((q, i) => <QuoteItem key={`s${i}`} q={q} />),
                ]}
              </Marquee>
            </div>
          </div>
        </div>

        <div style={{ padding: "0 32px 32px" }}>
          {/* 頂部命令列 */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 0 16px", borderBottom: "1px solid var(--line)" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 16 }}>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 28, fontWeight: 600, color: "var(--fg-0)", letterSpacing: "-0.01em" }}>交易戰情台</div>
              <div className="mono" style={{ fontSize: 10, color: "var(--fg-3)", letterSpacing: "0.1em" }}>資料健康 · 交易工作流 · 風控守門</div>
              <span className="mono" style={{ fontSize: 10, color: "var(--brand)", padding: "2px 6px", border: "1px solid var(--brand)", borderRadius: 2, letterSpacing: "0.1em" }}>D+0 · 觀察日</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <PulseBars count={20} color="var(--brand)" w={72} h={20} />
              <div className="mono" style={{ fontSize: 11, color: "var(--fg-3)" }}>{D.meta.nowText}</div>
              <button className="btn ghost" onClick={() => setCmdOpen(true)} style={{ gap: 10 }}>
                <span style={{ color: "var(--fg-3)" }}>搜尋</span>
                <span className="mono" style={{ fontSize: 10, padding: "2px 5px", border: "1px solid var(--line)", borderRadius: 3, color: "var(--fg-3)" }}>⌘ K</span>
              </button>
              <span className="chip blocked"><span className="dot"></span>正式下單 BLOCKED</span>
            </div>
          </div>

          {/* 任務節奏橫條 */}
          <div className="panel tactical card-in" style={{ marginTop: 16, position: "relative", padding: "4px 18px 4px", animationDelay: "40ms" }}>
            <CornerMarks />
            <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
              <div style={{ flexShrink: 0, paddingRight: 18, borderRight: "1px solid var(--line)" }}>
                <div className="mono uppercase" style={{ fontSize: 9, color: "var(--brand)", letterSpacing: "0.16em", marginBottom: 4 }}>今日節奏</div>
                <div className="mono tnum" style={{ fontSize: 18, color: "var(--fg-0)", fontWeight: 600 }}><HeartbeatClock baseTime="20:51:45" /></div>
              </div>
              <div style={{ flex: 1 }}>
                <AgendaTimeline items={window.IUF_AGENDA} />
              </div>
            </div>
          </div>

          {/* HERO */}
          <section style={{ display: "grid", gridTemplateColumns: "minmax(0,1.3fr) minmax(0,1fr)", gap: 16, marginTop: 16 }}>
            {/* 左 — 戰情 hero:狀態列 + 加權指數 + 漲跌家數 + 4 KPI,沒有炫技中文標題 */}
            <div className="panel tactical card-in hero-panel" style={{ padding: 0, position: "relative", overflow: "hidden", animationDelay: "0ms" }}>
              <CornerMarks />

              {/* 頂部緊湊狀態列 — 取代大標題 */}
              <div style={{ display: "flex", alignItems: "stretch", gap: 0, borderBottom: "1px solid var(--line)", background: "linear-gradient(90deg, rgba(255,230,0,0.05) 0%, transparent 40%)", position: "relative" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", borderRight: "1px solid var(--line)" }}>
                  <span style={{ width: 6, height: 6, borderRadius: 3, background: "var(--brand)" }} className="blink"></span>
                  <span className="mono" style={{ fontSize: 10, color: "var(--brand)", letterSpacing: "0.18em", fontWeight: 700 }}>OBSERVE</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", padding: "8px 14px", borderRight: "1px solid var(--line)" }}>
                  <span className="mono" style={{ fontSize: 8, color: "var(--fg-3)", letterSpacing: "0.16em", marginBottom: 2 }}>OPERATOR</span>
                  <span className="mono" style={{ fontSize: 11, color: "var(--fg-1)", fontWeight: 600 }}>IUF-01</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", padding: "8px 14px", borderRight: "1px solid var(--line)" }}>
                  <span className="mono" style={{ fontSize: 8, color: "var(--fg-3)", letterSpacing: "0.16em", marginBottom: 2 }}>SESSION</span>
                  <span className="mono tnum" style={{ fontSize: 11, color: "var(--fg-1)", fontWeight: 600 }}><HeartbeatClock baseTime="20:51:45" /></span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", padding: "8px 14px", flex: 1, borderRight: "1px solid var(--line)" }}>
                  <span className="mono" style={{ fontSize: 8, color: "var(--fg-3)", letterSpacing: "0.16em", marginBottom: 2 }}>NEXT ACTION</span>
                  <span style={{ fontSize: 11, color: "var(--fg-1)" }}>檢查 FinMind quota <span style={{ color: "var(--fg-3)" }}>→</span> 確認 OpenAlice source trail</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", padding: "0 14px" }}>
                  <span className="mono" style={{ fontSize: 9, padding: "4px 8px", background: "var(--bad-bg)", color: "var(--bad)", border: "1px solid var(--bad-line)", borderRadius: 2, letterSpacing: "0.14em", fontWeight: 600 }}>● 正式下單 BLOCKED</span>
                </div>
              </div>

              {/* 主要內容 */}
              <div style={{ padding: "20px 24px 22px", position: "relative" }}>
                {/* 加權指數 + 漲跌家數 — 直接放最上面,佔據視覺重點 */}
                <div style={{ padding: "16px 18px", background: "linear-gradient(180deg, var(--bg-2) 0%, var(--bg-1) 100%)", borderRadius: 6, border: "1px solid var(--line)", position: "relative", display: "grid", gridTemplateColumns: "1.4fr 1px 1fr", gap: 20 }}>
                  <span className="mono" style={{ position: "absolute", top: 10, right: 12, fontSize: 9, padding: "2px 6px", background: "var(--warn-bg)", color: "var(--warn)", border: "1px solid var(--warn-line)", borderRadius: 2, letterSpacing: "0.1em" }}>EMPTY · 示意</span>

                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                      <span className="mono uppercase" style={{ fontSize: 9, color: "var(--brand)", fontWeight: 600, letterSpacing: "0.14em" }}>TWII</span>
                      <span style={{ fontSize: 10, color: "var(--fg-3)" }}>加權指數</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 6 }}>
                      <span className="mono tnum" style={{ fontSize: 28, fontWeight: 500, color: "var(--fg-0)", fontFamily: "var(--font-display)", letterSpacing: "-0.01em" }}>22,847.32</span>
                      <span className="mono tnum" style={{ fontSize: 12, color: "var(--ok)", fontWeight: 600 }}>▼ 132.45</span>
                      <span className="mono tnum" style={{ fontSize: 12, color: "var(--ok)" }}>−0.58%</span>
                    </div>
                    <IntradayChart points={window.IUF_TWII_INTRADAY} w={360} h={44} />
                  </div>

                  <div style={{ background: "var(--line)" }}></div>

                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                      <span className="mono uppercase" style={{ fontSize: 9, color: "var(--brand)", fontWeight: 600, letterSpacing: "0.14em" }}>BREADTH</span>
                      <span style={{ fontSize: 10, color: "var(--fg-3)" }}>漲跌家數</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 14, marginBottom: 8, fontFamily: "var(--font-display)" }}>
                      <span><span className="mono tnum" style={{ fontSize: 22, fontWeight: 500, color: "var(--bad)" }}>{window.IUF_BREADTH.up}</span><span style={{ fontSize: 10, color: "var(--fg-3)", marginLeft: 4 }}>漲</span></span>
                      <span><span className="mono tnum" style={{ fontSize: 22, fontWeight: 500, color: "var(--fg-2)" }}>{window.IUF_BREADTH.flat}</span><span style={{ fontSize: 10, color: "var(--fg-3)", marginLeft: 4 }}>平</span></span>
                      <span><span className="mono tnum" style={{ fontSize: 22, fontWeight: 500, color: "var(--ok)" }}>{window.IUF_BREADTH.down}</span><span style={{ fontSize: 10, color: "var(--fg-3)", marginLeft: 4 }}>跌</span></span>
                    </div>
                    <BreadthBar b={window.IUF_BREADTH} />
                    <div style={{ fontSize: 10, color: "var(--fg-3)", marginTop: 8 }} className="mono tnum">共 {window.IUF_BREADTH.total} 檔 · 跌 ▶ {((window.IUF_BREADTH.down / window.IUF_BREADTH.total) * 100).toFixed(1)}%</div>
                  </div>
                </div>

              <p style={{ margin: "14px 0 0", color: "var(--fg-2)", fontSize: 12, lineHeight: 1.6, maxWidth: 720, position: "relative", display: "none" }}>
                只呈現真實來源狀態。過期、空資料、登入失效、後端阻擋都會被標示出來。KGI 正式下單仍鎖在 <span className="mono" style={{ color: "var(--fg-1)", padding: "1px 4px", background: "var(--bg-2)", borderRadius: 2 }}>libCGCrypt.so</span> 之外。
              </p>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 0, marginTop: 28, borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)", position: "relative" }}>
                {[
                  { l: "可用來源", v: 5, sub: "共 8 / 過期 2 · 空 1", color: "var(--ok)" },
                  { l: "需處理",   v: 3, sub: "過期 + 空資料",      color: "var(--warn)" },
                  { l: "交易能力", t: "Paper",  sub: "預覽 + 風控,不下真實單", color: "var(--brand)" },
                  { l: "正式下單", t: "封鎖",   sub: "KGI / libCGCrypt.so",   color: "var(--bad)" },
                ].map((k, i) => (
                  <div key={i} style={{ padding: "20px 18px", borderRight: i < 3 ? "1px solid var(--line)" : "none", position: "relative" }}>
                    <div className="mono uppercase" style={{ fontSize: 10, color: "var(--fg-3)", marginBottom: 10 }}>{k.l}</div>
                    <div style={{ fontFamily: "var(--font-display)", fontSize: 36, fontWeight: 500, color: k.color, lineHeight: 1 }}>
                      {k.v != null ? <Counter value={k.v} /> : k.t}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--fg-3)", marginTop: 8 }}>{k.sub}</div>
                  </div>
                ))}
              </div>
              </div>
            </div>

            {/* 右 — 資料源狀態 */}
            <div className="panel tactical card-in" style={{ position: "relative", animationDelay: "120ms" }}>
              <CornerMarks />
              <div className="panel-h">
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span className="t">資料源狀態</span>
                  <span style={{ width: 6, height: 6, borderRadius: 3, background: "var(--ok)" }} className="blink"></span>
                  <span className="mono" style={{ fontSize: 10, color: "var(--fg-3)" }}>LIVE / 30s</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <PulseBars count={16} w={48} h={14} color="var(--ok)" />
                  <span className="mono" style={{ fontSize: 10, color: "var(--fg-3)" }}>8 SRC</span>
                </div>
              </div>
              <div>
                {D.sources.map((s, i) => (
                  <div key={s.key}
                       onMouseEnter={() => setHoverSrc(s.key)}
                       onMouseLeave={() => setHoverSrc(null)}
                       onClick={() => setDrawerSrc(s)}
                       style={{ display: "grid", gridTemplateColumns: "100px 1fr 56px 90px 90px", gap: 12, alignItems: "center", padding: "12px 16px", borderBottom: i < D.sources.length - 1 ? "1px solid var(--line)" : "none", cursor: "pointer", transition: "background 0.15s, transform 0.15s", background: hoverSrc === s.key ? "var(--bg-2)" : "transparent", transform: hoverSrc === s.key ? "translateX(2px)" : "none" }}>
                    <span className="mono" style={{ fontSize: 11, color: "var(--brand)", fontWeight: 600 }}>{s.name}</span>
                    <span style={{ fontSize: 12, color: "var(--fg-2)" }}>{s.desc}</span>
                    <Sparkline points={sourceSparks[s.key]} w={48} h={16} color={s.status === "live" ? "var(--ok)" : s.status === "stale" ? "var(--warn)" : "var(--fg-3)"} />
                    <span className="mono" style={{ fontSize: 10, color: "var(--fg-3)", textAlign: "right" }}>{s.updated}</span>
                    <div style={{ display: "flex", justifyContent: "flex-end" }}>
                      <StatusChip status={s.status} size="sm" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* 資料新鮮度時間軸 + 公司池 Heatmap */}
          <section style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1.4fr)", gap: 16, marginTop: 16 }}>
            <div className="panel tactical card-in" style={{ animationDelay: "180ms", position: "relative" }}>
              <CornerMarks />
              <div className="panel-h">
                <div>
                  <div className="t">資料新鮮度 · 時間軸</div>
                  <div className="s" style={{ marginTop: 6 }}>8 來源 vs 現在 · 對數刻度</div>
                </div>
                <span className="mono" style={{ fontSize: 10, color: "var(--fg-3)" }}>NOW · 20:51</span>
              </div>
              <FreshnessTimeline sources={D.sources} />
              <div style={{ padding: "12px 18px", borderTop: "1px solid var(--line)", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, fontSize: 11 }}>
                <div><span style={{ color: "var(--ok)" }}>● </span><span style={{ color: "var(--fg-2)" }}>5 新鮮</span></div>
                <div><span style={{ color: "var(--warn)" }}>● </span><span style={{ color: "var(--fg-2)" }}>2 過期</span></div>
                <div><span style={{ color: "var(--bad)" }}>● </span><span style={{ color: "var(--fg-2)" }}>1 無資料</span></div>
              </div>
            </div>

            <div className="panel tactical card-in" style={{ animationDelay: "220ms", position: "relative" }}>
              <CornerMarks />
              <div className="panel-h">
                <div>
                  <div className="t">台股公司池 · Heatmap</div>
                  <div className="s" style={{ marginTop: 6 }}>市值權重 × 漲跌幅 · 點擊進公司頁 · <span style={{ color: "var(--warn)" }}>市場資料 EMPTY · 示意</span></div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="mono" style={{ fontSize: 9, color: "var(--bad)" }}>▲ 漲 紅</span>
                  <span className="mono" style={{ fontSize: 9, color: "var(--ok)" }}>▼ 跌 綠</span>
                </div>
              </div>
              <div style={{ padding: 14 }}>
                {/* 真正的 treemap 比例:台積電獨佔左半 / 上排 4 大 / 下方 3 列每列 6-8 檔 */}
                <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr 1fr 1fr 1fr", gridTemplateRows: "76px 76px 64px 64px 64px", gap: 4 }}>
                  {/* 台積電 — 最大 (左 2 列) */}
                  <div style={{ gridColumn: "1 / 2", gridRow: "1 / 3" }}><HeatmapTile s={window.IUF_HEATMAP[0]} big /></div>
                  {/* 第 2-5 大 — 上排右半 */}
                  <div style={{ gridColumn: "2 / 3", gridRow: "1 / 3" }}><HeatmapTile s={window.IUF_HEATMAP[1]} big /></div>
                  <div style={{ gridColumn: "3 / 4", gridRow: "1 / 2" }}><HeatmapTile s={window.IUF_HEATMAP[2]} /></div>
                  <div style={{ gridColumn: "4 / 5", gridRow: "1 / 2" }}><HeatmapTile s={window.IUF_HEATMAP[3]} /></div>
                  <div style={{ gridColumn: "5 / 6", gridRow: "1 / 2" }}><HeatmapTile s={window.IUF_HEATMAP[4]} /></div>
                  <div style={{ gridColumn: "3 / 4", gridRow: "2 / 3" }}><HeatmapTile s={window.IUF_HEATMAP[5]} /></div>
                  <div style={{ gridColumn: "4 / 5", gridRow: "2 / 3" }}><HeatmapTile s={window.IUF_HEATMAP[6]} /></div>
                  <div style={{ gridColumn: "5 / 6", gridRow: "2 / 3" }}><HeatmapTile s={window.IUF_HEATMAP[7]} /></div>

                  {/* 下三列 — 每列 5 檔 */}
                  {window.IUF_HEATMAP.slice(8, 23).map((s, i) => (
                    <div key={s.sym + i}><HeatmapTile s={s} /></div>
                  ))}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--line)" }}>
                  <span className="mono" style={{ fontSize: 10, color: "var(--fg-3)" }}>顯示市值前 {Math.min(23, window.IUF_HEATMAP.length)} 檔 · 點擊進公司頁</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <span className="mono" style={{ fontSize: 9, color: "var(--ok)" }}>−2%</span>
                    <div style={{ display: "flex", height: 8, width: 120, borderRadius: 1, overflow: "hidden" }}>
                      {[0,1,2,3,4,5,6,7,8,9].map(i => {
                        const t = (i - 4.5) / 4.5;
                        const c = t < 0 ? `rgba(61,220,151,${0.25 + Math.abs(t) * 0.6})` : t > 0 ? `rgba(255,90,110,${0.25 + Math.abs(t) * 0.6})` : "rgba(138,150,168,0.2)";
                        return <div key={i} style={{ flex: 1, background: c }}></div>;
                      })}
                    </div>
                    <span className="mono" style={{ fontSize: 9, color: "var(--bad)" }}>+2%</span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* FinMind + OpenAlice */}
          <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16 }}>
            {/* FinMind */}
            <div className="panel tactical card-in" style={{ animationDelay: "240ms", position: "relative" }}>
              <CornerMarks />
              <div className="panel-h">
                <div>
                  <div className="t">FinMind · 資料健康</div>
                  <div className="s" style={{ marginTop: 6 }}>{D.finmind.sponsor} · 不顯示 token 值</div>
                </div>
                <StatusChip status="live" />
              </div>
              <div style={{ padding: 20 }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 22 }}>
                  <div>
                    <div className="mono uppercase" style={{ fontSize: 10, color: "var(--fg-3)", marginBottom: 8 }}>Token</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--ok)" }} className="blink"></span>
                      <span style={{ fontSize: 18, fontWeight: 600, color: "var(--fg-0)" }}>存在</span>
                    </div>
                    <div style={{ fontSize: 10, color: "var(--fg-3)", marginTop: 6 }}>只顯示 presence</div>
                  </div>
                  <div>
                    <div className="mono uppercase" style={{ fontSize: 10, color: "var(--fg-3)", marginBottom: 8 }}>Quota / 小時</div>
                    <div style={{ fontSize: 18, fontWeight: 600, color: "var(--fg-0)" }} className="mono">
                      <LiveCounter base={D.finmind.quotaUsed} jitter={2} interval={3000} /><span style={{ color: "var(--fg-3)" }}> / {D.finmind.quotaTotal.toLocaleString()}</span>
                    </div>
                    <div style={{ marginTop: 8 }}><ProgressBar value={D.finmind.quotaUsed} max={D.finmind.quotaTotal} color="var(--brand)" /></div>
                  </div>
                  <div>
                    <div className="mono uppercase" style={{ fontSize: 10, color: "var(--fg-3)", marginBottom: 8 }}>資料集</div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                      <span style={{ fontSize: 18, fontWeight: 600, color: "var(--ok)" }}><Counter value={D.finmind.datasets.ok} /></span>
                      <span className="mono" style={{ fontSize: 10, color: "var(--warn)" }}>降級 {D.finmind.datasets.downgraded}</span>
                      <span className="mono" style={{ fontSize: 10, color: "var(--fg-3)" }}>阻擋 {D.finmind.datasets.blocked}</span>
                    </div>
                    <div style={{ marginTop: 6 }}><PulseBars count={20} w={120} h={12} color="var(--ok)" /></div>
                  </div>
                  <div>
                    <div className="mono uppercase" style={{ fontSize: 10, color: "var(--fg-3)", marginBottom: 8 }}>最近請求</div>
                    <div className="mono" style={{ fontSize: 12, color: "var(--fg-0)", fontWeight: 600 }}>{D.finmind.recentRequest.name}</div>
                    <div className="mono" style={{ fontSize: 10, color: "var(--fg-3)", marginTop: 4 }}>{D.finmind.recentRequest.at}</div>
                  </div>
                </div>

                <div style={{ borderTop: "1px solid var(--line)", paddingTop: 14 }}>
                  <div className="mono uppercase" style={{ fontSize: 10, color: "var(--fg-3)", marginBottom: 10, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span>請求軌跡 · 最近 5 筆</span>
                    <span style={{ color: "var(--fg-4)" }}>ms · 反應時間</span>
                  </div>
                  {D.finmind.requests.map((r, i) => (
                    <div key={i} className="row-hover" style={{ display: "grid", gridTemplateColumns: "1fr 90px 60px 80px", gap: 10, alignItems: "center", padding: "8px 6px", borderBottom: i < 4 ? "1px solid var(--line)" : "none" }}>
                      <span className="mono" style={{ fontSize: 11, color: r.ok ? "var(--fg-1)" : "var(--warn)" }}>{r.name}</span>
                      <span className="mono" style={{ fontSize: 10, color: "var(--fg-3)" }}>{r.at}</span>
                      <span className="mono" style={{ fontSize: 10, color: r.ms > 1000 ? "var(--warn)" : "var(--fg-3)", textAlign: "right" }}>{r.ms}ms</span>
                      <span style={{ display: "flex", justifyContent: "flex-end" }}>
                        <span className={`chip ${r.ok ? "live" : "stale"}`} style={{ height: 18, fontSize: 9, padding: "0 6px" }}>
                          <span className="dot"></span>{r.ok ? "OK" : "降級"}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* OpenAlice */}
            <div className="panel tactical card-in" style={{ animationDelay: "300ms", position: "relative" }}>
              <CornerMarks />
              <div className="panel-h">
                <div>
                  <div className="t">OpenAlice · 每日簡報</div>
                  <div className="s" style={{ marginTop: 6 }}>來源追蹤與工作佇列 · {D.openalice.notice}</div>
                </div>
                <StatusChip status="review" />
              </div>
              <div style={{ padding: 20 }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 18 }}>
                  <div>
                    <div className="mono uppercase" style={{ fontSize: 10, color: "var(--fg-3)", marginBottom: 8 }}>Runner</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--ok)" }} className="blink"></span>
                      <span className="mono" style={{ fontSize: 14, fontWeight: 600, color: "var(--ok)" }}>healthy</span>
                    </div>
                    <div className="mono" style={{ fontSize: 10, color: "var(--fg-3)", marginTop: 4 }}>♥ {D.openalice.runnerHb}</div>
                  </div>
                  <div>
                    <div className="mono uppercase" style={{ fontSize: 10, color: "var(--fg-3)", marginBottom: 8 }}>Dispatcher</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--ok)" }} className="blink"></span>
                      <span className="mono" style={{ fontSize: 14, fontWeight: 600, color: "var(--ok)" }}>healthy</span>
                    </div>
                    <div className="mono" style={{ fontSize: 10, color: "var(--fg-3)", marginTop: 4 }}>掃描 {D.openalice.dispatcherScan}</div>
                  </div>
                  <div>
                    <div className="mono uppercase" style={{ fontSize: 10, color: "var(--fg-3)", marginBottom: 8 }}>Queue</div>
                    <div style={{ fontSize: 18, fontWeight: 600, color: "var(--fg-0)" }} className="mono">
                      <LiveCounter base={D.openalice.queue.queued} jitter={3} interval={2200} />
                    </div>
                    <div className="mono" style={{ fontSize: 10, color: "var(--fg-3)", marginTop: 4 }}>queued · running 0 · review 0</div>
                  </div>
                  <div>
                    <div className="mono uppercase" style={{ fontSize: 10, color: "var(--fg-3)", marginBottom: 8 }}>已發布簡報</div>
                    <div style={{ fontSize: 18, fontWeight: 600, color: "var(--warn)" }} className="mono"><Counter value={D.openalice.publishedToday} /></div>
                    <div className="mono" style={{ fontSize: 10, color: "var(--fg-3)", marginTop: 4 }}>今日 · 不當作投資建議</div>
                  </div>
                </div>

                <div className="mono uppercase" style={{ fontSize: 10, color: "var(--fg-3)", marginBottom: 10 }}>Pipeline · source trail</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8 }}>
                  {D.openalice.pipeline.map((p, i) => {
                    const colors = { ok: "var(--ok)", warn: "var(--warn)", wait: "var(--info)", idle: "var(--fg-3)" };
                    const c = colors[p.state];
                    return (
                      <div key={p.id} style={{ background: "var(--bg-2)", border: `1px solid var(--line)`, borderTop: `2px solid ${c}`, padding: 10, position: "relative", transition: "transform 0.2s" }}
                           onMouseEnter={e => e.currentTarget.style.transform = "translateY(-2px)"}
                           onMouseLeave={e => e.currentTarget.style.transform = "none"}>
                        <div className="mono" style={{ fontSize: 9, color: "var(--fg-3)", marginBottom: 4, display: "flex", justifyContent: "space-between" }}>
                          <span>{String(p.id).padStart(2, "0")}</span>
                          <span style={{ width: 4, height: 4, borderRadius: "50%", background: c }}></span>
                        </div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--fg-0)", marginBottom: 6 }}>{p.name}</div>
                        <div style={{ fontSize: 10, color: "var(--fg-3)", lineHeight: 1.4 }}>{p.note}</div>
                      </div>
                    );
                  })}
                </div>

                <div style={{ marginTop: 14, padding: 10, background: "var(--warn-bg)", border: "1px solid var(--warn-line)", borderRadius: 4, fontSize: 11, color: "var(--warn)", display: "flex", alignItems: "center", gap: 10 }}>
                  <span className="mono" style={{ fontSize: 10, padding: "1px 6px", background: "var(--warn)", color: "#1a0f00", borderRadius: 2, fontWeight: 700 }}>MISSING_SOURCE</span>
                  source trail 不完整:{D.openalice.sourceTrail.missing.join(" · ")}
                </div>
              </div>
            </div>
          </section>

          {/* Paper E2E + 策略候選 */}
          <section style={{ display: "grid", gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1fr)", gap: 16, marginTop: 16 }}>
            <div className="panel tactical card-in" style={{ animationDelay: "360ms", position: "relative" }}>
              <CornerMarks />
              <div className="panel-h">
                <div>
                  <div className="t">Paper E2E · 紙上交易流程</div>
                  <div className="s" style={{ marginTop: 6 }}>preview / risk / draft / submit / fill / audit · 不連真實券商</div>
                </div>
                <span className="chip live"><span className="dot"></span>Paper · 預覽模式</span>
              </div>
              <div style={{ padding: 20 }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 0, position: "relative" }}>
                  {D.paperE2E.map((p, i) => {
                    const colors = { ok: "var(--ok)", wait: "var(--info)", idle: "var(--fg-3)", warn: "var(--warn)" };
                    const c = colors[p.state];
                    return (
                      <div key={p.id} style={{ position: "relative", padding: "0 8px", borderRight: i < 5 ? "1px solid var(--line)" : "none" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
                          <div style={{ width: 24, height: 24, borderRadius: "50%", border: `1.5px solid ${c}`, color: c, display: "grid", placeItems: "center", fontSize: 10, fontWeight: 700, background: "var(--bg-1)" }} className="mono">{p.id}</div>
                          <div style={{ flex: 1, height: 1, background: i < 5 ? `linear-gradient(to right, ${c}66, var(--line))` : "transparent" }}></div>
                        </div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--fg-0)" }}>{p.name}</div>
                        <div style={{ fontSize: 11, color: "var(--fg-3)", marginTop: 2 }}>{p.desc}</div>
                        <div style={{ marginTop: 12 }}>
                          <div style={{ fontFamily: "var(--font-display)", fontSize: 24, fontWeight: 500, color: c, lineHeight: 1 }}>
                            <Counter value={p.count} />
                          </div>
                          <div className="mono" style={{ fontSize: 10, color: "var(--fg-3)", marginTop: 8, lineHeight: 1.4 }}>{p.note}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginTop: 22, paddingTop: 18, borderTop: "1px solid var(--line)" }}>
                  <div style={{ padding: 12, background: "var(--bg-2)", borderRadius: 6, position: "relative", overflow: "hidden" }}>
                    <div style={{ position: "absolute", top: 0, right: 0, bottom: 0, width: 60, opacity: 0.4 }}>
                      <Sparkline points={portfolioSpark} w={60} h={48} color="var(--ok)" />
                    </div>
                    <div className="mono uppercase" style={{ fontSize: 10, color: "var(--fg-3)", marginBottom: 6, position: "relative" }}>Portfolio · 預覽</div>
                    <div style={{ fontSize: 16, fontWeight: 600, color: "var(--fg-0)", position: "relative" }} className="mono">NT$ <Counter value={D.portfolio.cash} /></div>
                    <div style={{ fontSize: 10, color: "var(--fg-3)", marginTop: 4, position: "relative" }}>現金 · 部位 0 · {D.portfolio.note}</div>
                  </div>
                  <div style={{ padding: 12, background: "var(--bg-2)", borderRadius: 6 }}>
                    <div className="mono uppercase" style={{ fontSize: 10, color: "var(--fg-3)", marginBottom: 6 }}>單位提示</div>
                    <div style={{ fontSize: 12, color: "var(--fg-1)", lineHeight: 1.5 }}>1 張 = <span className="mono" style={{ color: "var(--brand)" }}>1,000 股</span> · 零股最小 1 股</div>
                    <div style={{ fontSize: 10, color: "var(--fg-3)", marginTop: 4 }}>系統明確標示 lot / odd-lot,不混用</div>
                  </div>
                  <div style={{ padding: 12, background: "var(--bg-2)", borderRadius: 6, border: "1px dashed var(--bad-line)", position: "relative" }}>
                    <div className="mono uppercase" style={{ fontSize: 10, color: "var(--bad)", marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--bad)" }} className="blink"></span>
                      正式下單 BLOCKED
                    </div>
                    <div style={{ fontSize: 12, color: "var(--fg-1)", lineHeight: 1.5 }}>{D.meta.formalOrder.reason}</div>
                  </div>
                </div>
              </div>
            </div>

            {/* 策略候選 */}
            <div className="panel tactical card-in" style={{ animationDelay: "420ms", position: "relative" }}>
              <CornerMarks />
              <div className="panel-h">
                <div>
                  <div className="t">策略候選 · 不等於下單建議</div>
                  <div className="s" style={{ marginTop: 6 }}>因訊號證據過期,全部閘門關閉</div>
                </div>
                <StatusChip status="blocked" size="sm" />
              </div>
              <div>
                <div style={{ display: "grid", gridTemplateColumns: "70px 1fr 60px 70px 80px", gap: 8, padding: "10px 16px", borderBottom: "1px solid var(--line)", background: "var(--bg-2)" }}>
                  {["代號", "名稱", "立場", "信心", "閘門"].map(h => <div key={h} className="mono uppercase" style={{ fontSize: 9, color: "var(--fg-3)" }}>{h}</div>)}
                </div>
                {D.strategyIdeas.map((s, i) => (
                  <div key={i} className="row-hover" style={{ display: "grid", gridTemplateColumns: "70px 1fr 60px 70px 80px", gap: 8, padding: "12px 16px", borderBottom: i < D.strategyIdeas.length - 1 ? "1px solid var(--line)" : "none", alignItems: "center", cursor: "pointer" }}>
                    <span className="mono" style={{ fontSize: 12, color: "var(--brand)", fontWeight: 600 }}>{s.sym}</span>
                    <span style={{ fontSize: 13, color: "var(--fg-0)" }}>{s.name}</span>
                    <span className="mono" style={{ fontSize: 11, color: "var(--fg-2)" }}>{s.stance}</span>
                    <span className="mono" style={{ fontSize: 12, color: "var(--fg-1)" }}>{s.confidence.toFixed(1)}</span>
                    <StatusChip status="blocked" size="sm" />
                  </div>
                ))}
                <div style={{ padding: "12px 16px", fontSize: 11, color: "var(--fg-3)", borderTop: "1px solid var(--line)", lineHeight: 1.6 }}>
                  立場僅為候選研究,不出現買進/賣出/目標價/獲利保證。
                </div>
              </div>
            </div>
          </section>

          {/* 工作流 + 待處理 */}
          <section style={{ display: "grid", gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1fr)", gap: 16, marginTop: 16 }}>
            <div className="panel tactical card-in" style={{ animationDelay: "480ms", position: "relative" }}>
              <CornerMarks />
              <div className="panel-h">
                <div>
                  <div className="t">今日交易工作流 · 動線</div>
                  <div className="s" style={{ marginTop: 6 }}>能推進的清楚標 ok,不能推進的會說明原因與下一步</div>
                </div>
                <span className="mono" style={{ fontSize: 11, color: "var(--fg-3)" }}>5 步驟</span>
              </div>
              <div style={{ padding: "8px 8px 16px" }}>
                {D.workflow.map((w, i) => {
                  const ok = w.state === "ok";
                  return (
                    <a key={w.id} href={w.href} className="row-hover" style={{ display: "grid", gridTemplateColumns: "32px 1fr auto auto", gap: 14, alignItems: "center", padding: "14px 16px", borderRadius: 6, textDecoration: "none", cursor: "pointer" }}>
                      <div style={{ width: 28, height: 28, borderRadius: 4, background: ok ? "rgba(61,220,151,0.12)" : "rgba(95,168,255,0.12)", color: ok ? "var(--ok)" : "var(--info)", display: "grid", placeItems: "center", fontSize: 12, fontWeight: 700, position: "relative" }} className="mono">
                        {i + 1}
                        {ok && <span style={{ position: "absolute", inset: -2, border: `1px solid ${ok ? "var(--ok)" : "var(--info)"}`, borderRadius: 4, opacity: 0.3 }}></span>}
                      </div>
                      <div>
                        <div style={{ fontSize: 14, color: "var(--fg-0)", fontWeight: 500 }}>{w.title}</div>
                        <div style={{ fontSize: 11, color: "var(--fg-3)", marginTop: 2 }}>{w.desc}</div>
                      </div>
                      <StatusChip status={ok ? "live" : "wait"} size="sm" />
                      <span className="mono" style={{ fontSize: 11, color: "var(--brand)" }}>{w.cta} ›</span>
                    </a>
                  );
                })}
              </div>
            </div>

            <div className="panel tactical card-in" style={{ animationDelay: "540ms", position: "relative" }}>
              <CornerMarks />
              <div className="panel-h">
                <div>
                  <div className="t">待處理 / 尚未可用</div>
                  <div className="s" style={{ marginTop: 6 }}>不假裝 live · 標示原因與下一步</div>
                </div>
                <span className="mono" style={{ fontSize: 11, color: "var(--bad)" }}>{D.blocked.length} 項</span>
              </div>
              <div>
                {D.blocked.map((b, i) => (
                  <div key={i} className="row-hover" style={{ padding: "14px 16px", borderBottom: i < D.blocked.length - 1 ? "1px solid var(--line)" : "none" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                      <span style={{ fontSize: 13, color: "var(--fg-0)", fontWeight: 600 }}>{b.name}</span>
                      <StatusChip status={b.icon === "lock" ? "blocked" : "stale"} size="sm" />
                    </div>
                    <div style={{ fontSize: 11, color: "var(--fg-2)", lineHeight: 1.6, marginBottom: 4 }}>原因 · {b.why}</div>
                    <div className="mono" style={{ fontSize: 10, color: "var(--fg-3)" }}>下一步 · {b.next}</div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

window.DirectionAV3 = DirectionAV3;
