"use client";

/* ─────────────────────────────────────────────────────────────────
   BriefInMemoryBanner.tsx
   場景：daily brief 區顯示 0 brief，或提醒 in-memory 架構限制
   性質：producer awareness 資訊 banner，非 error / 非 loading
   ───────────────────────────────────────────────────────────────── */

export interface BriefInMemoryBannerProps {
  /** 目前記憶體中的 brief 數量（服務未重啟前的存活筆數） */
  inMemoryCount: number;
  /** 可選：服務最近一次重啟時間（ISO 8601） */
  lastRestartAt?: string | null;
}

function formatRestartTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("zh-TW", {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function BriefInMemoryBanner({
  inMemoryCount,
  lastRestartAt,
}: BriefInMemoryBannerProps) {
  return (
    <div className="brief-in-memory-banner" role="note" aria-label="每日簡報架構說明">
      {/* ── HUD header ── */}
      <div className="empty-hud-header banner-hud-header">
        <span className="empty-hud-bracket">[</span>
        <span className="empty-hud-label">BRIEF · IN-MEMORY PREVIEW</span>
        <span className="empty-hud-bracket">]</span>
        <span className="banner-badge amber">ROADMAP</span>
      </div>

      <div className="empty-ascii-rule">────────────────────────────────</div>

      {/* ── Core message ── */}
      <div className="banner-body">
        <span className="empty-icon amber banner-icon">⚠</span>
        <div className="banner-text">
          <p className="banner-headline">
            每日簡報目前為 <strong>in-memory 預覽模式</strong>
          </p>
          <p className="banner-desc">
            簡報資料儲存於服務記憶體中。
            <strong>服務重啟或 Railway redeploy 後，所有簡報將會清空</strong>，
            無法跨服務週期持久保存。
          </p>
          {inMemoryCount > 0 ? (
            <p className="banner-count">
              目前記憶體中存有{" "}
              <span className="empty-count">{inMemoryCount}</span>{" "}
              筆簡報（本次服務啟動後建立）。
            </p>
          ) : (
            <p className="banner-count">
              目前記憶體中無任何簡報。
              {lastRestartAt && (
                <>
                  {" "}最近一次服務重啟：
                  <span className="mono">{formatRestartTime(lastRestartAt)}</span>
                </>
              )}
            </p>
          )}
        </div>
      </div>

      {/* ── Roadmap note ── */}
      <div className="empty-producer-hint banner-roadmap">
        <span className="empty-hud-bracket">[</span>
        <span className="empty-producer-label">ROADMAP</span>
        <span className="empty-hud-bracket">]</span>
        <span className="empty-producer-body">
          持久化層（資料庫 <code>briefs</code> table）在規劃路線圖中，
          <strong>尚未實作</strong>。
          <br />
          實作完成後，簡報將跨重啟保存，並支援歷史查詢與版本回溯。
        </span>
      </div>

      <div className="empty-ascii-rule">────────────────────────────────</div>

      <p className="empty-status-line">
        <span className="empty-dot amber" /> 預覽模式 · IN-MEMORY ONLY · NOT PERSISTED
      </p>
    </div>
  );
}

export default BriefInMemoryBanner;
