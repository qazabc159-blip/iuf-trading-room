import Link from "next/link";
import { Panel } from "@/components/PageFrame";
import { DataStateBadge } from "@/components/DataStateBadge";
import { getWeeklyReview, type AiRecPerformance, type WeeklyReview } from "@/lib/api";
import {
  shiftWeekAnchor,
  formatMonthDay,
  formatTwdSigned,
  formatTwdPlain,
  formatSignedPct2,
  formatPct2,
  formatFractionPct,
  formatSignedFractionPct,
  signTone,
  fAutoDataSourceLabel,
  briefDeliverySummary,
} from "@/lib/weekly-review-format";

const WEEKLY_REVIEW_CSS = `
._wrv-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}
._wrv-nav-range {
  font: 800 12px/1.3 var(--mono);
  color: var(--tac-fg-1, #e7ecf3);
  letter-spacing: 0.04em;
}
._wrv-nav-links {
  display: flex;
  gap: 8px;
}
._wrv-nav-link {
  font: 700 11px/1 var(--mono);
  padding: 5px 10px;
  border: 1px solid var(--tac-line, rgba(220,228,240,0.12));
  border-radius: 3px;
  color: var(--tac-fg-2, rgba(220,228,240,0.75));
  text-decoration: none;
  letter-spacing: 0.04em;
  transition: background 0.12s ease, color 0.12s ease;
}
._wrv-nav-link:hover {
  background: rgba(226,184,92,0.08);
  color: var(--tac-brand, #e2b85c);
}
._wrv-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 14px;
  margin-bottom: 4px;
}
._wrv-card {
  border: 1px solid var(--tac-line, rgba(220,228,240,0.12));
  border-radius: 6px;
  padding: 14px 16px;
  background: rgba(8,11,16,0.42);
}
._wrv-card-title {
  font: 800 10.5px/1.3 var(--sans-tc);
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--tac-fg-3, rgba(145,160,181,0.7));
  margin-bottom: 10px;
}
._wrv-taiex-row {
  display: flex;
  justify-content: space-between;
  gap: 6px;
  font: 700 11px/1.5 var(--mono);
  padding: 3px 0;
  border-bottom: 1px solid rgba(220,228,240,0.06);
}
._wrv-taiex-row:last-child { border-bottom: none; }
._wrv-taiex-date { color: var(--tac-fg-3, rgba(145,160,181,0.7)); }
._wrv-taiex-close { color: var(--tac-fg-1, #e7ecf3); }
._wrv-tone-ok { color: var(--tac-ok, #4ade80); }
._wrv-tone-bad { color: var(--tw-dn-bright, #e63946); }
._wrv-tone-dim { color: var(--tac-fg-3, rgba(145,160,181,0.7)); }
._wrv-week-total {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid rgba(220,228,240,0.1);
  display: flex;
  justify-content: space-between;
  font: 800 12px/1.4 var(--mono);
}
._wrv-kv-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
  gap: 10px;
}
._wrv-kv-grid > div {
  display: grid;
  gap: 3px;
}
._wrv-kv-label {
  font: 700 10px/1.2 var(--sans-tc);
  color: var(--tac-fg-3, rgba(145,160,181,0.7));
}
._wrv-kv-value {
  font: 850 17px/1.1 var(--mono);
  color: var(--tac-fg-1, #e7ecf3);
}
._wrv-sim-badge {
  display: inline-block;
  font: 800 9px/1 var(--mono);
  letter-spacing: 0.06em;
  padding: 2px 6px;
  margin-left: 6px;
  border-radius: 3px;
  border: 1px solid rgba(200,148,63,0.45);
  color: #e2b85c;
  background: rgba(200,148,63,0.08);
  vertical-align: middle;
}
._wrv-note {
  margin-top: 10px;
  font: 500 11px/1.6 var(--sans-tc);
  color: var(--tac-fg-3, rgba(145,160,181,0.7));
}
._wrv-rec-sub {
  font: 700 10px/1.3 var(--sans-tc);
  letter-spacing: 0.04em;
  color: var(--tac-fg-3, rgba(145,160,181,0.7));
  margin: 12px 0 6px;
  text-transform: uppercase;
}
._wrv-rec-sub:first-child { margin-top: 0; }
._wrv-empty {
  padding: 16px 20px;
  border-radius: 4px;
  background: rgba(200,148,63,0.06);
  border: 1px solid rgba(200,148,63,0.2);
  border-left: 3px solid rgba(200,148,63,0.55);
  font: 500 12px/1.6 var(--sans-tc);
  color: rgba(145,160,181,0.85);
}
._wrv-missing-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}
._wrv-missing-chip {
  font: 700 10px/1 var(--mono);
  padding: 2px 7px;
  border-radius: 3px;
  background: rgba(230,57,70,0.08);
  border: 1px solid rgba(230,57,70,0.3);
  color: #ff6b77;
}
@media (max-width: 640px) {
  ._wrv-nav { flex-direction: column; align-items: flex-start; }
}
@media (max-width: 480px) {
  ._wrv-nav-link {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    padding: 5px 12px;
  }
}
`;

