import type {
  Company,
  CompanyGraphEdge,
  CompanyGraphSearchResult,
  CompanyGraphStats,
  CompanyGraphView,
  CompanyKeyword,
  CompanyRelation
} from "@iuf-trading-room/contracts";
import type { TradingRoomRepository } from "@iuf-trading-room/domain";

function normalizeLabel(value: string | undefined) {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gu, "");
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max));
}

function relationSort(left: CompanyRelation, right: CompanyRelation) {
  if (right.confidence !== left.confidence) {
    return right.confidence - left.confidence;
  }

  return left.targetLabel.localeCompare(right.targetLabel);
}

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

function companyNodeId(companyId: string) {
  return `company:${companyId}`;
}

function externalNodeId(label: string) {
  return `external:${normalizeLabel(label) || label}`;
}

function computeSearchScore(value: string, query: string) {
  const haystack = value.toLowerCase();
  const needle = query.toLowerCase();

  if (haystack === needle) {
    return 10;
  }

  if (haystack.startsWith(needle)) {
    return 6;
  }

  if (haystack.includes(needle)) {
    return 3;
  }

  return 0;
}

const beneficiaryTierPriority: Record<Company["beneficiaryTier"], number> = {
  Core: 4,
  Direct: 3,
  Indirect: 2,
  Observation: 1
};

function companySearchDedupeKey(item: CompanyGraphSearchResult) {
  return `${item.ticker}::${normalizeLabel(item.name)}`;
}

function choosePreferredSearchResult(
  current: CompanyGraphSearchResult,
  candidate: CompanyGraphSearchResult
) {
  if (candidate.score !== current.score) {
    return candidate.score > current.score ? candidate : current;
  }

  if (candidate.relationCount !== current.relationCount) {
    return candidate.relationCount > current.relationCount ? candidate : current;
  }

  if (candidate.keywordCount !== current.keywordCount) {
    return candidate.keywordCount > current.keywordCount ? candidate : current;
  }

  if (
    beneficiaryTierPriority[candidate.beneficiaryTier] !==
    beneficiaryTierPriority[current.beneficiaryTier]
  ) {
    return beneficiaryTierPriority[candidate.beneficiaryTier] >
      beneficiaryTierPriority[current.beneficiaryTier]
      ? candidate
      : current;
  }

  return candidate.country === "TW" && current.country !== "TW" ? candidate : current;
}

export function buildCompanyGraphView(input: {
  focusCompany: Company;
  companies: Company[];
  relations: CompanyRelation[];
  keywords: CompanyKeyword[];
  limit?: number;
  keywordLimit?: number;
  generatedAt?: string;
}): CompanyGraphView {
  const limit = clamp(input.limit ?? 80, 1, 240);
  const keywordLimit = clamp(input.keywordLimit ?? 20, 1, 100);
  const companiesById = new Map(input.companies.map((company) => [company.id, company]));
  const relationCounts = buildRelationCountMap(input.relations);
  const keywordCounts = buildKeywordCountMap(input.keywords);
  const focusLabel = normalizeLabel(input.focusCompany.name);

  const outboundRelations = input.relations
    .filter((relation) => relation.companyId === input.focusCompany.id)
    .sort(relationSort);

  const inboundRelations = input.relations
    .filter(
      (relation) =>
        relation.companyId !== input.focusCompany.id &&
        (relation.targetCompanyId === input.focusCompany.id ||
          normalizeLabel(relation.targetLabel) === focusLabel)
    )
    .sort(relationSort);

  const selectedOutbound = outboundRelations.slice(0, limit);
  const remaining = Math.max(0, limit - selectedOutbound.length);
  const selectedInbound = inboundRelations.slice(0, remaining);
  const selectedRelations = [...selectedOutbound, ...selectedInbound];

  const nodes = new Map<string, CompanyGraphView["nodes"][number]>();

  nodes.set(companyNodeId(input.focusCompany.id), {
    id: companyNodeId(input.focusCompany.id),
    kind: "focus_company",
    companyId: input.focusCompany.id,
    label: input.focusCompany.name,
    ticker: input.focusCompany.ticker,
    market: input.focusCompany.market,
    beneficiaryTier: input.focusCompany.beneficiaryTier,
    relationCount: relationCounts.get(input.focusCompany.id) ?? 0,
    keywordCount: keywordCounts.get(input.focusCompany.id) ?? 0
  });

  const edges: CompanyGraphEdge[] = selectedRelations.map((relation) => {
    const sourceCompany = companiesById.get(relation.companyId);
    const targetCompany = relation.targetCompanyId
      ? companiesById.get(relation.targetCompanyId)
      : undefined;

    const sourceNodeId = companyNodeId(relation.companyId);
    const targetNodeId = targetCompany
      ? companyNodeId(targetCompany.id)
      : externalNodeId(relation.targetLabel);

    if (!nodes.has(sourceNodeId) && sourceCompany) {
      nodes.set(sourceNodeId, {
        id: sourceNodeId,
        kind: relation.companyId === input.focusCompany.id ? "focus_company" : "company",
        companyId: sourceCompany.id,
        label: sourceCompany.name,
        ticker: sourceCompany.ticker,
        market: sourceCompany.market,
        beneficiaryTier: sourceCompany.beneficiaryTier,
        relationCount: relationCounts.get(sourceCompany.id) ?? 0,
        keywordCount: keywordCounts.get(sourceCompany.id) ?? 0
      });
    }

    if (!nodes.has(targetNodeId)) {
      if (targetCompany) {
        nodes.set(targetNodeId, {
          id: targetNodeId,
          kind: targetCompany.id === input.focusCompany.id ? "focus_company" : "company",
          companyId: targetCompany.id,
          label: targetCompany.name,
          ticker: targetCompany.ticker,
          market: targetCompany.market,
          beneficiaryTier: targetCompany.beneficiaryTier,
          relationCount: relationCounts.get(targetCompany.id) ?? 0,
          keywordCount: keywordCounts.get(targetCompany.id) ?? 0
        });
      } else {
        nodes.set(targetNodeId, {
          id: targetNodeId,
          kind: "external_label",
          companyId: null,
          label: relation.targetLabel,
          relationCount: 0,
          keywordCount: 0
        });
      }
    }

    const direction: CompanyGraphEdge["direction"] =
      relation.companyId === input.focusCompany.id ? "outbound" : "inbound";

    return {
      id: `edge:${relation.id}`,
      relationId: relation.id,
      sourceNodeId,
      targetNodeId,
      direction,
      relationType: relation.relationType,
      confidence: relation.confidence,
      sourcePath: relation.sourcePath
    };
  });

  const internalLinks = edges.filter((edge) => nodes.get(edge.targetNodeId)?.companyId).length;
  const focusKeywords = [...input.keywords]
    .filter((keyword) => keyword.companyId === input.focusCompany.id)
    .sort((left, right) => {
      if (right.confidence !== left.confidence) {
        return right.confidence - left.confidence;
      }

      return left.label.localeCompare(right.label);
    })
    .slice(0, keywordLimit);

  return {
    focusCompanyId: input.focusCompany.id,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    nodes: [...nodes.values()],
    edges,
    keywords: focusKeywords,
    summary: {
      outboundRelations: outboundRelations.length,
      inboundRelations: inboundRelations.length,
      internalLinks,
      externalLinks: edges.length - internalLinks,
      keywords: input.keywords.filter((keyword) => keyword.companyId === input.focusCompany.id).length
    }
  };
}

