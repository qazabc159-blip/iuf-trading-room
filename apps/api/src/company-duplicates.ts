import type {
  Company,
  CompanyDuplicateEntry,
  CompanyDuplicateGroup,
  CompanyDuplicateReport,
  CompanyKeyword,
  CompanyRelation
} from "@iuf-trading-room/contracts";
import type { TradingRoomRepository } from "@iuf-trading-room/domain";

function normalizeName(value: string | undefined) {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gu, "");
}

const beneficiaryTierPriority: Record<Company["beneficiaryTier"], number> = {
  Core: 4,
  Direct: 3,
  Indirect: 2,
  Observation: 1
};

function buildRelationCountMap(relations: CompanyRelation[]) {
  const counts = new Map<string, number>();
  for (const relation of relations) {
    counts.set(relation.companyId, (counts.get(relation.companyId) ?? 0) + 1);
  }
  return counts;
}

function buildKeywordCountMap(keywords: CompanyKeyword[]) {
  const counts = new Map<string, number>();
  for (const keyword of keywords) {
    counts.set(keyword.companyId, (counts.get(keyword.companyId) ?? 0) + 1);
  }
  return counts;
}

function scoreDuplicateEntry(entry: CompanyDuplicateEntry) {
  return [
    entry.relationCount,
    entry.keywordCount,
    entry.themeCount,
    beneficiaryTierPriority[entry.beneficiaryTier],
    entry.country === "TW" ? 1 : 0,
    Date.parse(entry.updatedAt) || 0
  ] as const;
}

function compareDuplicateEntries(left: CompanyDuplicateEntry, right: CompanyDuplicateEntry) {
  const leftScore = scoreDuplicateEntry(left);
  const rightScore = scoreDuplicateEntry(right);

  for (let index = 0; index < leftScore.length; index += 1) {
    if (rightScore[index] !== leftScore[index]) {
      return rightScore[index] - leftScore[index];
    }
  }

  return left.companyId.localeCompare(right.companyId);
}

function recommendationReason(entry: CompanyDuplicateEntry) {
  if (entry.relationCount > 0 || entry.keywordCount > 0) {
    return "Has richer graph coverage and should stay as the canonical company card.";
  }

  if (entry.themeCount > 0) {
    return "Keeps stronger theme linkage and is the safer canonical record.";
  }

  if (beneficiaryTierPriority[entry.beneficiaryTier] >= beneficiaryTierPriority.Direct) {
    return "Has a stronger beneficiary tier classification.";
  }

  return "Most recent duplicate candidate after applying stable tie-break rules.";
}

export function buildCompanyDuplicateReport(input: {
  companies: Company[];
  relations: CompanyRelation[];
  keywords: CompanyKeyword[];
  limit?: number;
  query?: string;
  generatedAt?: string;
}): CompanyDuplicateReport {
  const limit = Math.max(1, Math.min(input.limit ?? 100, 500));
  const relationCounts = buildRelationCountMap(input.relations);
  const keywordCounts = buildKeywordCountMap(input.keywords);
  const needle = input.query?.trim().toLowerCase() ?? "";

  const groups = new Map<string, CompanyDuplicateEntry[]>();

  for (const company of input.companies) {
    const normalizedName = normalizeName(company.name);
    const groupKey = `${company.ticker}::${normalizedName}`;
    const entry: CompanyDuplicateEntry = {
      companyId: company.id,
      ticker: company.ticker,
      name: company.name,
      market: company.market,
      country: company.country,
      beneficiaryTier: company.beneficiaryTier,
      themeCount: company.themeIds.length,
      relationCount: relationCounts.get(company.id) ?? 0,
      keywordCount: keywordCounts.get(company.id) ?? 0,
      updatedAt: company.updatedAt
    };

    const current = groups.get(groupKey) ?? [];
    current.push(entry);
    groups.set(groupKey, current);
  }

  const duplicateGroups = [...groups.entries()]
    .filter(([, entries]) => entries.length >= 2)
    .map(([groupKey, entries]) => {
      const sortedEntries = [...entries].sort(compareDuplicateEntries);
      const recommended = sortedEntries[0]!;
      const normalizedName = groupKey.split("::")[1] ?? normalizeName(recommended.name);

      return {
        groupKey,
        ticker: recommended.ticker,
        normalizedName,
        duplicateCount: sortedEntries.length,
        recommendedCompanyId: recommended.companyId,
        reason: recommendationReason(recommended),
        companies: sortedEntries
      } satisfies CompanyDuplicateGroup;
    })
    .filter((group) => {
      if (!needle) {
        return true;
      }

      return [
        group.ticker.toLowerCase(),
        group.normalizedName,
        ...group.companies.flatMap((company) => [company.name.toLowerCase(), company.market.toLowerCase()])
      ].some((value) => value.includes(needle));
    })
    .sort((left, right) => {
      if (right.duplicateCount !== left.duplicateCount) {
        return right.duplicateCount - left.duplicateCount;
      }

      const leftGraph = left.companies.reduce((sum, company) => sum + company.relationCount + company.keywordCount, 0);
      const rightGraph = right.companies.reduce((sum, company) => sum + company.relationCount + company.keywordCount, 0);
      if (rightGraph !== leftGraph) {
        return rightGraph - leftGraph;
      }

      return left.ticker.localeCompare(right.ticker);
    })
    .slice(0, limit);

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    groups: duplicateGroups,
    summary: {
      groupCount: duplicateGroups.length,
      companyCount: duplicateGroups.reduce((sum, group) => sum + group.duplicateCount, 0)
    }
  };
}

export async function getCompanyDuplicateReport(input: {
  session: { workspace: { slug: string } };
  repo: TradingRoomRepository;
  limit?: number;
  query?: string;
}) {
  const workspaceSlug = input.session.workspace.slug;
  const [companies, relations, keywords] = await Promise.all([
    input.repo.listCompanies(undefined, { workspaceSlug }),
    input.repo.listWorkspaceCompanyRelations(undefined, { workspaceSlug }),
    input.repo.listWorkspaceCompanyKeywords(undefined, { workspaceSlug })
  ]);

  return buildCompanyDuplicateReport({
    companies,
    relations,
    keywords,
    limit: input.limit,
    query: input.query
  });
}
