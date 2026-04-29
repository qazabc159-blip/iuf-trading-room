"use client";

/* ─────────────────────────────────────────────────────────────────
   SignalFeedEmpty.tsx
   場景：signals 僅個位數（目前 6 筆），trending 頁接近空白
   Producer awareness：
     - 告知目前 producer（OpenAlice worker / 人工 curation）尚未大量注入
     - 顯示現有樣本前 3 筆，暗示「起始樣本，非終態」
   ───────────────────────────────────────────────────────────────── */

export interface SignalSampleItem {
  id: string;
  title: string;
  direction: "bullish" | "bearish" | "neutral";
}

export interface SignalFeedEmptyProps {
  /** 目前系統中的 signal 總數 */
  totalSignals: number;
  /** 顯示前 3 筆樣本（可傳空陣列） */
  sampleSignals: SignalSampleItem[];
}

const DIR_LABEL: Record<SignalSampleItem["direction"], string> = {
  bullish: "看多",
  bearish: "看空",
  neutral: "中性",
};

const DIR_CLASS: Record<SignalSampleItem["direction"], string> = {
  bullish: "signal-dir-bull",
  bearish: "signal-dir-bear",
  neutral: "signal-dir-neutral",
};

export function SignalFeedEmpty({ totalSignals, sampleSignals }: SignalFeedEmptyProps) {
  const preview = sampleSignals.slice(0, 3);

  return (
    <div className="signal-feed-empty">
      {/* ── HUD header ── */}
      <div className="empty-hud-header">
        <span className="empty-hud-bracket">[</span>
        <span className="empty-hud-label">SIGNAL FEED · SPARSE</span>
        <span className="empty-hud-bracket">]</span>
      </div>

      <div className="empty-ascii-rule">────────────────────────────────</div>

      {/* ── Core message ── */}
      <div className="empty-icon-row">
        <span className="empty-icon phosphor">◎</span>
        <span className="empty-count-large">{totalSignals}</span>
        <span className="empty-count-unit">個 signal 已收錄</span>
      </div>

      <p className="empty-headline">
        Signal 覆蓋率偏低 — 系統正在等待 producer 注入
      </p>

      <p className="empty-body">
        目前只收到{" "}
        <span className="empty-count">{totalSignals}</span> 個 signal，
        尚不足以驅動完整的 trending 排行。
        <br />
        以下為現有起始樣本，非最終狀態。
      </p>

      {/* ── Sample list ── */}
      {preview.length > 0 && (
        <div className="empty-sample-list">
          <div className="empty-sample-header">
            <span className="empty-hud-bracket">[</span>
            <span className="empty-hud-label">起始樣本 · SAMPLE</span>
            <span className="empty-hud-bracket">]</span>
          </div>
          <ul className="empty-sample-items">
            {preview.map((s, idx) => (
              <li key={s.id} className="empty-sample-item">
                <span className="empty-sample-index mono">
                  {String(idx + 1).padStart(2, "0")}
                </span>
                <span className={`empty-sample-dir ${DIR_CLASS[s.direction]}`}>
                  {DIR_LABEL[s.direction]}
                </span>
                <span className="empty-sample-title">{s.title}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Producer hint ── */}
      <div className="empty-producer-hint">
        <span className="empty-hud-bracket">[</span>
        <span className="empty-producer-label">PRODUCER</span>
        <span className="empty-hud-bracket">]</span>
        <span className="empty-producer-body">
          新 signal 的來源有兩條路：
          <br />
          1. <strong>OpenAlice worker</strong>（AI 代理）— 目前尚未有 device 連線注入
          <br />
          2. <strong>人工 curation</strong> — 透過 Signal Board 手動新增
        </span>
      </div>

      <div className="empty-ascii-rule">────────────────────────────────</div>

      <p className="empty-status-line">
        <span className="empty-dot amber" /> 待機 · AWAITING OPENALICE WORKER / MANUAL CURATION
      </p>
    </div>
  );
}

export default SignalFeedEmpty;