export function buildCompanyGraphSearchResults(input: {
  query: string;
  companies: Company[];
  relations: CompanyRelation[];
  keywords: CompanyKeyword[];
  limit?: number;
}): CompanyGraphSearchResult[] {
  const needle = input.query.trim().toLowerCase();
  if (!needle) {
    return [];
  }

  const limit = clamp(input.limit ?? 20, 1, 100);
  const relationCounts = buildRelationCountMap(input.relations);
  const keywordCounts = buildKeywordCountMap(input.keywords);
  const keywordsByCompany = new Map<string, CompanyKeyword[]>();
  const relationsByCompany = new Map<string, CompanyRelation[]>();

  for (const keyword of input.keywords) {
    const current = keywordsByCompany.get(keyword.companyId) ?? [];
    current.push(keyword);
    keywordsByCompany.set(keyword.companyId, current);
  }

  for (const relation of input.relations) {
    const current = relationsByCompany.get(relation.companyId) ?? [];
    current.push(relation);
    relationsByCompany.set(relation.companyId, current);
  }

  const rawResults = input.companies
    .map((company) => {
      const matchedBy = new Set<CompanyGraphSearchResult["matchedBy"][number]>();
      let score = 0;

      const tickerScore = computeSearchScore(company.ticker, needle);
      if (tickerScore > 0) {
        matchedBy.add("ticker");
        score += tickerScore + 2;
      }

      const nameScore = computeSearchScore(company.name, needle);
      if (nameScore > 0) {
        matchedBy.add("name");
        score += nameScore + 1;
      }

      const keywordMatch = (keywordsByCompany.get(company.id) ?? []).some(
        (keyword) => computeSearchScore(keyword.label, needle) > 0
      );
      if (keywordMatch) {
        matchedBy.add("keyword");
        score += 2;
      }

      const relationMatch = (relationsByCompany.get(company.id) ?? []).some(
        (relation) => computeSearchScore(relation.targetLabel, needle) > 0
      );
      if (relationMatch) {
        matchedBy.add("relation");
        score += 1;
      }

      if (matchedBy.size === 0) {
        return null;
      }

      return {
        companyId: company.id,
        ticker: company.ticker,
        name: company.name,
        market: company.market,
        country: company.country,
        beneficiaryTier: company.beneficiaryTier,
        chainPosition: company.chainPosition,
        relationCount: relationCounts.get(company.id) ?? 0,
        keywordCount: keywordCounts.get(company.id) ?? 0,
        matchedBy: [...matchedBy],
        score
      } satisfies CompanyGraphSearchResult;
    })
    .filter((item): item is CompanyGraphSearchResult => item !== null)
    .reduce<Map<string, CompanyGraphSearchResult>>((deduped, item) => {
      const key = companySearchDedupeKey(item);
      const existing = deduped.get(key);

      deduped.set(key, existing ? choosePreferredSearchResult(existing, item) : item);
      return deduped;
    }, new Map());

  return [...rawResults.values()]
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      if (right.relationCount !== left.relationCount) {
        return right.relationCount - left.relationCount;
      }

      return left.ticker.localeCompare(right.ticker);
    })
    .slice(0, limit);
}