function toneClass(value: number | null) {
  const tone = signTone(value);
  return tone === "ok" ? "_wrv-tone-ok" : tone === "bad" ? "_wrv-tone-bad" : "_wrv-tone-dim";
}

function TaiexCard({ taiex }: { taiex: WeeklyReview["taiex"] }) {
  return (
    <div className="_wrv-card">
      <div className="_wrv-card-title">大盤週表現（加權指數）</div>
      {taiex.days.length === 0 ? (
        <div className="_wrv-note">
          <DataStateBadge state="empty" label="本週尚無加權指數收盤資料。" testId="wrv-taiex-empty-badge" />
        </div>
      ) : (
        <>
          {taiex.days.map((day) => (
            <div className="_wrv-taiex-row" key={day.date}>
              <span className="_wrv-taiex-date">{formatMonthDay(day.date)}</span>
              <span className="_wrv-taiex-close">{formatTwdPlain(day.close)}</span>
              <span className={toneClass(day.changePct)}>
                {formatSignedPct2(day.changePct)}
              </span>
            </div>
          ))}
          <div className="_wrv-week-total">
            <span>週漲跌</span>
            <span className={toneClass(taiex.week_change_pct)}>
              {formatSignedPct2(taiex.week_change_pct)}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

function FAutoCard({ fAuto }: { fAuto: WeeklyReview["f_auto"] }) {
  return (
    <div className="_wrv-card">
      <div className="_wrv-card-title">
        F-AUTO 模擬倉週表現
        <span className="_wrv-sim-badge">SIM</span>
      </div>
      {!fAuto.available ? (
        <div className="_wrv-note">
          {fAuto.notes[0] ?? "本週模擬倉資料暫無法重建。"}
        </div>
      ) : (
        <>
          <div className="_wrv-kv-grid">
            <div>
              <span className="_wrv-kv-label">持有檔數</span>
              <span className="_wrv-kv-value">{fAuto.positions_count}</span>
            </div>
            <div>
              <span className="_wrv-kv-label">未實現損益</span>
              <span className={`_wrv-kv-value ${toneClass(fAuto.total_unrealized_pnl_twd)}`}>
                {formatTwdSigned(fAuto.total_unrealized_pnl_twd)}
              </span>
            </div>
            <div>
              <span className="_wrv-kv-label">週報酬</span>
              <span className={`_wrv-kv-value ${toneClass(fAuto.week_return_pct)}`}>
                {formatSignedPct2(fAuto.week_return_pct)}
              </span>
            </div>
            <div>
              <span className="_wrv-kv-label">模擬本金</span>
              <span className="_wrv-kv-value">NT${formatTwdPlain(fAuto.capital_twd)}</span>
            </div>
          </div>
          <div className="_wrv-note">
            資料來源：{fAutoDataSourceLabel(fAuto.data_source)}
            {fAuto.positions_date ? `（${formatMonthDay(fAuto.positions_date)} 部位）` : ""}
            。此為模擬倉位績效，不代表實際下單結果。
          </div>
        </>
      )}
    </div>
  );
}

function RecScoreRow({ label, value, sample, tone }: { label: string; value: string; sample: string; tone?: "ok" | "bad" | "dim" }) {
  return (
    <div>
      <span className="_wrv-kv-label">{label}</span>
      <span className={`_wrv-kv-value ${tone ? (tone === "ok" ? "_wrv-tone-ok" : tone === "bad" ? "_wrv-tone-bad" : "") : ""}`}>
        {value}
      </span>
      <span className="_wrv-note" style={{ marginTop: 2 }}>{sample}</span>
    </div>
  );
}

function RecPerfBlock({ perf, smallSampleThreshold = 20 }: { perf: AiRecPerformance; smallSampleThreshold?: number }) {
  if (perf.total_picks === 0) {
    return <div className="_wrv-note">尚無推薦樣本可供統計。</div>;
  }
  const smallSample = perf.picks_with_ret_5d < smallSampleThreshold;
  return (
    <>
      <div className="_wrv-kv-grid">
        <RecScoreRow
          label="隔日勝率"
          value={formatFractionPct(perf.overall_hit_rate_1d)}
          sample={`${perf.picks_with_ret_1d} 筆樣本`}
        />
        <RecScoreRow
          label="5 日勝率"
          value={formatFractionPct(perf.overall_hit_rate_5d)}
          sample={`${perf.picks_with_ret_5d} 筆樣本`}
        />
        <RecScoreRow
          label="5 日超額 vs 0050"
          value={formatSignedFractionPct(perf.avg_excess_5d)}
          sample="超額報酬"
          tone={signTone(perf.avg_excess_5d)}
        />
        <RecScoreRow
          label="20 日勝率"
          value={formatFractionPct(perf.overall_hit_rate_20d)}
          sample={perf.picks_with_ret_20d > 0 ? `${perf.picks_with_ret_20d} 筆樣本` : "樣本未滿 20 個交易日"}
        />
      </div>
      <div className="_wrv-note">
        共 {perf.total_picks} 筆推薦。
        {smallSample ? "樣本仍在累積中，數字會隨時間趨於穩定，暫不適合作為結論。" : ""}
      </div>
    </>
  );
}

function BriefCard({ briefs }: { briefs: WeeklyReview["briefs"] }) {
  return (
    <div className="_wrv-card">
      <div className="_wrv-card-title">簡報出貨</div>
      <div className="_wrv-kv-grid">
        <div>
          <span className="_wrv-kv-label">本週發布</span>
          <span className="_wrv-kv-value">
            {briefDeliverySummary(briefs.published_dates.length, briefs.trading_days.length)}
          </span>
        </div>
      </div>
      {briefs.missing_dates.length > 0 && (
        <>
          <div className="_wrv-note">未發布日期：</div>
          <div className="_wrv-missing-list">
            {briefs.missing_dates.map((d) => (
              <span className="_wrv-missing-chip" key={d}>{formatMonthDay(d)}</span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export async function WeeklyReviewPanel({ anchor }: { anchor?: string }) {
  const result = await getWeeklyReview(anchor);

  if (!result.ok) {
    if (result.reason === "forbidden") {
      return (
        <Panel code="REV-WK" title="本週復盤" sub="量化自動復盤（B4）">
          <style>{WEEKLY_REVIEW_CSS}</style>
          <div className="_wrv-empty">此面板需要擁有者權限才能讀取。</div>
        </Panel>
      );
    }
    return (
      <Panel code="REV-WK" title="本週復盤" sub="量化自動復盤（B4）">
        <style>{WEEKLY_REVIEW_CSS}</style>
        <div className="_wrv-empty">本週復盤資料暫時無法讀取，請稍後重新整理。</div>
      </Panel>
    );
  }

  const review = result.data;
  const prevAnchor = shiftWeekAnchor(review.week_start, -1);
  const nextAnchor = shiftWeekAnchor(review.week_start, 1);

  return (
    <Panel
      code="REV-WK"
      title="本週復盤"
      sub="量化自動復盤（B4） — 全部數據以正式資料庫即時計算"
    >
      <style>{WEEKLY_REVIEW_CSS}</style>

      <div className="_wrv-nav">
        <span className="_wrv-nav-range">
          {formatMonthDay(review.week_start)} ~ {formatMonthDay(review.week_end)}
        </span>
        <div className="_wrv-nav-links">
          <Link className="_wrv-nav-link" href={`/reviews?anchor=${prevAnchor}`}>← 上週</Link>
          <Link className="_wrv-nav-link" href={`/reviews?anchor=${nextAnchor}`}>下週 →</Link>
        </div>
      </div>

      <div className="_wrv-grid">
        <TaiexCard taiex={review.taiex} />
        <FAutoCard fAuto={review.f_auto} />
        <BriefCard briefs={review.briefs} />
      </div>

      <div className="_wrv-card" style={{ marginTop: 14 }}>
        <div className="_wrv-card-title">AI 推薦成績單</div>
        <div className="_wrv-rec-sub">本週</div>
        <RecPerfBlock perf={review.recommendations.week} />
        <div className="_wrv-rec-sub">累計</div>
        <RecPerfBlock perf={review.recommendations.cumulative} />
        <div className="_wrv-note">
          基準 0050。勝率＝推薦後相對 0050 有超額報酬的比例；此為事後績效追蹤，非未來報酬保證。
        </div>
      </div>

      {review.notes.length > 0 && (
        <div className="_wrv-note" style={{ marginTop: 10 }}>
          {review.notes.join(" ")}
        </div>
      )}
    </Panel>
  );
}
