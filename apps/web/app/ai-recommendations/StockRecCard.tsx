"use client";

export type BucketLabel = "A+" | "A" | "B" | "C";

export interface SubScores {
  theme_position?: number | null;
  revenue_earnings?: number | null;
  institutional_etf?: number | null;
  margin_short?: number | null;
  rs_volume?: number | null;
  technical_structure?: number | null;
  valuation_event?: number | null;
  total?: number | null;
}

export interface EntryZone {
  ote_low?: number | null;
  ote_high?: number | null;
  label?: string | null;
}

export interface PriceTarget {
  tp1?: number | null;
  tp2?: number | null;
  sl?: number | null;
  r_value?: number | null;
}

export interface SourceStateSummary {
  label: string;
  state: string;
  detail?: string | null;
  owner?: string | null;
  nextAction?: string | null;
  lastUpdated?: string | null;
}

export interface SynthesisFlags {
  fullAiReportParsed?: boolean | null;
  synthesisRetryUsed?: boolean | null;
  synthesisFallbackUsed?: boolean | null;
  usedFallback?: boolean | null;
}

export interface StockRecCardData {
  ticker: string;
  company_name?: string | null;
  bucket: BucketLabel;
  confidence?: number | null;
  sub_scores?: SubScores | null;
  entry?: EntryZone | null;
  targets?: PriceTarget | null;
  why_buy?: string | null;
  why_not_buy?: string | null;
  risk?: string | null;
  source?: string | null;
  sourceTrail?: string | null;
  sourceState?: SourceStateSummary | null;
  officialAnnouncementSourceState?: SourceStateSummary | null;
  synthesisFlags?: SynthesisFlags | null;
  market_multiplier?: number | null;
}

const SUB_SCORE_ROWS: Array<{
  key: keyof SubScores;
  label: string;
  max: number;
}> = [
  { key: "theme_position", label: "題材", max: 20 },
  { key: "revenue_earnings", label: "營收", max: 15 },
  { key: "institutional_etf", label: "法人/ETF", max: 15 },
  { key: "margin_short", label: "籌碼", max: 15 },
  { key: "rs_volume", label: "RS/量", max: 10 },
  { key: "technical_structure", label: "技術", max: 20 },
  { key: "valuation_event", label: "估值/事件", max: 5 },
  { key: "total", label: "總分", max: 100 },
];

const BUCKET_CONFIG: Record<BucketLabel, { tone: "ok" | "warn" | "bad"; nav_pct: string; max_nav: string }> = {
  "A+": { tone: "ok", nav_pct: "0.8%", max_nav: "12%" },
  A: { tone: "ok", nav_pct: "0.6%", max_nav: "8%" },
  B: { tone: "warn", nav_pct: "0.4%", max_nav: "5%" },
  C: { tone: "bad", nav_pct: "0", max_nav: "0" },
};

function fmtScore(val: number | null | undefined, max: number): string {
  if (val == null) return "-";
  return `${val}/${max}`;
}

function fmtPrice(val: number | null | undefined): string {
  if (val == null) return "-";
  return val.toLocaleString("zh-TW", { maximumFractionDigits: 2 });
}

function fmtConfidence(val: number | null | undefined): string {
  if (val == null) return "-";
  return `${Math.round(val * 100)}%`;
}

function fmtRValue(val: number | null | undefined): string {
  if (val == null) return "-";
  return `${val.toFixed(2)}R`;
}

function SimpleMarkdown({ text }: { text: string }) {
  const lines = text.split("\n").filter((line) => line.trim().length > 0);
  return (
    <>
      {lines.map((line, index) => (
        <p key={`${index}-${line.slice(0, 24)}`} className="_src-p">
          {line.replace(/^[-*]\s*/, "")}
        </p>
      ))}
    </>
  );
}

function displaySource(source: string | null | undefined): string {
  const raw = source?.trim();
  if (!raw) return "AI 推薦引擎";
  if (raw.toLowerCase().includes("brain_react")) return "AI 推薦引擎";
  return raw;
}

function uniqueParts(parts: string[]) {
  return Array.from(new Set(parts));
}

