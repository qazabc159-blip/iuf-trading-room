/**
 * ContLiqHistoricalEvidencePanel — cont_liq v36 歷史研究證據（B 區）
 *
 * 純靜態 server component — 不 poll KGI，不呼叫 FinMind。
 * 數字來源：Codex v46 verbatim（2026-05-12 升級指令）
 *
 * B.1 策略原始證據窗（22 months）:
 *   - 觀察窗：2024-05 → 2026-03
 *   - cont_liq net absolute return after cost: +759.87%
 *
 * B.2 共同窗比較（11 months）:
 *   - 共同窗：2025-04-10 → 2026-03-06
 *   - cont_liq common-window: +400.89%
 *   - 0050 same-window: +95.25%
 *   - 超額: +305.64pp
 *
 * HARD LINES:
 *   - 不使用「合計絕對回報」單一數字混用兩窗數據 — 3 欄分顯示 (see Codex v46 instruction)
 *   - 不使用任何背書性正面用語 (formally-endorsed / alpha-confirmed / live-ready / 實單跟倉)
 *   - 禁止混用 evidence-window 與 common-window 數字於同一段
 *   - MUST 標明 "not same-window comparison" + "not forward-observation result" + "not a trade recommendation"
 *   - 數字來源 hardcode — 後續 Jason P2 v46 endpoint ship 後再 swap
 */

// ── Types ─────────────────────────────────────────────────────────────────────

interface EvidenceNumbers {
  // B.1 — 22mo evidence window
  evidenceWindowStart: string;
  evidenceWindowEnd: string;
  evidenceWindowMonths: number;
  netAbsoluteReturnPct: string; // verbatim "+759.87%"

  // B.2 — 11mo common window
  commonWindowStart: string;
  commonWindowEnd: string;
  commonWindowMonths: number;
  contLiqCommonPct: string;   // verbatim "+400.89%"
  bench0050CommonPct: string; // verbatim "+95.25%"
  excessPp: string;            // verbatim "+305.64pp"

  // Data source
  dataSource: string;
}

// ── Constants — Codex v46 verbatim ───────────────────────────────────────────

const EVIDENCE: EvidenceNumbers = {
  // B.1 — evidence window (22 months)
  evidenceWindowStart: "2024-05",
  evidenceWindowEnd: "2026-03",
  evidenceWindowMonths: 22,
  netAbsoluteReturnPct: "+759.87%",

  // B.2 — common window (11 months)
  commonWindowStart: "2025-04-10",
  commonWindowEnd: "2026-03-06",
  commonWindowMonths: 11,
  contLiqCommonPct: "+400.89%",
  bench0050CommonPct: "+95.25%",
  excessPp: "+305.64pp",

  // Source attribution
  dataSource: "Codex v46 backtest output (2026-05-12); 後續 Jason P2 v46 endpoint ship 後 swap",
};

// ── CSS ───────────────────────────────────────────────────────────────────────

