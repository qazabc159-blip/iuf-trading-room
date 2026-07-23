import type { AiRecPerformance } from "@/lib/api";

function formatPct(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return "--";
  return `${(value * 100).toFixed(digits)}%`;
}

function formatSignedPct(value: number | null, digits = 2): string {
  if (value === null || !Number.isFinite(value)) return "--";
  const pct = value * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(digits)}%`;
}

/**
 * 追蹤實績 methodology box — 取代設計稿 v1 被楊董退件的金框 KPI 統計帶。
 * 資料來源與既有 PerfScorecard 完全相同（GET /api/v1/admin/ai-rec/performance,
 * Owner-only），只是換了呈現版式：報紙式方框 + 表頭 caveat，不是彩色統計卡。
 * Owner-only：非 Owner session 這裡回傳 null（既有行為，getAiRecPerformance()
 * 對 403 直接吞掉回 null），本區塊整段不渲染。
 */
export function TrackRecordBox({ perf }: { perf: AiRecPerformance | null }) {
  if (!perf || perf.total_picks === 0) return null;
  const smallSample = perf.picks_with_ret_5d < 20;
  const range = perf.earliest_pick_date && perf.latest_pick_date
    ? `${perf.earliest_pick_date} ~ ${perf.latest_pick_date}`
    : "--";

  return (
    <section className="track-box">
      <div className="tb-hd">
        <h3>本報追蹤實績</h3>
        <span className="caveat">事後追蹤 · 非未來報酬保證</span>
        <span className="base">BASE {perf.benchmark} · 每日自動更新</span>
      </div>
      <div className="track-row">
        <div className="m">
          <span className="n mono">{formatPct(perf.overall_hit_rate_1d)}</span>
          <span className="k">隔日勝率<span className="s">{perf.picks_with_ret_1d} 筆樣本</span></span>
        </div>
        <div className="m">
          <span className="n mono">{formatPct(perf.overall_hit_rate_5d)}</span>
          <span className="k">5 日勝率<span className="s">{perf.picks_with_ret_5d} 筆樣本</span></span>
        </div>
        <div className="m">
          <span className={`n mono${perf.avg_excess_5d !== null && perf.avg_excess_5d >= 0 ? " up" : ""}`}>
            {formatSignedPct(perf.avg_excess_5d)}
          </span>
          <span className="k">5 日平均超額<span className="s">vs {perf.benchmark}</span></span>
        </div>
        <div className="m">
          <span className="n mono">{formatPct(perf.overall_hit_rate_20d)}</span>
          <span className="k">
            20 日勝率
            <span className="s">{perf.picks_with_ret_20d > 0 ? `${perf.picks_with_ret_20d} 筆樣本` : "樣本未滿 20 個交易日"}</span>
          </span>
        </div>
      </div>
      <div className="track-foot">
        統計期間 {range}，共 {perf.total_picks} 筆推薦。勝率＝推薦後相對 {perf.benchmark} 有超額報酬的比例。
        {smallSample ? " 樣本仍在累積中，數字會隨時間趨於穩定，暫不適合作為結論。" : ""}
        此為事後績效追蹤，非未來報酬保證。
      </div>
    </section>
  );
}
