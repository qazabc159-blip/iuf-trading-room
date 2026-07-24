import { LinkageCtaRow, type StockRecCardData } from "./StockRecCard";
import { BUCKET_CONFIG, displaySource, displaySourceTrail } from "./rec-card-shared";
import {
  fmtConfidence,
  fmtMultiplier,
  fmtPrice,
  fmtRValue,
  fmtScore,
  rankLabel,
  resolveLeadSummaryText,
  resolveThemeContextDisplay,
  splitParagraphs,
  SUB_SCORE_ROWS,
} from "./morning-brief-copy";

/**
 * 頭版特稿 — 今日主推（rank #1）。設計稿 v2 的「頭版」全資訊直排，零 <details>
 * 展開；所有數字都來自 mapV3ItemToStockRecCard() 的真值（見
 * reports/design_redesign_20260722/AI_REC_IMPL_FIELD_MAP_20260723.md）。
 */
export function MorningBriefLead({ rec }: { rec: StockRecCardData }) {
  const bucket = BUCKET_CONFIG[rec.bucket];
  const scores = rec.sub_scores ?? {};
  const entry = rec.entry;
  const targets = rec.targets;
  const whyBuyParagraphs = splitParagraphs(rec.why_buy);
  const riskItems = splitParagraphs(rec.risk);
  const entryRange = entry?.ote_low != null && entry?.ote_high != null
    ? `${fmtPrice(entry.ote_low)} – ${fmtPrice(entry.ote_high)}`
    : "--";
  const deckText = resolveLeadSummaryText(rec.leadSummary);
  const themeDisplay = resolveThemeContextDisplay(rec.themeContext);

  return (
    <article className="lead">
      <div className="lead-head">
        <div className="lh-name">
          <span className="co">{rec.company_name ?? "公司名稱未回傳"}</span>
          <span className="code mono">{rec.ticker}</span>
          <span className="lvl">{rec.bucket} 推薦級</span>
          <span className="rank">{rankLabel(0)}</span>
        </div>
        <div />
        <div className="lh-metrics">
          <div className="m conf"><div className="k">信心</div><div className="v mono">{fmtConfidence(rec.confidence)}</div></div>
          <div className="m"><div className="k">總分</div><div className="v mono">{fmtScore(scores.total, 100)}</div></div>
          <div className="m"><div className="k">盤勢係數</div><div className="v mono">{fmtMultiplier(rec.market_multiplier)}</div></div>
        </div>
      </div>

      <p className="deck">{deckText}</p>

      <div className="lead-body">
        <div className="lb-main">
          <div className="colhd">推薦理由</div>
          <div className="prose">
            {whyBuyParagraphs.length > 0 ? (
              whyBuyParagraphs.map((paragraph, idx) => <p key={idx}>{paragraph}</p>)
            ) : (
              <p>後端尚未回傳推薦理由。</p>
            )}
          </div>

          <div className="risk-block">
            <div className="rh">主要風險<span className="en">Key Risks</span></div>
            {riskItems.length > 0 ? (
              <ul className="risk-list">
                {riskItems.map((item, idx) => <li key={idx}>{item}</li>)}
              </ul>
            ) : (
              <p className="prose-empty">後端尚未回傳主要風險。</p>
            )}
          </div>

          {themeDisplay && (
            <div className="theme-block">
              <div className="th-h">主題與供應鏈脈絡<span className="en">Theme Context</span></div>
              {themeDisplay.positionLine && <p className="th-pos">{themeDisplay.positionLine}</p>}
              {themeDisplay.themesLine && <p className="th-themes">{themeDisplay.themesLine}</p>}
            </div>
          )}
        </div>

        <div className="lb-aside">
          <table className="boxscore">
            <caption>七維評分</caption>
            <tbody>
              {SUB_SCORE_ROWS.map((row) => (
                <tr key={row.key}>
                  <td className="dim">{row.label}</td>
                  <td className="sc">{fmtScore(scores[row.key], row.max)}</td>
                </tr>
              ))}
              <tr className="tot">
                <td className="dim">總分</td>
                <td className="sc">{fmtScore(scores.total, 100)}</td>
              </tr>
            </tbody>
          </table>

          <table className="plan">
            <caption>交易計畫</caption>
            <tbody>
              <tr className="entry-row"><td className="k">進場區間</td><td className="v"><span className="entry-val mono">{entryRange}</span></td></tr>
              <tr className="entry-note"><td colSpan={2}><div className="n">{entry?.label ?? "後端未回傳建議進場區間"}</div></td></tr>
              <tr><td className="k">目標一</td><td className="v up">{fmtPrice(targets?.tp1)}</td></tr>
              <tr><td className="k">目標二</td><td className="v up">{fmtPrice(targets?.tp2)}</td></tr>
              <tr><td className="k">停損</td><td className="v down">{fmtPrice(targets?.sl)}</td></tr>
              <tr><td className="k">風報比</td><td className="v g">{fmtRValue(targets?.r_value)}</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="byline">
        <span className="src">來源 · <b>{displaySource(rec.source)}</b>｜{displaySourceTrail(rec.sourceTrail)}</span>
        <span className="pos mono">建議單筆 <b>{bucket.nav_pct === "0" ? "不下單" : `${bucket.nav_pct} NAV`}</b> · 組合上限 <b>{bucket.max_nav === "0" ? "0" : `${bucket.max_nav} NAV`}</b></span>
        <div className="acts">
          <LinkageCtaRow rec={rec} />
        </div>
      </div>
    </article>
  );
}
