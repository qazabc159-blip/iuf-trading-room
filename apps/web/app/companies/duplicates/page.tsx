import type { CompanyDuplicateEntry, CompanyDuplicateGroup } from "@iuf-trading-room/contracts";
import { PageFrame, Panel } from "@/components/PageFrame";
import { getCompanyDuplicates } from "@/lib/api";
import { friendlyDataError } from "@/lib/friendly-error";

function errorText(error: unknown): string {
  return friendlyDataError(error, "重複公司資料暫時無法讀取。");
}

function timeText(iso: string) {
  return new Date(iso).toLocaleString("zh-TW", {
    hour12: false,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function safeCompanyName(company: CompanyDuplicateEntry) {
  const name = company.name?.trim();
  if (!name || /[�-]/.test(name)) return "名稱待校正";
  return name;
}

function tierText(value: string) {
  if (value === "Core") return "核心";
  if (value === "Direct") return "直接";
  if (value === "Indirect") return "間接";
  if (value === "Observation") return "觀察";
  return value;
}

function reasonText(value: string | null | undefined) {
  const reason = value?.trim() ?? "";
  const lower = reason.toLowerCase();
  if (!reason) return "同代號公司主檔需要人工核對。";
  if (
    lower.includes("high ticker growth") ||
    lower.includes("richer graph coverage") ||
    lower.includes("canonical company card") ||
    lower.includes("graph coverage")
  ) {
    return "此代號關聯與覆蓋度較高，建議作為保留主檔。";
  }
  return reason.replace(/[�-]/g, "").trim() || "同代號公司主檔需要人工核對。";
}

const DUP_CSS = `
  ._bty-dup-kpi {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(80px, 1fr));
    gap: 1px;
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.09);
    border-radius: 6px;
    margin-bottom: 16px;
    overflow: hidden;
  }
  ._bty-dup-kpi-cell {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 10px 8px;
    background: rgba(0,0,0,0.25);
    gap: 4px;
  }
  ._bty-dup-kpi-val {
    font-size: 18px;
    font-weight: 700;
    font-family: var(--mono, monospace);
    color: #e0e0e0;
    line-height: 1;
  }
  ._bty-dup-kpi-lbl {
    font-size: 10px;
    color: rgba(255,255,255,0.4);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  ._bty-dup-layout {
    display: grid;
    grid-template-columns: 1fr 360px;
    gap: 16px;
    align-items: start;
  }
  @media (max-width: 900px) {
    ._bty-dup-layout { grid-template-columns: 1fr; }
  }
  ._bty-dup-table-head {
    display: grid;
    grid-template-columns: 60px 40px 1fr 50px 1fr;
    gap: 8px;
    padding: 6px 12px;
    background: rgba(255,255,255,0.04);
    border-bottom: 1px solid rgba(255,255,255,0.08);
    font-size: 10px;
    color: rgba(255,255,255,0.4);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  ._bty-dup-table-row {
    display: grid;
    grid-template-columns: 60px 40px 1fr 50px 1fr;
    gap: 8px;
    padding: 8px 12px;
    border-bottom: 1px solid rgba(255,255,255,0.05);
    align-items: start;
    transition: background 0.1s;
  }
  ._bty-dup-table-row:hover {
    background: rgba(255,255,255,0.03);
  }
  ._bty-dup-table-row:last-child {
    border-bottom: none;
  }
  ._bty-dup-ticker {
    font-family: var(--mono, monospace);
    font-size: 13px;
    color: #ffb800;
    font-weight: 600;
  }
  ._bty-dup-count {
    font-family: var(--mono, monospace);
    font-size: 13px;
    color: rgba(255,255,255,0.7);
    text-align: center;
  }
  ._bty-dup-name {
    font-size: 12px;
    color: rgba(255,255,255,0.8);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  ._bty-dup-rel {
    font-family: var(--mono, monospace);
    font-size: 12px;
    color: rgba(255,255,255,0.5);
    text-align: center;
  }
  ._bty-dup-reason {
    font-size: 11px;
    color: rgba(255,255,255,0.4);
    line-height: 1.4;
  }
  ._bty-dup-group-card {
    padding: 14px;
    background: rgba(255,255,255,0.02);
    border: 1px solid rgba(255,255,255,0.07);
    border-radius: 6px;
    margin-bottom: 10px;
  }
  ._bty-dup-group-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 10px;
    padding-bottom: 8px;
    border-bottom: 1px solid rgba(255,255,255,0.07);
  }
  ._bty-dup-group-ticker {
    font-size: 16px;
    font-weight: 700;
    color: #ffb800;
    font-family: var(--mono, monospace);
  }
  ._bty-dup-group-count-badge {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 11px;
    background: rgba(255,152,0,0.12);
    color: #ff9800;
    border: 1px solid rgba(255,152,0,0.25);
  }
  ._bty-dup-readonly-notice {
    font-size: 11px;
    color: rgba(255,152,0,0.6);
    padding: 6px 8px;
    background: rgba(255,152,0,0.06);
    border: 1px solid rgba(255,152,0,0.15);
    border-radius: 4px;
    margin-bottom: 10px;
    line-height: 1.5;
  }
  ._bty-dup-company-row {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding: 7px 0;
    border-bottom: 1px solid rgba(255,255,255,0.04);
    gap: 8px;
  }
  ._bty-dup-company-row:last-child {
    border-bottom: none;
  }
  ._bty-dup-comp-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  ._bty-dup-comp-name {
    font-size: 12px;
    color: rgba(255,255,255,0.8);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  ._bty-dup-comp-meta {
    font-size: 10px;
    color: rgba(255,255,255,0.4);
  }
  ._bty-dup-rec-badge {
    display: inline-flex;
    align-items: center;
    padding: 2px 7px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 600;
    white-space: nowrap;
    flex-shrink: 0;
  }
  @media (prefers-reduced-motion: reduce) {
    ._bty-dup-table-row { transition: none !important; }
  }
`;

export default async function CompanyDuplicatesPage() {
  let groups: CompanyDuplicateGroup[] = [];
  let generatedAt: string | null = null;
  let blockedReason: string | null = null;

  try {
    const response = await getCompanyDuplicates({ limit: 100 });
    groups = response.data.groups;
    generatedAt = response.data.generatedAt;
  } catch (error) {
    blockedReason = errorText(error);
  }

  const duplicateCompanies = groups.reduce((sum, group) => sum + group.duplicateCount, 0);

  return (
    <PageFrame
      code="CMP-DUP"
      title="重複公司資料檢查"
      sub={blockedReason ? "暫停" : "資料庫只讀檢查"}
      note="公司板 / 重複主檔；此頁只讀，不提供合併或刪除動作"
    >
      <style>{DUP_CSS}</style>

      {/* Hero KPI */}
      <div className="_bty-dup-kpi">
        <div className="_bty-dup-kpi-cell">
          <span className="_bty-dup-kpi-val" style={{ color: blockedReason ? "#ef5350" : "#4caf50" }}>
            {blockedReason ? "暫停" : "正常"}
          </span>
          <span className="_bty-dup-kpi-lbl">狀態</span>
        </div>
        <div className="_bty-dup-kpi-cell">
          <span className="_bty-dup-kpi-val" style={{ color: groups.length > 0 ? "#ffb800" : "#888" }}>
            {groups.length}
          </span>
          <span className="_bty-dup-kpi-lbl">重複群組</span>
        </div>
        <div className="_bty-dup-kpi-cell">
          <span className="_bty-dup-kpi-val">{duplicateCompanies}</span>
          <span className="_bty-dup-kpi-lbl">重複列</span>
        </div>
        <div className="_bty-dup-kpi-cell">
          <span className="_bty-dup-kpi-val" style={{ color: "#4fc3f7" }}>只讀</span>
          <span className="_bty-dup-kpi-lbl">操作</span>
        </div>
        {generatedAt && (
          <div className="_bty-dup-kpi-cell">
            <span className="_bty-dup-kpi-val" style={{ fontSize: 11 }}>{timeText(generatedAt)}</span>
            <span className="_bty-dup-kpi-lbl">更新時間</span>
          </div>
        )}
      </div>

      {blockedReason ? (
        <Panel code="DUP-SUM" title="重複資料總覽" right="暫停">
          <div className="terminal-note">
            暫停：重複資料報告暫時無法讀取。處理：資料庫去重流程。細節：{blockedReason}
          </div>
        </Panel>
      ) : groups.length === 0 ? (
        <Panel code="DUP-SUM" title="重複資料總覽" right="無資料">
          <div className="terminal-note">
            無資料：目前沒有偵測到重複公司主檔。
          </div>
        </Panel>
      ) : (
        <div className="_bty-dup-layout">
          {/* Summary table */}
          <Panel code="DUP-Q" title="重複群組" right={`${groups.length} 組`}>
            <div className="_bty-dup-table-head">
              <span>代號</span>
              <span>筆數</span>
              <span>保留候選</span>
              <span>關聯</span>
              <span>原因</span>
            </div>
            {groups.map((group) => {
              const recommended = group.companies.find((company) => company.companyId === group.recommendedCompanyId) ?? group.companies[0];
              return (
                <div className="_bty-dup-table-row" key={group.groupKey}>
                  <span className="_bty-dup-ticker">{group.ticker}</span>
                  <span className="_bty-dup-count">{group.duplicateCount}</span>
                  <span className="_bty-dup-name">{recommended ? safeCompanyName(recommended) : group.recommendedCompanyId}</span>
                  <span className="_bty-dup-rel">{recommended ? recommended.relationCount + recommended.keywordCount : 0}</span>
                  <span className="_bty-dup-reason">{reasonText(group.reason)}</span>
                </div>
              );
            })}
          </Panel>

          {/* Detail cards */}
          <div>
            {groups.slice(0, 4).map((group) => (
              <div className="_bty-dup-group-card" key={group.groupKey}>
                <div className="_bty-dup-group-header">
                  <span className="_bty-dup-group-ticker">{group.ticker}</span>
                  <span className="_bty-dup-group-count-badge">{group.duplicateCount} 筆</span>
                </div>
                <div className="_bty-dup-readonly-notice">
                  合併、非重複、忽略動作刻意隱藏；啟用前必須完成資料庫稽核、合併契約與備份確認。
                </div>
                {group.companies.map((company) => (
                  <DupCompanyRow
                    key={company.companyId}
                    company={company}
                    recommended={company.companyId === group.recommendedCompanyId}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </PageFrame>
  );
}

function DupCompanyRow({ company, recommended }: { company: CompanyDuplicateEntry; recommended: boolean }) {
  return (
    <div className="_bty-dup-company-row">
      <div className="_bty-dup-comp-info">
        <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
          <span className="_bty-dup-ticker" style={{ fontSize: 12 }}>{company.ticker}</span>
          <span className="_bty-dup-comp-name">{safeCompanyName(company)}</span>
        </div>
        <span className="_bty-dup-comp-meta">{company.market} / 關聯 {company.relationCount + company.keywordCount}</span>
      </div>
      {recommended ? (
        <span
          className="_bty-dup-rec-badge"
          style={{ background: "rgba(255,184,0,0.15)", color: "#ffb800", border: "1px solid rgba(255,184,0,0.3)" }}
        >
          保留候選
        </span>
      ) : (
        <span
          className="_bty-dup-rec-badge"
          style={{ background: "rgba(100,100,100,0.1)", color: "rgba(255,255,255,0.4)", border: "1px solid rgba(100,100,100,0.2)" }}
        >
          {tierText(company.beneficiaryTier)}
        </span>
      )}
    </div>
  );
}
