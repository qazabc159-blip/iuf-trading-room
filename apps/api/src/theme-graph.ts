import type {
  Company,
  CompanyKeyword,
  CompanyRelation,
  Theme,
  ThemeGraphEdge,
  ThemeGraphKeywordRollup,
  ThemeGraphView
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

function companyNodeId(companyId: string) {
  return `company:${companyId}`;
}

function externalNodeId(label: string) {
  return `external:${normalizeLabel(label) || label}`;
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

type ProjectedRelation = {
  relation: CompanyRelation;
  sourceCompany: Company;
  targetCompany: Company | undefined;
  direction: ThemeGraphEdge["direction"];
};

function directionPriority(direction: ThemeGraphEdge["direction"]) {
  switch (direction) {
    case "internal":
      return 0;
    case "outbound":
      return 1;
    case "inbound":
      return 2;
    default:
      return 3;
  }
}

function relationSort(left: ProjectedRelation, right: ProjectedRelation) {
  const directionDelta = directionPriority(left.direction) - directionPriority(right.direction);
  if (directionDelta !== 0) {
    return directionDelta;
  }

  if (right.relation.confidence !== left.relation.confidence) {
    return right.relation.confidence - left.relation.confidence;
  }

  return left.relation.targetLabel.localeCompare(right.relation.targetLabel);
}

function resolveTargetCompany(input: {
  relation: CompanyRelation;
  companiesById: Map<string, Company>;
  themeCompaniesByLabel: Map<string, Company>;
}) {
  if (input.relation.targetCompanyId) {
    return input.companiesById.get(input.relation.targetCompanyId);
  }

  return input.themeCompaniesByLabel.get(normalizeLabel(input.relation.targetLabel));
}

export function buildThemeGraphView(input: {
  theme: Theme;
  themeCompanies: Company[];
  companies: Company[];
  relations: CompanyRelation[];
  keywords: CompanyKeyword[];
  edgeLimit?: number;
  keywordLimit?: number;
  generatedAt?: string;
}): ThemeGraphView {
  const edgeLimit = clamp(input.edgeLimit ?? 160, 1, 400);
  const keywordLimit = clamp(input.keywordLimit ?? 24, 1, 100);
  const themeCompanyIds = new Set(input.themeCompanies.map((company) => company.id));
  const themeCompaniesByLabel = new Map(
    input.themeCompanies.map((company) => [normalizeLabel(company.name), company] as const)
  );
  const companiesById = new Map(input.companies.map((company) => [company.id, company]));
  const relationCounts = buildRelationCountMap(input.relations);
  const keywordCounts = buildKeywordCountMap(input.keywords);

  const relevantRelations = input.relations
    .map((relation) => {
      const sourceCompany = companiesById.get(relation.companyId);
      if (!sourceCompany) {
        return null;
      }

      const sourceIsTheme = themeCompanyIds.has(sourceCompany.id);
      const resolvedTargetCompany = resolveTargetCompany({
        relation,
        companiesById,
        themeCompaniesByLabel
      });
      const targetIsTheme = resolvedTargetCompany ? themeCompanyIds.has(resolvedTargetCompany.id) : false;

      if (!sourceIsTheme && !targetIsTheme) {
        return null;
      }

      const direction: ThemeGraphEdge["direction"] =
        sourceIsTheme && targetIsTheme ? "internal" : sourceIsTheme ? "outbound" : "inbound";

      return {
        relation,
        sourceCompany,
        targetCompany: resolvedTargetCompany,
        direction
      } satisfies ProjectedRelation;
    })
    .filter((item): item is ProjectedRelation => item !== null)
    .sort(relationSort);

  const selectedRelations = relevantRelations.slice(0, edgeLimit);
  const nodes = new Map<string, ThemeGraphView["nodes"][number]>();

  for (const themeCompany of input.themeCompanies) {
    nodes.set(companyNodeId(themeCompany.id), {
      id: companyNodeId(themeCompany.id),
      kind: "theme_company",
      companyId: themeCompany.id,
      label: themeCompany.name,
      ticker: themeCompany.ticker,
      market: themeCompany.market,
      beneficiaryTier: themeCompany.beneficiaryTier,
      relationCount: relationCounts.get(themeCompany.id) ?? 0,
      keywordCount: keywordCounts.get(themeCompany.id) ?? 0
    });
  }

  const edges = selectedRelations.map((item) => {
    const sourceNodeId = companyNodeId(item.sourceCompany.id);

    if (!nodes.has(sourceNodeId)) {
      nodes.set(sourceNodeId, {
        id: sourceNodeId,
        kind: themeCompanyIds.has(item.sourceCompany.id) ? "theme_company" : "company",
        companyId: item.sourceCompany.id,
        label: item.sourceCompany.name,
        ticker: item.sourceCompany.ticker,
        market: item.sourceCompany.market,
        beneficiaryTier: item.sourceCompany.beneficiaryTier,
        relationCount: relationCounts.get(item.sourceCompany.id) ?? 0,
        keywordCount: keywordCounts.get(item.sourceCompany.id) ?? 0
      });
    }

    const targetNodeId = item.targetCompany
      ? companyNodeId(item.targetCompany.id)
      : externalNodeId(item.relation.targetLabel);

    if (!nodes.has(targetNodeId)) {
      if (item.targetCompany) {
        nodes.set(targetNodeId, {
          id: targetNodeId,
          kind: themeCompanyIds.has(item.targetCompany.id) ? "theme_company" : "company",
          companyId: item.targetCompany.id,
          label: item.targetCompany.name,
          ticker: item.targetCompany.ticker,
          market: item.targetCompany.market,
          beneficiaryTier: item.targetCompany.beneficiaryTier,
          relationCount: relationCounts.get(item.targetCompany.id) ?? 0,
          keywordCount: keywordCounts.get(item.targetCompany.id) ?? 0
        });
      } else {
        nodes.set(targetNodeId, {
          id: targetNodeId,
          kind: "external_label",
          companyId: null,
          label: item.relation.targetLabel,
          relationCount: 0,
          keywordCount: 0
        });
      }
    }

    return {
      id: `edge:${item.relation.id}`,
      relationId: item.relation.id,
      sourceNodeId,
      targetNodeId,
      direction: item.direction,
      relationType: item.relation.relationType,
      confidence: item.relation.confidence,
      sourcePath: item.relation.sourcePath
    } satisfies ThemeGraphEdge;
  });

  const themeKeywords = input.keywords.filter((keyword) => themeCompanyIds.has(keyword.companyId));
  const keywordRollups = [
    ...themeKeywords.reduce<Map<string, { count: number; companyIds: Set<string> }>>((rollups, keyword) => {
      const current = rollups.get(keyword.label) ?? { count: 0, companyIds: new Set<string>() };
      current.count += 1;
      current.companyIds.add(keyword.companyId);
      rollups.set(keyword.label, current);
      return rollups;
    }, new Map())
  ]
    .map(([label, meta]) => ({
      label,
      count: meta.count,
      companyCount: meta.companyIds.size
    } satisfies ThemeGraphKeywordRollup))
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }

      if (right.companyCount !== left.companyCount) {
        return right.companyCount - left.companyCount;
      }

      return left.label.localeCompare(right.label);
    })
    .slice(0, keywordLimit);

  const externalLabels = [...nodes.values()].filter((node) => node.kind === "external_label").length;
  const relatedCompanyCount = [...nodes.values()].filter((node) => node.kind === "company").length;

  return {
    themeId: input.theme.id,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    nodes: [...nodes.values()],
    edges,
    topKeywords: keywordRollups,
    summary: {
      themeCompanyCount: input.themeCompanies.length,
      relatedCompanyCount,
      internalEdges: relevantRelations.filter((item) => item.direction === "internal").length,
      outboundEdges: relevantRelations.filter((item) => item.direction === "outbound").length,
      inboundEdges: relevantRelations.filter((item) => item.direction === "inbound").length,
      externalLabels,
      displayedEdges: edges.length,
      totalMatchingEdges: relevantRelations.length,
      keywordCount: themeKeywords.length
    }
  };
}

export async function getThemeGraphView(input: {
  session: { workspace: { slug: string } };
  repo: TradingRoomRepository;
  themeId: string;
  edgeLimit?: number;
  keywordLimit?: number;
}) {
  const workspaceSlug = input.session.workspace.slug;
  const [theme, themeCompanies, companies, relations, keywords] = await Promise.all([
    input.repo.getTheme(input.themeId, { workspaceSlug }),
    input.repo.listCompanies(input.themeId, { workspaceSlug }),
    input.repo.listCompanies(undefined, { workspaceSlug }),
    input.repo.listWorkspaceCompanyRelations(undefined, { workspaceSlug }),
    input.repo.listWorkspaceCompanyKeywords(undefined, { workspaceSlug })
  ]);

  if (!theme) {
    return null;
  }

  return buildThemeGraphView({
    theme,
    themeCompanies,
    companies,
    relations,
    keywords,
    edgeLimit: input.edgeLimit,
    keywordLimit: input.keywordLimit
  });
}
