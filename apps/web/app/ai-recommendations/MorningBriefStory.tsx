import { LinkageCtaRow, type StockRecCardData } from "./StockRecCard";
import { BUCKET_CONFIG, displaySource, displaySourceTrail } from "./rec-card-shared";
import {
  fmtConfidence,
  fmtMultiplier,
  fmtPrice,
  fmtRValue,
  fmtScore,
  rankLabel,
  resolveThemeContextDisplay,
  splitParagraphs,
  SUB_SCORE_ROWS,
} from "./morning-brief-copy";

/**
 * 內頁候選（rank #2-5）— 同一份 mapV3ItemToStockRecCard() 真值，換成緊湊版排
 * 版：inline 七維評分列 + inline 交易計畫列，全資訊直排、零 <details> 展開。
 */
export function MorningBriefStory({ rec, index }: { rec: StockRecCardData; index: number }) {
  const bucket = BUCKET_CONFIG[rec.bucket];
  const scores = rec.sub_scores ?? {};
  const entry = rec.entry;
  const targets = rec.targets;
  const bodyParagraphs = splitParagraphs(rec.why_buy);
  const riskItems = splitParagraphs(rec.risk);
  const entryRange = entry?.ote_low != null && entry?.ote_high != null
    ? `${fmtPrice(entry.ote_low)} – ${fmtPrice(entry.ote_high)}`
    : "--";
  const themeDisplay = resolveThemeContextDisplay(rec.themeContext);

  return (
    <article className="story">
      <div className="st-head">
        <span className="rank">{rankLabel(index)}</span>
        <span className="co">{rec.company_name ?? "公司名稱未回傳"}</span>
        <span className="code mono">{rec.ticker}</span>
        <span className="lvl">{rec.bucket} 推薦級</span>
        <span className="spr" />
        <span className="conf"><div className="v mono">{fmtConfidence(rec.confidence)}</div><div className="k">信心 · 係數 {fmtMultiplier(rec.market_multiplier)}</div></span>
        <span className="tot"><div className="v mono">{fmtScore(scores.total, 100)}</div><div className="k">總分</div></span>
      </div>

      <div className="st-scores">
        {SUB_SCORE_ROWS.map((row) => (
          <div className="s" key={row.key}>
            <div className="v mono">{fmtScore(scores[row.key], row.max)}</div>
            <div className="l">{row.label}</div>
          </div>
        ))}
      </div>

      <div className="st-plan">
        <div className="p up"><div className="k">目標一</div><div className="v mono">{fmtPrice(targets?.tp1)}</div></div>
        <div className="p up"><div className="k">目標二</div><div className="v mono">{fmtPrice(targets?.tp2)}</div></div>
        <div className="p down"><div className="k">停損</div><div className="v mono">{fmtPrice(targets?.sl)}</div></div>
        <div className="p g"><div className="k">風報比</div><div className="v mono">{fmtRValue(targets?.r_value)}</div></div>
      </div>

      <p className="st-entry">進場區間 <span className="rng mono">{entryRange}</span>：{entry?.label ?? "AI 尚未提供建議進場區間"}</p>

      <div className="st-body">
        {bodyParagraphs.length > 0 ? (
          bodyParagraphs.map((paragraph, idx) => <p key={idx}>{paragraph}</p>)
        ) : (
          <p>AI 尚未產出推薦理由。</p>
        )}
      </div>

      <div className="st-sub">主要風險</div>
      {riskItems.length > 0 ? (
        <ul className="st-risk">
          {riskItems.map((item, idx) => <li key={idx}>{item}</li>)}
        </ul>
      ) : (
        <p className="prose-empty">AI 尚未產出主要風險。</p>
      )}

      {themeDisplay && (
        <div className="st-theme">
          <div className="st-theme-h">主題與供應鏈脈絡</div>
          {themeDisplay.positionLine && <p>{themeDisplay.positionLine}</p>}
          {themeDisplay.themesLine && <p>{themeDisplay.themesLine}</p>}
        </div>
      )}

      <div className="st-byline">
        <span className="src">來源 · <b>{displaySource(rec.source)}</b>｜{displaySourceTrail(rec.sourceTrail)}</span>
        <span className="pos mono">單筆 <b>{bucket.nav_pct === "0" ? "不下單" : bucket.nav_pct}</b> · 上限 <b>{bucket.max_nav === "0" ? "0" : bucket.max_nav}</b></span>
        <div className="acts">
          <LinkageCtaRow rec={rec} />
        </div>
      </div>
    </article>
  );
}
