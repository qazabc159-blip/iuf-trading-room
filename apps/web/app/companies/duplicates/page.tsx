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
      <Panel code="DUP-SUM" title="重複資料總覽" right={blockedReason ? "暫停" : generatedAt ? `更新 ${timeText(generatedAt)}` : "無資料"}>
        {blockedReason ? (
          <div className="terminal-note">
            暫停：重複資料報告暫時無法讀取。處理：資料庫去重流程。細節：{blockedReason}
          </div>
        ) : groups.length === 0 ? (
          <div className="terminal-note">
            無資料：目前沒有偵測到重複公司主檔。
          </div>
        ) : (
          <div className="metric-strip" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
            <Metric label="群組" value={groups.length} />
            <Metric label="重複列" value={duplicateCompanies} />
            <Metric label="動作" value="只讀" />
          </div>
        )}
      </Panel>

      <div className="company-grid">
        <Panel code="DUP-Q" title="重複群組" right={blockedReason ? "暫停" : `${groups.length} 組`}>
          {groups.length > 0 ? (
            <>
              <div className="row table-head" style={{ gridTemplateColumns: "92px 84px 1fr 74px 1fr", gap: 12 }}>
                <span>代號</span>
                <span>筆數</span>
                <span>保留候選</span>
                <span>關聯</span>
                <span>原因</span>
              </div>
              {groups.map((group) => {
                const recommended = group.companies.find((company) => company.companyId === group.recommendedCompanyId) ?? group.companies[0];
                return (
                  <div className="row" key={group.groupKey} style={{ gridTemplateColumns: "92px 84px 1fr 74px 1fr", gap: 12, minHeight: 66 }}>
                    <span className="tg gold">{group.ticker}</span>
                    <span className="num">{group.duplicateCount}</span>
                    <span className="tc">{recommended?.name ?? group.recommendedCompanyId}</span>
                    <span className="num">{recommended ? recommended.relationCount + recommended.keywordCount : 0}</span>
                    <span className="tg soft">{group.reason}</span>
                  </div>
                );
              })}
            </>
          ) : (
            <div className="terminal-note">
              {blockedReason ? "暫停：尚未取得可顯示的重複資料。" : "無資料：目前沒有重複公司群組。"}
            </div>
          )}
        </Panel>

        <div>
          {groups.slice(0, 4).map((group) => (
            <Panel code="DUP-GRP" title={`${group.ticker} / ${group.duplicateCount} 筆`} right="只讀" key={group.groupKey}>
              <div className="terminal-note" style={{ marginBottom: 14 }}>
                暫停：合併、非重複、忽略動作刻意隱藏。啟用前必須完成資料庫稽核、合併契約、備份確認與審核。
              </div>
              {group.companies.map((company) => (
                <CompanyRow key={company.companyId} company={company} recommended={company.companyId === group.recommendedCompanyId} />
              ))}
            </Panel>
          ))}
        </div>
      </div>
    </PageFrame>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="metric-cell">
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
    </div>
  );
}

function CompanyRow({ company, recommended }: { company: CompanyDuplicateEntry; recommended: boolean }) {
  return (
    <div className="row" style={{ gridTemplateColumns: "92px 1fr 88px 72px 92px", gap: 12, padding: "12px 0" }}>
      <span className="tg gold">{company.ticker}</span>
      <span className="tc">{company.name}</span>
      <span className="tg">{company.market}</span>
      <span className="num">{company.relationCount + company.keywordCount}</span>
      <span className={`tg ${recommended ? "gold" : "soft"}`}>{recommended ? "保留候選" : company.beneficiaryTier}</span>
    </div>
  );
}
