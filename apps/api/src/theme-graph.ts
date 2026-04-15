import type {
  Company,
  CompanyKeyword,
  CompanyRelation,
  Theme,
  ThemeGraphEdge,
  ThemeGraphKeywordRollup,
  ThemeGraphSearchView,
  ThemeGraphStatsTheme,
  ThemeGraphStatsView,
  ThemeGraphView
} from "@iuf-trading-room/contracts";
import type { TradingRoomRepository } from "@iuf-trading-room/domain";

type ThemeGraphFilters = {
  query?: string;
  marketState?: Theme["marketState"];
  lifecycle?: Theme["lifecycle"];
  minEdges?: number;
  onlyConnected?: boolean;
};

type ThemeGraphCatalogEntry = {
  theme: Theme;
  themeCompanies: Company[];
  view: ThemeGraphView;
  summary: ThemeGraphStatsTheme;
};

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

function buildThemeStatsEntry(input: {
  theme: Theme;
  view: ThemeGraphView;
  keywordLimit?: number;
}): ThemeGraphStatsTheme {
  return {
    themeId: input.theme.id,
    name: input.theme.name,
    marketState: input.theme.marketState,
    lifecycle: input.theme.lifecycle,
    priority: input.theme.priority,
    themeCompanyCount: input.view.summary.themeCompanyCount,
    relatedCompanyCount: input.view.summary.relatedCompanyCount,
    totalEdges: input.view.summary.totalMatchingEdges,
    keywordCount: input.view.summary.keywordCount,
    topKeywords: input.view.topKeywords.slice(0, clamp(input.keywordLimit ?? 5, 1, 5))
  };
}

async function loadThemeGraphWorkspaceContext(input: {
  session: { workspace: { slug: string } };
  repo: TradingRoomRepository;
}) {
  const workspaceSlug = input.session.workspace.slug;

  const [themes, companies, relations, keywords] = await Promise.all([
    input.repo.listThemes({ workspaceSlug }),
    input.repo.listCompanies(undefined, { workspaceSlug }),
    input.repo.listWorkspaceCompanyRelations(undefined, { workspaceSlug }),
    input.repo.listWorkspaceCompanyKeywords(undefined, { workspaceSlug })
  ]);

  return {
    themes,
    companies,
    relations,
    keywords
  };
}

function normalizeSearchText(value: string) {
  return normalizeLabel(value);
}

function includesQuery(value: string, query: string) {
  return normalizeSearchText(value).includes(query);
}

function buildThemeSearchText(input: {
  theme: Theme;
  themeCompanies: Company[];
  view: ThemeGraphView;
}) {
  return [
    input.theme.name,
    input.theme.thesis,
    input.theme.whyNow,
    input.theme.bottleneck,
    ...input.themeCompanies.flatMap((company) => [
      company.name,
      company.ticker,
      company.chainPosition,
      company.notes
    ]),
    ...input.view.topKeywords.map((keyword) => keyword.label),
    ...input.view.nodes.map((node) => node.label)
  ].join(" ");
}

function matchesThemeFilters(
  entry: ThemeGraphCatalogEntry,
  filters: ThemeGraphFilters,
  queryOverride?: string
) {
  if (filters.marketState && entry.theme.marketState !== filters.marketState) {
    return false;
  }

  if (filters.lifecycle && entry.theme.lifecycle !== filters.lifecycle) {
    return false;
  }

  if (filters.onlyConnected && entry.summary.totalEdges <= 0) {
    return false;
  }

  if (filters.minEdges && entry.summary.totalEdges < filters.minEdges) {
    return false;
  }

  const query = normalizeSearchText(queryOverride ?? filters.query ?? "");
  if (!query) {
    return true;
  }

  return includesQuery(buildThemeSearchText(entry), query);
}