export function buildCompanyGraphStatsView(input: {
  companies: Company[];
  relations: CompanyRelation[];
  keywords: CompanyKeyword[];
  topLimit?: number;
  generatedAt?: string;
}): CompanyGraphStats {
  const topLimit = clamp(input.topLimit ?? 20, 1, 100);
  const relationCounts = buildRelationCountMap(input.relations);
  const keywordCounts = buildKeywordCountMap(input.keywords);
  const relationTypeCounts = new Map<CompanyRelation["relationType"], number>();
  const keywordCountsByLabel = new Map<string, number>();

  for (const relation of input.relations) {
    relationTypeCounts.set(
      relation.relationType,
      (relationTypeCounts.get(relation.relationType) ?? 0) + 1
    );
  }

  for (const keyword of input.keywords) {
    keywordCountsByLabel.set(keyword.label, (keywordCountsByLabel.get(keyword.label) ?? 0) + 1);
  }

  const companiesWithGraph = input.companies.filter(
    (company) => (relationCounts.get(company.id) ?? 0) > 0 || (keywordCounts.get(company.id) ?? 0) > 0
  ).length;

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    companiesWithGraph,
    totalRelations: input.relations.length,
    totalKeywords: input.keywords.length,
    relationTypes: [...relationTypeCounts.entries()]
      .map(([relationType, count]) => ({ relationType, count }))
      .sort((left, right) => right.count - left.count || left.relationType.localeCompare(right.relationType)),
    topKeywords: [...keywordCountsByLabel.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
      .slice(0, topLimit),
    topConnectedCompanies: input.companies
      .map((company) => ({
        companyId: company.id,
        ticker: company.ticker,
        name: company.name,
        relationCount: relationCounts.get(company.id) ?? 0,
        keywordCount: keywordCounts.get(company.id) ?? 0
      }))
      .filter((company) => company.relationCount > 0 || company.keywordCount > 0)
      .sort((left, right) => {
        if (right.relationCount !== left.relationCount) {
          return right.relationCount - left.relationCount;
        }

        if (right.keywordCount !== left.keywordCount) {
          return right.keywordCount - left.keywordCount;
        }

        return left.ticker.localeCompare(right.ticker);
      })
      .slice(0, topLimit)
  };
}

export async function getCompanyGraphView(input: {
  session: { workspace: { slug: string } };
  repo: TradingRoomRepository;
  companyId: string;
  limit?: number;
  keywordLimit?: number;
}) {
  const workspaceSlug = input.session.workspace.slug;
  const [focusCompany, companies, relations, keywords] = await Promise.all([
    input.repo.getCompany(input.companyId, { workspaceSlug }),
    input.repo.listCompanies(undefined, { workspaceSlug }),
    input.repo.listWorkspaceCompanyRelations(undefined, { workspaceSlug }),
    input.repo.listWorkspaceCompanyKeywords(undefined, { workspaceSlug })
  ]);

  if (!focusCompany) {
    return null;
  }

  return buildCompanyGraphView({
    focusCompany,
    companies,
    relations,
    keywords,
    limit: input.limit,
    keywordLimit: input.keywordLimit
  });
}

export async function getCompanyGraphSearchResults(input: {
  session: { workspace: { slug: string } };
  repo: TradingRoomRepository;
  query: string;
  limit?: number;
}) {
  const workspaceSlug = input.session.workspace.slug;
  const [companies, relations, keywords] = await Promise.all([
    input.repo.listCompanies(undefined, { workspaceSlug }),
    input.repo.listWorkspaceCompanyRelations(undefined, { workspaceSlug }),
    input.repo.listWorkspaceCompanyKeywords(undefined, { workspaceSlug })
  ]);

  return buildCompanyGraphSearchResults({
    query: input.query,
    companies,
    relations,
    keywords,
    limit: input.limit
  });
}

export async function getCompanyGraphStats(input: {
  session: { workspace: { slug: string } };
  repo: TradingRoomRepository;
  topLimit?: number;
}) {
  const workspaceSlug = input.session.workspace.slug;
  const [companies, relations, keywords] = await Promise.all([
    input.repo.listCompanies(undefined, { workspaceSlug }),
    input.repo.listWorkspaceCompanyRelations(undefined, { workspaceSlug }),
    input.repo.listWorkspaceCompanyKeywords(undefined, { workspaceSlug })
  ]);

  return buildCompanyGraphStatsView({
    companies,
    relations,
    keywords,
    topLimit: input.topLimit
  });
}
