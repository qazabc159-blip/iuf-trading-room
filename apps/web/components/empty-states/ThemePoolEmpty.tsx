"use client";

/* ─────────────────────────────────────────────────────────────────
   ThemePoolEmpty.tsx
   場景：主題存在，但 core pool / observation pool 尚未匯入研究，0 筆公司
   Producer awareness：告訴 operator 誰是 producer + 為何還沒有資料
   ───────────────────────────────────────────────────────────────── */

export interface ThemePoolEmptyProps {
  /** 主題名稱 */
  themeName: string;
  /** 哪個 pool 是空的 */
  poolType: "core" | "observation" | "both";
}

const POOL_LABEL: Record<ThemePoolEmptyProps["poolType"], string> = {
  core:        "Core Pool（核心公司池）",
  observation: "Observation Pool（觀察公司池）",
  both:        "Core Pool + Observation Pool",
};

export function ThemePoolEmpty({ themeName, poolType }: ThemePoolEmptyProps) {
  return (
    <div className="theme-pool-empty">
      {/* ── HUD header ── */}
      <div className="empty-hud-header">
        <span className="empty-hud-bracket">[</span>
        <span className="empty-hud-label">COVERAGE · POOL</span>
        <span className="empty-hud-bracket">]</span>
      </div>

      {/* ── ASCII divider ── */}
      <div className="empty-ascii-rule">────────────────────────────────</div>

      {/* ── Core message ── */}
      <div className="empty-icon-row">
        <span className="empty-icon amber">◈</span>
        <span className="empty-theme-name">{themeName}</span>
      </div>

      <p className="empty-headline">
        {POOL_LABEL[poolType]} 尚無覆蓋研究
      </p>

      <p className="empty-body">
        這個主題還未匯入任何公司的 coverage 研究。<br />
        池中公司數量目前為 <span className="empty-count">0</span>。
      </p>

      {/* ── Producer hint ── */}
      <div className="empty-producer-hint">
        <span className="empty-hud-bracket">[</span>
        <span className="empty-producer-label">PRODUCER</span>
        <span className="empty-hud-bracket">]</span>
        <span className="empty-producer-body">
          待 <code>My-TW-Coverage import</code> 執行後，此池將自動填入對應公司。
          <br />
          匯入完成前此頁維持空白，屬正常待機狀態。
        </span>
      </div>

      {/* ── ASCII divider ── */}
      <div className="empty-ascii-rule">────────────────────────────────</div>

      <p className="empty-status-line">
        <span className="empty-dot amber" /> 待機 · AWAITING MY-TW-COVERAGE IMPORT
      </p>
    </div>
  );
}

export default ThemePoolEmpty;