export function displaySourceTrail(sourceTrail: string | null | undefined): string {
  const raw = sourceTrail?.trim();
  if (!raw || raw.toLowerCase().includes("sourcetrail")) {
    return "資料路徑尚未完整回傳";
  }

  const normalized = raw.toLowerCase();
  const parts: string[] = [];

  if (normalized.includes("recommendation_source=brain_react")) {
    parts.push("推薦來源：AI 推薦引擎");
  } else if (normalized.includes("recommendation_source=")) {
    parts.push("推薦來源：推薦資料庫");
  }

  if (normalized.includes("run(") || normalized.includes("ai_recommendations_runs")) {
    parts.push("推薦批次：已讀取今日推薦結果");
  }

  if (normalized.includes("official_announcements")) {
    if (normalized.includes("state=live")) {
      parts.push("官方公告：已納入重大訊息狀態");
    } else if (normalized.includes("state=empty")) {
      parts.push("官方公告：目前無可用新公告");
    } else {
      parts.push("官方公告：資料狀態待確認");
    }
  }

  if (
    normalized.includes("technical(")
    || normalized.includes("finmind_ohlcv")
    || normalized.includes("get_company_technical")
    || normalized.includes("lastprice")
  ) {
    parts.push("技術/量價：已納入報價與 K 線資料");
  }

  if (normalized.includes("get_news_top10") || normalized.includes("news")) {
    parts.push("新聞/題材：已納入市場新聞資料");
  }

  if (parts.length === 0) return raw;
  return uniqueParts(parts).join("；");
}