const HIST_CSS = `
._clh-section-divider {
  margin: 32px 0 24px;
  border: none;
  border-top: 1px solid rgba(255,255,255,0.07);
  position: relative;
}
._clh-section-label {
  font-family: var(--mono, monospace);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 1.4px;
  text-transform: uppercase;
  color: #444;
  margin-bottom: 20px;
}
._clh-zone-banner {
  padding: 12px 16px;
  margin-bottom: 14px;
  background: rgba(11,16,23,0.82);
  border-left: 3px solid rgba(255,255,255,0.18);
  border-top: 1px solid rgba(255,255,255,0.07);
  border-right: 1px solid rgba(255,255,255,0.07);
  border-bottom: 1px solid rgba(255,255,255,0.07);
  border-radius: 4px;
  font-family: var(--mono, monospace);
  font-size: 11px;
  color: #666;
  line-height: 1.7;
}
._clh-zone-banner strong {
  color: #aaa;
  font-weight: 700;
}
._clh-zone-banner .caveat-tag {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 6px;
  border: 1px solid rgba(255,255,255,0.14);
  border-radius: 3px;
  font-size: 9px;
  font-weight: 700;
  color: #555;
  letter-spacing: 0.5px;
  text-transform: uppercase;
}
._clh-b1-card {
  padding: 20px 22px;
  margin-bottom: 16px;
  background: rgba(11,16,23,0.92);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 6px;
  font-family: var(--mono, monospace);
}
._clh-b1-eyebrow {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 1.2px;
  text-transform: uppercase;
  color: #555;
  margin-bottom: 8px;
}
._clh-b1-window-label {
  font-size: 12px;
  color: #666;
  margin-bottom: 14px;
}
._clh-b1-return-row {
  display: flex;
  align-items: baseline;
  gap: 14px;
  margin-bottom: 10px;
}
._clh-b1-return-label {
  font-size: 11px;
  color: #555;
  min-width: 220px;
}
._clh-b1-return-value {
  font-size: 36px;
  font-weight: 850;
  color: #ef5350;
  font-variant-numeric: tabular-nums;
  line-height: 1.0;
  letter-spacing: -1px;
}
._clh-b1-caveats {
  font-size: 10px;
  color: #444;
  line-height: 1.8;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid rgba(255,255,255,0.05);
}
._clh-b1-caveats span.not-tag {
  display: inline-block;
  padding: 1px 7px;
  border: 1px solid rgba(255,100,100,0.2);
  border-radius: 3px;
  background: rgba(255,80,80,0.06);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.5px;
  color: #a04040;
  text-transform: uppercase;
  margin-right: 4px;
}
._clh-b2-card {
  padding: 20px 22px;
  margin-bottom: 16px;
  background: rgba(11,16,23,0.92);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 6px;
  font-family: var(--mono, monospace);
}
._clh-b2-eyebrow {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 1.2px;
  text-transform: uppercase;
  color: #555;
  margin-bottom: 8px;
}
._clh-b2-window-label {
  font-size: 12px;
  color: #666;
  margin-bottom: 16px;
}
._clh-b2-columns {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1px;
  background: rgba(255,255,255,0.06);
  border-radius: 6px;
  overflow: hidden;
  margin-bottom: 14px;
}
._clh-b2-col {
  padding: 16px 18px;
  background: rgba(11,16,23,0.96);
}
._clh-b2-col-label {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.8px;
  text-transform: uppercase;
  color: #444;
  margin-bottom: 8px;
  line-height: 1.4;
}
._clh-b2-col-value {
  font-size: 28px;
  font-weight: 850;
  font-variant-numeric: tabular-nums;
  line-height: 1.0;
  letter-spacing: -0.5px;
  margin-bottom: 6px;
}
._clh-b2-col-value.strategy-ret { color: #ef5350; }
._clh-b2-col-value.bench-ret    { color: #c8c8c8; }
._clh-b2-col-value.excess-ret   { color: #ffb800; }
._clh-b2-col-sub {
  font-size: 9px;
  color: #444;
  line-height: 1.4;
}
._clh-b2-caveats {
  font-size: 10px;
  color: #444;
  line-height: 1.8;
  margin-top: 6px;
  padding-top: 10px;
  border-top: 1px solid rgba(255,255,255,0.05);
}
._clh-b2-caveats span.not-tag {
  display: inline-block;
  padding: 1px 7px;
  border: 1px solid rgba(255,100,100,0.2);
  border-radius: 3px;
  background: rgba(255,80,80,0.06);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.5px;
  color: #a04040;
  text-transform: uppercase;
  margin-right: 4px;
}
._clh-source-note {
  font-family: var(--mono, monospace);
  font-size: 10px;
  color: #333;
  text-align: right;
  margin-top: 8px;
  line-height: 1.6;
}
@media (max-width: 640px) {
  ._clh-b2-columns { grid-template-columns: 1fr; }
  ._clh-b1-return-value { font-size: 26px; }
  ._clh-b2-col-value { font-size: 22px; }
  ._clh-b1-return-row { flex-direction: column; gap: 4px; }
}
`;

// ── Component ─────────────────────────────────────────────────────────────────

