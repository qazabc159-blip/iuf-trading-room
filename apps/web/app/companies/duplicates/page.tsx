import type { CompanyDuplicateEntry, CompanyDuplicateGroup } from "@iuf-trading-room/contracts";
import { PageFrame, Panel } from "@/components/PageFrame";
import { getCompanyDuplicates } from "@/lib/api";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
      title="Company Duplicate Review"
      sub={blockedReason ? "BLOCKED" : "Data Quality"}
      note="[CMP-DUP] Read-only duplicate report from /api/v1/companies/duplicates. Merge actions stay blocked until migration/audit approval."
    >
      <Panel code="DUP-SUM" title="Duplicate Report" right={blockedReason ? "BLOCKED" : generatedAt ? `UPDATED ${timeText(generatedAt)}` : "EMPTY"}>
        {blockedReason ? (
          <div className="terminal-note">
            BLOCKED: duplicate report API unavailable. Owner: Jason + Mike. Detail: {blockedReason}
          </div>
        ) : groups.length === 0 ? (
          <div className="terminal-note">
            EMPTY: /api/v1/companies/duplicates returned zero duplicate groups. No mock duplicate rows are rendered.
          </div>
        ) : (
          <div className="metric-strip" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
            <Metric label="GROUPS" value={groups.length} />
            <Metric label="COMPANIES" value={duplicateCompanies} />
            <Metric label="SOURCE" value="API / DB" />
          </div>
        )}
      </Panel>

      <div className="company-grid">
        <Panel code="DUP-Q" title="Candidate Groups" right={blockedReason ? "BLOCKED" : `${groups.length} GROUPS`}>
          {groups.length > 0 ? (
            <>
              <div className="row table-head" style={{ gridTemplateColumns: "92px 84px 1fr 74px 1fr", gap: 10 }}>
                <span>Ticker</span>
                <span>Count</span>
                <span>Recommended Canonical</span>
                <span>Graph</span>
                <span>Reason</span>
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
              {blockedReason ? "BLOCKED: no duplicate queue is shown while the API is unavailable." : "EMPTY: no duplicate groups to review."}
            </div>
          )}
        </Panel>

        <div>
          {groups.slice(0, 4).map((group) => (
            <Panel code="DUP-GRP" title={`${group.ticker} / ${group.duplicateCount} records`} right="READ ONLY" key={group.groupKey}>
              <div className="terminal-note" style={{ marginBottom: 12 }}>
                BLOCKED: merge / not-duplicate / ignore actions are intentionally hidden. Required before enablement: Mike migration audit, Jason merge contract, backup ACK, and Pete review.
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
      <span className={`tg ${recommended ? "gold" : "soft"}`}>{recommended ? "CANONICAL" : company.beneficiaryTier}</span>
    </div>
  );
}