export function StockRecCard({ rec }: { rec: StockRecCardData }) {
  const bucket = BUCKET_CONFIG[rec.bucket];
  const scores = rec.sub_scores ?? {};
  const entry = rec.entry;
  const targets = rec.targets;
  const flags = rec.synthesisFlags ?? {};
  const entryLabel = entry?.label
    ?? (entry?.ote_low != null && entry?.ote_high != null
      ? `建議進場區間 ${fmtPrice(entry.ote_low)} - ${fmtPrice(entry.ote_high)}`
      : "後端未回傳建議進場區間");
  const sourceTrail = displaySourceTrail(rec.sourceTrail);
  const riskText = rec.risk || rec.why_not_buy || "後端未回傳主要風險";

  return (
    <>
      <style>{`
        ._src-card {
          display: grid;
          gap: 14px;
          min-width: 0;
          overflow: hidden;
          border: 1px solid rgba(220, 228, 240, 0.1);
          border-left: 3px solid rgba(200, 148, 63, 0.78);
          border-radius: 8px;
          padding: 16px;
          background:
            linear-gradient(135deg, rgba(200, 148, 63, 0.055), transparent 42%),
            rgba(4, 8, 13, 0.42);
        }
        ._src-card[data-bucket="C"] { border-left-color: rgba(230, 57, 70, 0.68); }
        ._src-card[data-bucket="A+"] { border-left-color: rgba(46, 204, 113, 0.68); }
        ._src-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 10px;
        }
        ._src-ticker {
          color: var(--tac-brand, #c8943f);
          font: 900 13px/1 var(--mono, monospace);
          margin-right: 7px;
        }
        ._src-name {
          margin: 5px 0 0;
          color: var(--tac-fg-0, #e8edf5);
          font: 850 18px/1.25 var(--sans-tc, sans-serif);
        }
        ._src-badges, ._src-flag-grid {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }
        ._src-badge {
          min-height: 24px;
          display: inline-flex;
          align-items: center;
          gap: 5px;
          border: 1px solid var(--tac-line, rgba(220,228,240,0.14));
          border-radius: 5px;
          padding: 0 8px;
          color: var(--tac-fg-2, #aab5c5);
          background: rgba(8, 11, 16, 0.5);
          font: 800 10px/1 var(--sans-tc, sans-serif);
          white-space: nowrap;
        }
        ._src-badge[data-tone="ok"],
        ._src-source-state[data-tone="ok"] span {
          color: var(--tac-ok, #2ecc71);
          border-color: rgba(46, 204, 113, 0.34);
          background: rgba(46, 204, 113, 0.06);
        }
        ._src-badge[data-tone="warn"],
        ._src-source-state[data-tone="warn"] span {
          color: var(--tac-warn, #c8943f);
          border-color: rgba(200, 148, 63, 0.34);
          background: rgba(200, 148, 63, 0.06);
        }
        ._src-badge[data-tone="bad"],
        ._src-source-state[data-tone="bad"] span {
          color: var(--tac-bad, #e63946);
          border-color: rgba(230, 57, 70, 0.34);
          background: rgba(230, 57, 70, 0.06);
        }
        ._src-score-table {
          width: 100%;
          table-layout: fixed;
          border-collapse: collapse;
          font: 800 11px/1 var(--mono, monospace);
        }
        ._src-score-table th {
          padding: 5px 6px;
          color: var(--tac-brand, #c8943f);
          text-align: center;
          font-size: 10px;
          border-bottom: 1px solid var(--tac-line, rgba(220,228,240,0.14));
          line-height: 1.35;
          overflow-wrap: anywhere;
          white-space: normal;
        }
        ._src-score-table td {
          padding: 6px;
          text-align: center;
          color: var(--tac-fg-0, #e8edf5);
          font-size: 12px;
          border-bottom: 1px solid rgba(220,228,240,0.06);
          overflow-wrap: anywhere;
        }
        ._src-score-table tr:last-child td {
          color: var(--tac-brand, #c8943f);
          font-weight: 900;
          border-bottom: none;
        }
        ._src-entry, ._src-reasoning, ._src-source, ._src-sizing {
          border-top: 1px solid var(--tac-line, rgba(220,228,240,0.14));
          padding-top: 10px;
        }
        ._src-entry {
          display: grid;
          gap: 4px;
        }
        ._src-entry-label, ._src-reasoning-head, ._src-source-head {
          color: var(--tac-brand, #c8943f);
          font: 900 10px/1 var(--mono, monospace);
        }
        ._src-entry-val {
          color: var(--tac-fg-0, #e8edf5);
          font: 850 13px/1.4 var(--mono, monospace);
        }
        ._src-targets {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 8px;
          border-top: 1px solid var(--tac-line, rgba(220,228,240,0.14));
          padding-top: 10px;
        }
        ._src-target-cell {
          display: grid;
          gap: 4px;
          border: 1px solid var(--tac-line, rgba(220,228,240,0.14));
          border-radius: 6px;
          padding: 8px;
          background: rgba(8, 11, 16, 0.3);
        }
        ._src-target-cell b {
          color: var(--tac-brand, #c8943f);
          font: 900 10px/1 var(--mono, monospace);
        }
        ._src-target-cell span {
          color: var(--tac-fg-0, #e8edf5);
          font: 900 13px/1 var(--mono, monospace);
        }
        ._src-reasoning, ._src-source {
          display: grid;
          gap: 10px;
        }
        ._src-p, ._src-source p {
          margin: 4px 0 0;
          color: var(--tac-fg-2, #aab5c5);
          font-size: 12px;
          line-height: 1.62;
          overflow-wrap: anywhere;
        }
        ._src-source-code {
          display: grid;
          gap: 5px;
          border: 1px solid rgba(220,228,240,0.12);
          border-radius: 6px;
          padding: 9px;
          background: rgba(8,11,16,0.36);
          color: var(--tac-fg-2, #aab5c5);
          font: 800 11px/1.5 var(--mono, monospace);
          overflow-wrap: anywhere;
        }
        ._src-source-code b {
          color: var(--tac-brand, #c8943f);
          font-size: 10px;
        }
        ._src-source-state {
          display: grid;
          gap: 6px;
        }
        ._src-source-state span {
          min-height: 24px;
          display: inline-flex;
          width: fit-content;
          align-items: center;
          gap: 6px;
          border: 1px solid var(--tac-line, rgba(220,228,240,0.14));
          border-radius: 5px;
          padding: 0 8px;
          font: 900 10px/1 var(--mono, monospace);
        }
        ._src-source-state b {
          color: var(--tac-fg-0, #e8edf5);
        }
        ._src-source-state small {
          color: var(--tac-fg-3, #7a8aa0);
          font: 800 10px/1.45 var(--sans-tc, sans-serif);
          overflow-wrap: anywhere;
        }
        ._src-sizing {
          display: flex;
          align-items: center;
          gap: 8px;
          color: var(--tac-fg-2, #aab5c5);
          font: 800 11px/1 var(--sans-tc, sans-serif);
        }
        ._src-sizing b { color: var(--tac-fg-0, #e8edf5); }
        ._src-sizing-sep { opacity: 0.3; }
        @media (max-width: 680px) {
          ._src-head { display: grid; }
          ._src-targets { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }
      `}</style>
      <article className="_src-card" data-bucket={rec.bucket}>
        <div className="_src-head">
          <div>
            <h3 className="_src-name">
              <span className="_src-ticker">{rec.ticker}</span>
              {rec.company_name ?? ""}
            </h3>
          </div>
          <div className="_src-badges">
            <span className="_src-badge" data-tone={bucket.tone}>
              {rec.bucket} 推薦級
            </span>
            <span className="_src-badge">信心 {fmtConfidence(rec.confidence)}</span>
            {rec.market_multiplier != null && (
              <span className="_src-badge">盤勢係數 {rec.market_multiplier}</span>
            )}
          </div>
        </div>

        <table className="_src-score-table" aria-label={`${rec.ticker} v3 sub score`}>
          <thead>
            <tr>
              {SUB_SCORE_ROWS.map((row) => (
                <th key={row.key}>{row.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {SUB_SCORE_ROWS.map((row) => (
                <td key={row.key}>{fmtScore(scores[row.key], row.max)}</td>
              ))}
            </tr>
          </tbody>
        </table>

        <div className="_src-entry">
          <div className="_src-entry-label">建議進場區間</div>
          <div className="_src-entry-val">
            {entry?.ote_low != null && entry?.ote_high != null
              ? `${fmtPrice(entry.ote_low)} - ${fmtPrice(entry.ote_high)}`
              : "-"}
          </div>
          <p className="_src-p">{entryLabel}</p>
        </div>

        <div className="_src-targets">
          <div className="_src-target-cell">
            <b>目標一</b>
            <span>{fmtPrice(targets?.tp1)}</span>
          </div>
          <div className="_src-target-cell">
            <b>目標二</b>
            <span>{fmtPrice(targets?.tp2)}</span>
          </div>
          <div className="_src-target-cell">
            <b>停損</b>
            <span>{fmtPrice(targets?.sl)}</span>
          </div>
          <div className="_src-target-cell">
            <b>風報比</b>
            <span>{fmtRValue(targets?.r_value)}</span>
          </div>
        </div>

        <div className="_src-reasoning">
          <div>
            <div className="_src-reasoning-head">推薦理由</div>
            {rec.why_buy ? <SimpleMarkdown text={rec.why_buy} /> : <p className="_src-p">後端未回傳推薦理由</p>}
          </div>
          <div>
            <div className="_src-reasoning-head">主要風險</div>
            <SimpleMarkdown text={riskText} />
          </div>
        </div>

        <div className="_src-source">
          <div className="_src-source-head">資料來源</div>
          <div className="_src-source-code">
            <b>推薦來源</b>
            <span>{displaySource(rec.source)}</span>
          </div>
          <div className="_src-source-code">
            <b>資料依據</b>
            <span>{sourceTrail}</span>
          </div>
          {flags.usedFallback || flags.synthesisFallbackUsed || flags.fullAiReportParsed === false ? (
            <div className="_src-source-state">
              <span data-tone="warn">資料完整度需留意</span>
              <small>本卡仍顯示後端回傳內容，未用前端假資料補齊。</small>
            </div>
          ) : (
            <div className="_src-source-state">
              <span data-tone="ok">正式資料</span>
              <small>本卡直接使用推薦引擎回傳資料，未用前端假資料補齊。</small>
            </div>
          )}
        </div>

        <div className="_src-sizing">
          <span className="_src-badge" data-tone={bucket.tone}>{rec.bucket} 推薦級</span>
          <b>建議單筆</b>
          {bucket.nav_pct === "0" ? "不下單" : `${bucket.nav_pct} NAV`}
          <span className="_src-sizing-sep">|</span>
          <b>組合上限</b>
          {bucket.max_nav === "0" ? "0" : `${bucket.max_nav} NAV`}
        </div>
      </article>
    </>
  );
}