export function ContLiqHistoricalEvidencePanel() {
  const ev = EVIDENCE;

  return (
    <section aria-label="歷史研究證據 B 區">
      <style>{HIST_CSS}</style>

      {/* Section divider — clearly separates A zone from B zone */}
      <hr className="_clh-section-divider" />
      <div className="_clh-section-label">B 區 — 歷史研究證據 / Historical Research Evidence</div>

      {/* ── B.1 策略原始證據窗（22 months）─────────────────────────────────── */}

      {/* B.1 zone banner */}
      <div className="_clh-zone-banner">
        <strong>B.1 策略原始證據窗</strong>
        <span className="caveat-tag">not same-window comparison</span>
        <span className="caveat-tag">not forward-observation result</span>
        <span className="caveat-tag">not a trade recommendation</span>
        <br />
        觀察窗完整跨度（{ev.evidenceWindowStart} → {ev.evidenceWindowEnd}，{ev.evidenceWindowMonths} months）。
        此為策略在完整可用歷史資料段的絕對報酬，與 B.2 共同窗 <strong>非同一窗口</strong>，不可直接比較。
      </div>

      {/* B.1 data card */}
      <div className="_clh-b1-card">
        <div className="_clh-b1-eyebrow">Evidence Window — 22-Month Net Absolute Return After Cost</div>
        <div className="_clh-b1-window-label">
          觀察窗：{ev.evidenceWindowStart} → {ev.evidenceWindowEnd}（{ev.evidenceWindowMonths} 個月）
        </div>
        <div className="_clh-b1-return-row">
          <span className="_clh-b1-return-label">cont_liq 策略<br />淨絕對報酬（含成本後）</span>
          <span className="_clh-b1-return-value">{ev.netAbsoluteReturnPct}</span>
        </div>
        <div className="_clh-b1-caveats">
          <span className="not-tag">not a trade recommendation</span>
          此數字為策略在歷史研究窗口的絕對報酬，不代表 Forward Observation Period 1 的預期結果，
          亦不代表可重現的未來績效。此為 legacy 歷史紀錄，供研究追蹤用。
          <br />
          <span className="not-tag">not same-window comparison</span>
          B.1 觀察窗（22 months）與 B.2 共同窗（11 months）起迄不同，兩段數字不可直接疊加或比較。
          <br />
          <span className="not-tag">not forward-observation result</span>
          Period 1 前向觀察（Day-0: 2026-05-06）與本段歷史結果無關；H20 成熟前不作結論。
        </div>
      </div>

      {/* ── B.2 共同窗比較（11 months）──────────────────────────────────────── */}

      {/* B.2 zone banner */}
      <div className="_clh-zone-banner">
        <strong>B.2 共同窗比較（Same-Window vs 0050）</strong>
        <span className="caveat-tag">not a trade recommendation</span>
        <br />
        共同窗：{ev.commonWindowStart} → {ev.commonWindowEnd}（{ev.commonWindowMonths} months）。
        策略與 0050 在相同觀察窗口的絕對報酬對比。不代表前向觀察結果，不代表未來績效。
      </div>

      {/* B.2 3-column card */}
      <div className="_clh-b2-card">
        <div className="_clh-b2-eyebrow">Common-Window Comparison — 11-Month Same-Window vs 0050</div>
        <div className="_clh-b2-window-label">
          共同觀察窗：{ev.commonWindowStart} → {ev.commonWindowEnd}（{ev.commonWindowMonths} 個月）
        </div>

        <div className="_clh-b2-columns">
          {/* Col 1 — 策略絕對報酬 */}
          <div className="_clh-b2-col">
            <div className="_clh-b2-col-label">
              策略絕對報酬<br />cont_liq common-window
            </div>
            <div className="_clh-b2-col-value strategy-ret">{ev.contLiqCommonPct}</div>
            <div className="_clh-b2-col-sub">
              {ev.commonWindowStart} → {ev.commonWindowEnd}<br />
              同窗絕對報酬
            </div>
          </div>

          {/* Col 2 — 0050 同窗報酬 */}
          <div className="_clh-b2-col">
            <div className="_clh-b2-col-label">
              0050 同窗報酬<br />benchmark same-window
            </div>
            <div className="_clh-b2-col-value bench-ret">{ev.bench0050CommonPct}</div>
            <div className="_clh-b2-col-sub">
              {ev.commonWindowStart} → {ev.commonWindowEnd}<br />
              0050 ETF 同期報酬
            </div>
          </div>

          {/* Col 3 — 超額報酬 */}
          <div className="_clh-b2-col">
            <div className="_clh-b2-col-label">
              超額報酬 vs 0050<br />excess return (pp)
            </div>
            <div className="_clh-b2-col-value excess-ret">{ev.excessPp}</div>
            <div className="_clh-b2-col-sub">
              策略絕對報酬 − 0050 同窗報酬<br />
              共同窗口超額（百分點）
            </div>
          </div>
        </div>

        <div className="_clh-b2-caveats">
          <span className="not-tag">not a trade recommendation</span>
          共同窗比較為歷史研究數字，不代表策略已完成驗證、或已通過任何正式背書（formally endorsed）流程。
          <br />
          <span className="not-tag">not forward-observation result</span>
          Period 1 前向觀察仍在進行中，H20 到期前不以此為結論依據。
          <br />
          B.2 共同窗（11 months）與 B.1 證據窗（22 months）為不同時段，數字不可混用。
        </div>
      </div>

      {/* Data source attribution */}
      <div className="_clh-source-note">
        數據來源：{ev.dataSource}
      </div>
    </section>
  );
}