function projectThemeGraphCatalog(input: {
  themes: Theme[];
  companies: Company[];
  relations: CompanyRelation[];
  keywords: CompanyKeyword[];
  keywordLimit: number;
  filters?: ThemeGraphFilters;
  edgeLimit?: number;
}) {
  return input.themes
    .map((theme) => {
      const themeCompanies = input.companies.filter((company) => company.themeIds.includes(theme.id));
      const view = buildThemeGraphView({
        theme,
        themeCompanies,
        companies: input.companies,
        relations: input.relations,
        keywords: input.keywords,
        edgeLimit: input.edgeLimit ?? 400,
        keywordLimit: 24
      });

      return {
        theme,
        themeCompanies,
        view,
        summary: buildThemeStatsEntry({
          theme,
          view,
          keywordLimit: input.keywordLimit
        })
      } satisfies ThemeGraphCatalogEntry;
    })
    .filter((entry) => matchesThemeFilters(entry, input.filters ?? {}));
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

export async function getThemeGraphStats(input: {
  session: { workspace: { slug: string } };
  repo: TradingRoomRepository;
  limit?: number;
  keywordLimit?: number;
  query?: string;
  marketState?: Theme["marketState"];
  lifecycle?: Theme["lifecycle"];
  minEdges?: number;
  onlyConnected?: boolean;
}): Promise<ThemeGraphStatsView> {
  const { themes, companies, relations, keywords } = await loadThemeGraphWorkspaceContext(input);
  const limit = clamp(input.limit ?? 12, 1, 50);
  const keywordLimit = clamp(input.keywordLimit ?? 5, 1, 5);
  const catalog = projectThemeGraphCatalog({
    themes,
    companies,
    relations,
    keywords,
    keywordLimit,
    filters: {
      query: input.query,
      marketState: input.marketState,
      lifecycle: input.lifecycle,
      minEdges: input.minEdges,
      onlyConnected: input.onlyConnected
    }
  });

  const topThemes = catalog
    .map((entry) => entry.summary)
    .sort((left, right) => {
      if (right.totalEdges !== left.totalEdges) {
        return right.totalEdges - left.totalEdges;
      }

      if (right.themeCompanyCount !== left.themeCompanyCount) {
        return right.themeCompanyCount - left.themeCompanyCount;
      }

      return left.name.localeCompare(right.name);
    })
    .slice(0, limit);

  return {
    generatedAt: new Date().toISOString(),
    themeCount: catalog.length,
    connectedThemeCount: catalog.filter((entry) => entry.summary.totalEdges > 0).length,
    totalThemeCompanies: catalog.reduce((sum, entry) => sum + entry.summary.themeCompanyCount, 0),
    totalRelatedCompanies: catalog.reduce((sum, entry) => sum + entry.summary.relatedCompanyCount, 0),
    totalEdges: catalog.reduce((sum, entry) => sum + entry.summary.totalEdges, 0),
    totalKeywords: catalog.reduce((sum, entry) => sum + entry.summary.keywordCount, 0),
    topThemes
  };
}

export async function searchThemeGraph(input: {
  session: { workspace: { slug: string } };
  repo: TradingRoomRepository;
  query?: string;
  limit?: number;
  keywordLimit?: number;
  marketState?: Theme["marketState"];
  lifecycle?: Theme["lifecycle"];
  minEdges?: number;
  onlyConnected?: boolean;
}): Promise<ThemeGraphSearchView> {
  const { themes, companies, relations, keywords } = await loadThemeGraphWorkspaceContext(input);
  const limit = clamp(input.limit ?? 20, 1, 50);
  const keywordLimit = clamp(input.keywordLimit ?? 5, 1, 5);
  const query = (input.query ?? "").trim();
  const normalizedQuery = normalizeSearchText(query);
  const filters: ThemeGraphFilters = {
    query,
    marketState: input.marketState,
    lifecycle: input.lifecycle,
    minEdges: input.minEdges,
    onlyConnected: input.onlyConnected
  };

  const catalog = projectThemeGraphCatalog({
    themes,
    companies,
    relations,
    keywords,
    keywordLimit,
    edgeLimit: 200,
    filters: {
      ...filters,
      query: undefined
    }
  });

  const results = catalog
    .map((entry) => {
      if (!normalizedQuery) {
        return {
          themeId: entry.theme.id,
          name: entry.theme.name,
          marketState: entry.theme.marketState,
          lifecycle: entry.theme.lifecycle,
          priority: entry.theme.priority,
          score: Math.max(
            1,
            entry.summary.totalEdges * 4 + entry.summary.themeCompanyCount * 3 + entry.summary.keywordCount
          ),
          matchReasons: ["overview"],
          matchedCompanies: entry.summary.themeCompanyCount,
          matchedKeywords: entry.summary.keywordCount,
          summary: entry.summary
        };
      }

      if (!matchesThemeFilters(entry, filters, query)) {
        return null;
      }

      const reasons = new Set<string>();
      let score = 0;

      if (
        includesQuery(entry.theme.name, normalizedQuery) ||
        includesQuery(entry.theme.thesis, normalizedQuery) ||
        includesQuery(entry.theme.whyNow, normalizedQuery) ||
        includesQuery(entry.theme.bottleneck, normalizedQuery)
      ) {
        reasons.add("theme");
        score += 8;
      }

      const matchedCompanies = entry.themeCompanies.filter(
        (company) =>
          includesQuery(company.name, normalizedQuery) ||
          includesQuery(company.ticker, normalizedQuery) ||
          includesQuery(company.chainPosition, normalizedQuery) ||
          includesQuery(company.notes, normalizedQuery)
      );
      if (matchedCompanies.length > 0) {
        reasons.add("company");
        score += matchedCompanies.length * 3;
      }

      const matchedKeywords = entry.summary.topKeywords.filter((keyword) =>
        includesQuery(keyword.label, normalizedQuery)
      );
      if (matchedKeywords.length > 0) {
        reasons.add("keyword");
        score += matchedKeywords.length * 2;
      }

      const relatedLabels = entry.view.nodes.filter((node) => includesQuery(node.label, normalizedQuery));
      if (relatedLabels.length > 0) {
        reasons.add("relation");
        score += relatedLabels.length;
      }

      if (score <= 0) {
        return null;
      }

      return {
        themeId: entry.theme.id,
        name: entry.theme.name,
        marketState: entry.theme.marketState,
        lifecycle: entry.theme.lifecycle,
        priority: entry.theme.priority,
        score,
        matchReasons: [...reasons],
        matchedCompanies: matchedCompanies.length,
        matchedKeywords: matchedKeywords.length,
        summary: entry.summary
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      if (right.summary.totalEdges !== left.summary.totalEdges) {
        return right.summary.totalEdges - left.summary.totalEdges;
      }

      return left.name.localeCompare(right.name);
    })
    .slice(0, limit);

  return {
    generatedAt: new Date().toISOString(),
    query,
    total: results.length,
    results
  };
}

export function formatThemeGraphStatsAsCsv(items: ThemeGraphStatsTheme[]) {
  const rows = [
    [
      "theme_id",
      "name",
      "market_state",
      "lifecycle",
      "priority",
      "theme_company_count",
      "related_company_count",
      "total_edges",
      "keyword_count",
      "top_keywords"
    ],
    ...items.map((item) => [
      item.themeId,
      item.name,
      item.marketState,
      item.lifecycle,
      String(item.priority),
      String(item.themeCompanyCount),
      String(item.relatedCompanyCount),
      String(item.totalEdges),
      String(item.keywordCount),
      item.topKeywords.map((keyword) => keyword.label).join(" | ")
    ])
  ];

  return `${rows
    .map((row) => row.map((value) => `"${String(value).replaceAll("\"", "\"\"")}"`).join(","))
    .join("\n")}\n`;
}
