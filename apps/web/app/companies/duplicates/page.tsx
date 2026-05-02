import type { CompanyDuplicateEntry, CompanyDuplicateGroup } from "@iuf-trading-room/contracts";
import { PageFrame, Panel } from "@/components/PageFrame";
import { getCompanyDuplicates } from "@/lib/api";
import { friendlyDataError } from "@/lib/friendly-error";

function errorText(error: unknown): string {
  return friendlyDataError(error, "重複資料報告暫時無法讀取。");
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
      title="公司重複資料檢查"
      sub={blockedReason ? "暫停" : "資料品質"}
      note="公司板 / 重複資料報告只讀；合併動作必須等資料庫稽核、備份確認與審核完成。"
    >
      <Panel code="DUP-SUM" title="重複資料總覽" right={blockedReason ? "暫停" : generatedAt ? `更新 ${timeText(generatedAt)}` : "無資料"}>
        {blockedReason ? (
          <div className="terminal-note">
            暫停：重複資料報告暫時無法讀取。負責：Jason + Mike。細節：{blockedReason}
          </div>
        ) : groups.length === 0 ? (
          <div className="terminal-note">
            無資料：正式資料庫目前沒有重複公司群組，不顯示假資料列。
          </div>
        ) : (
          <div className="metric-strip" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
            <Metric label="群組" value={groups.length} />
            <Metric label="公司" value={duplicateCompanies} />
            <Metric label="來源" value="正式資料庫" />
          </div>
        )}
      </Panel>

      <div className="company-grid">
        <Panel code="DUP-Q" title="候選重複群組" right={blockedReason ? "暫停" : `${groups.length} 組`}>
          {groups.length > 0 ? (
            <>
              <div className="row table-head" style={{ gridTemplateColumns: "92px 84px 1fr 74px 1fr", gap: 10 }}>
                <span>代號</span>
                <span>筆數</span>
                <span>建議保留</span>
                <span>關聯</span>
                <span>原因</span>
              </div>
              {groups.map((group) => {
                const recommended = group.companies.find((company) => company.companyId === group.recommendedCompanyId) ?? group.companies[0];
                return (
                  <div className="row" key={group.groupKey} style={{ gridTemplateColumns: "92px 84px 1fr 74px 1fr", gap: 10, minHeight: 62 }}>
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
              {blockedReason ? "暫停：API 無法讀取時不顯示重複資料佇列。" : "無資料：目前沒有需要檢查的重複群組。"}
            </div>
          )}
        </Panel>

        <div>
          {groups.slice(0, 4).map((group) => (
            <Panel code="DUP-GRP" title={`${group.ticker} / ${group.duplicateCount} 筆`} right="只讀" key={group.groupKey}>
              <div className="terminal-note" style={{ marginBottom: 12 }}>
                暫停：合併、非重複、忽略動作刻意隱藏。啟用前必須完成 Mike 資料庫稽核、Jason 合併契約、備份確認與 Pete 審核。
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
    <div className="row" style={{ gridTemplateColumns: "92px 1fr 88px 72px 92px", gap: 10, padding: "9px 0" }}>
      <span className="tg gold">{company.ticker}</span>
      <span className="tc">{company.name}</span>
      <span className="tg">{company.market}</span>
      <span className="num">{company.relationCount + company.keywordCount}</span>
      <span className={`tg ${recommended ? "gold" : "soft"}`}>{recommended ? "建議保留" : company.beneficiaryTier}</span>
    </div>
  );
}
