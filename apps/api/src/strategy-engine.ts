import { randomUUID } from "node:crypto";

import type {
  AppSession,
  Company,
  Market,
  MarketDataQualityGrade,
  Signal,
  StrategyIdea,
  StrategyIdeasDecisionFilter,
  StrategyIdeasDecisionMode,
  StrategyIdeasQualityFilter,
  StrategyIdeasSort,
  StrategyRunCreateInput,
  StrategyRunListItem,
  StrategyRunListView,
  StrategyRunOutput,
  StrategyRunRecord,
  StrategyIdeasView,
  Theme,
  ThemeGraphRankingResult
} from "@iuf-trading-room/contracts";
import {
  strategyIdeasViewSchema,
  strategyRunListViewSchema,
  strategyRunRecordSchema
} from "@iuf-trading-room/contracts";
import type { TradingRoomRepository } from "@iuf-trading-room/domain";

import {
  getMarketBarDiagnostics,
  getMarketDataDecisionSummary,
  getMarketQuoteHistoryDiagnostics
} from "./market-data.js";
import {
  appendPersistedStrategyRun,
  loadPersistedStrategyRuns
} from "./strategy-runs-store.js";
import { getThemeGraphRankings } from "./theme-graph.js";

const supportedDecisionMarkets = ["TWSE", "TPEX", "TWO", "TW_EMERGING", "TW_INDEX", "OTHER"] as const;
type MarketDecisionSummaryItem = Awaited<ReturnType<typeof getMarketDataDecisionSummary>>["items"][number];
type MarketHistoryDiagnosticsItem = Awaited<ReturnType<typeof getMarketQuoteHistoryDiagnostics>>["items"][number];
type MarketBarDiagnosticsItem = Awaited<ReturnType<typeof getMarketBarDiagnostics>>["items"][number];
type StrategyIdeaThemeContext = {
  topThemes: StrategyIdea["topThemes"];
  themeScore: number;
};
type StrategyIdeaQualityView = StrategyIdea["quality"];

const qualitySeverity: Record<MarketDataQualityGrade, number> = {
  strategy_ready: 0,
  reference_only: 1,
  insufficient: 2
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function daysBetween(earlier: string, later: string) {
  const earlierMs = Date.parse(earlier);
  const laterMs = Date.parse(later);
  if (!Number.isFinite(earlierMs) || !Number.isFinite(laterMs)) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.max(0, (laterMs - earlierMs) / 86_400_000);
}

function avgExposure(company: Company) {
  const values = Object.values(company.exposure);
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function beneficiaryTierWeight(tier: Company["beneficiaryTier"]) {
  switch (tier) {
    case "Core":
      return 12;
    case "Direct":
      return 8;
    case "Indirect":
      return 5;
    case "Observation":
      return 2;
  }
}

function normalizeDecisionMarket(market: string): Market {
  return (supportedDecisionMarkets as readonly string[]).includes(market) ? (market as Market) : "OTHER";
}

function normalizeFilterValue(value?: string | null) {
  return value?.trim().toLowerCase() ?? "";
}

function pickDecisionSummary(
  item: MarketDecisionSummaryItem | null,
  mode: StrategyIdeasDecisionMode
) {
  if (!item) {
    return null;
  }

  switch (mode) {
    case "paper":
      return item.paper;
    case "execution":
      return item.execution;
    case "strategy":
    default:
      return item.strategy;
  }
}

function decisionPassesFilter(input: {
  decision: StrategyIdea["marketData"]["decision"];
  usable: boolean;
  includeBlocked: boolean;
  decisionFilter?: StrategyIdeasDecisionFilter;
}) {
  if (input.decisionFilter === "usable_only") {
    return input.usable;
  }

  if (input.decisionFilter) {
    return input.decision === input.decisionFilter;
  }

  if (input.includeBlocked) {
    return true;
  }

  return input.decision !== "block";
}

function qualityPassesFilter(input: {
  quality: StrategyIdeaQualityView;
  qualityFilter?: StrategyIdeasQualityFilter;
}) {
  if (!input.qualityFilter) {
    return true;
  }

  switch (input.qualityFilter) {
    case "strategy_ready":
      return input.quality.grade === "strategy_ready";
    case "exclude_insufficient":
      return input.quality.grade !== "insufficient";
    default:
      return true;
  }
}

function themeMatchesFilter(
  company: Company,
  themesById: Map<string, Theme>,
  themeId?: string,
  themeQuery?: string
) {
  if (themeId && !company.themeIds.includes(themeId)) {
    return false;
  }

  const normalizedQuery = normalizeFilterValue(themeQuery);
  if (!normalizedQuery) {
    return true;
  }

  return company.themeIds.some((id) => {
    const theme = themesById.get(id);
    if (!theme) {
      return false;
    }

    return normalizeFilterValue(theme.name).includes(normalizedQuery);
  });
}

function symbolMatchesFilter(company: Company, symbol?: string) {
  const normalizedSymbol = normalizeFilterValue(symbol);
  if (!normalizedSymbol) {
    return true;
  }

  return normalizeFilterValue(company.ticker).includes(normalizedSymbol);
}

function sortIdeas(items: StrategyIdea[], sort: StrategyIdeasSort) {
  const latestSignalValue = (value: string | null) => (value ? Date.parse(value) || 0 : -1);
  const topThemeScore = (idea: StrategyIdea) => idea.topThemes[0]?.score ?? 0;

  return items.sort((left, right) => {
    switch (sort) {
      case "signal_strength":
        if (right.signalCount !== left.signalCount) {
          return right.signalCount - left.signalCount;
        }
        if (right.confidence !== left.confidence) {
          return right.confidence - left.confidence;
        }
        break;
      case "signal_recency": {
        const recencyDelta = latestSignalValue(right.latestSignalAt) - latestSignalValue(left.latestSignalAt);
        if (recencyDelta !== 0) {
          return recencyDelta;
        }
        if (right.signalCount !== left.signalCount) {
          return right.signalCount - left.signalCount;
        }
        break;
      }
      case "theme_rank":
        if (topThemeScore(right) !== topThemeScore(left)) {
          return topThemeScore(right) - topThemeScore(left);
        }
        break;
      case "symbol":
        return left.symbol.localeCompare(right.symbol);
      case "score":
      default:
        break;
    }

    if (right.score !== left.score) {
      return right.score - left.score;
    }

    if (right.signalCount !== left.signalCount) {
      return right.signalCount - left.signalCount;
    }

    return left.symbol.localeCompare(right.symbol);
  });
}

function buildStrategyRunOutputs(items: StrategyIdea[]): StrategyRunOutput[] {
  return items.map((item) => ({
    companyId: item.companyId,
    symbol: item.symbol,
    companyName: item.companyName,
    direction: item.direction,
    score: item.score,
    confidence: item.confidence,
    signalCount: item.signalCount,
    latestSignalAt: item.latestSignalAt,
    topThemeId: item.topThemes[0]?.themeId ?? null,
    topThemeName: item.topThemes[0]?.name ?? null,
    marketDecision: item.marketData.decision,
    selectedSource: item.marketData.selectedSource,
    qualityGrade: item.quality.grade,
    primaryReason: item.rationale.primaryReason
  }));
}

function buildStrategyRunListItem(run: StrategyRunRecord): StrategyRunListItem {
  return {
    id: run.id,
    createdAt: run.createdAt,
    generatedAt: run.generatedAt,
    query: run.query,
    summary: run.summary,
    topSymbols: run.outputs.slice(0, 5).map((output) => output.symbol)
  };
}

function defaultHistoryQuality(): StrategyIdeaQualityView["history"] {
  return {
    grade: "insufficient",
    strategyUsable: false,
    primaryReason: "missing_history"
  };
}

function defaultBarQuality(): StrategyIdeaQualityView["bars"] {
  return {
    grade: "insufficient",
    strategyUsable: false,
    primaryReason: "missing_bars"
  };
}

function combineIdeaQuality(input: {
  history?: MarketHistoryDiagnosticsItem | null;
  bars?: MarketBarDiagnosticsItem | null;
}): StrategyIdeaQualityView {
  const history = input.history
    ? {
        grade: input.history.quality.grade,
        strategyUsable: input.history.quality.strategyUsable,
        primaryReason: input.history.quality.primaryReason
      }
    : defaultHistoryQuality();
  const bars = input.bars
    ? {
        grade: input.bars.quality.grade,
        strategyUsable: input.bars.quality.strategyUsable,
        primaryReason: input.bars.quality.primaryReason
      }
    : defaultBarQuality();

  let grade = history.grade;
  let primaryReason = history.primaryReason;

  if (qualitySeverity[bars.grade] > qualitySeverity[grade]) {
    grade = bars.grade;
    primaryReason = bars.primaryReason;
  } else if (
    qualitySeverity[bars.grade] === qualitySeverity[grade] &&
    grade !== "strategy_ready" &&
    history.primaryReason === "missing_history"
  ) {
    primaryReason = bars.primaryReason;
  }

  return {
    grade,
    strategyUsable: grade === "strategy_ready",
    primaryReason,
    history,
    bars
  };
}

function summarizeQualityReasons(items: StrategyIdea[]) {
  const counts = new Map<string, number>();
  for (const item of items) {
    counts.set(item.quality.primaryReason, (counts.get(item.quality.primaryReason) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 6)
    .map(([reason, total]) => ({ reason, total }));
}

function buildSignalSummary(signals: Signal[], nowIso: string, signalDays: number) {
  const recentSignals = signals.filter((signal) => daysBetween(signal.createdAt, nowIso) <= signalDays);
  const weightedBull = recentSignals
    .filter((signal) => signal.direction === "bullish")
    .reduce(
      (sum, signal) =>
        sum + signal.confidence * Math.max(0.35, 1 - daysBetween(signal.createdAt, nowIso) / signalDays),
      0
    );
  const weightedBear = recentSignals
    .filter((signal) => signal.direction === "bearish")
    .reduce(
      (sum, signal) =>
        sum + signal.confidence * Math.max(0.35, 1 - daysBetween(signal.createdAt, nowIso) / signalDays),
      0
    );
  const signalScore = clamp((weightedBull + weightedBear) * 4, 0, 35);
  const balance = weightedBull - weightedBear;
  const latestSignalAt =
    recentSignals.map((signal) => signal.createdAt).sort((left, right) => right.localeCompare(left))[0] ?? null;

  const direction: StrategyIdea["direction"] =
    balance > 1.5 ? "bullish" : balance < -1.5 ? "bearish" : "neutral";

  return {
    recentSignals,
    signalScore,
    latestSignalAt,
    bullishSignalCount: recentSignals.filter((signal) => signal.direction === "bullish").length,
    bearishSignalCount: recentSignals.filter((signal) => signal.direction === "bearish").length,
    direction,
    conviction: Math.abs(balance)
  };
}

function buildThemeContext(
  company: Company,
  themes: Theme[],
  rankingMap: Map<string, ThemeGraphRankingResult>
): StrategyIdeaThemeContext {
  const rankedThemes = company.themeIds
    .map((themeId) => rankingMap.get(themeId) ?? null)
    .filter((theme): theme is ThemeGraphRankingResult => theme !== null)
    .sort((left, right) => right.score - left.score)
    .slice(0, 3);

  const fallbackThemes = company.themeIds
    .map((themeId) => themes.find((theme) => theme.id === themeId) ?? null)
    .filter((theme): theme is Theme => theme !== null)
    .slice(0, 3)
    .map((theme) => ({
      themeId: theme.id,
      name: theme.name,
      marketState: theme.marketState,
      lifecycle: theme.lifecycle,
      priority: theme.priority,
      score: theme.priority * 10
    }));

  const topThemes =
    rankedThemes.length > 0
      ? rankedThemes.map((theme) => ({
          themeId: theme.themeId,
          name: theme.name,
          marketState: theme.marketState,
          lifecycle: theme.lifecycle,
          priority: theme.priority,
          score: theme.score
        }))
      : fallbackThemes;

  const themeScore = clamp(topThemes[0]?.score ?? 0, 0, 40);

  return {
    topThemes,
    themeScore
  };
}

export async function getStrategyIdeas(input: {
  session: AppSession;
  repo: TradingRoomRepository;
  limit?: number;
  signalDays?: number;
  includeBlocked?: boolean;
  market?: string;
  themeId?: string;
  theme?: string;
  symbol?: string;
  decisionMode?: StrategyIdeasDecisionMode;
  decisionFilter?: StrategyIdeasDecisionFilter;
  qualityFilter?: StrategyIdeasQualityFilter;
  sort?: StrategyIdeasSort;
}): Promise<StrategyIdeasView> {
  const limit = clamp(input.limit ?? 12, 1, 50);
  const signalDays = clamp(input.signalDays ?? 14, 1, 90);
  const includeBlocked = input.includeBlocked ?? false;
  const decisionMode = input.decisionMode ?? "strategy";
  const sort = input.sort ?? "score";
  const nowIso = new Date().toISOString();

  const [themes, companies, signals, themeRankings] = await Promise.all([
    input.repo.listThemes({ workspaceSlug: input.session.workspace.slug }),
    input.repo.listCompanies(undefined, { workspaceSlug: input.session.workspace.slug }),
    input.repo.listSignals(undefined, { workspaceSlug: input.session.workspace.slug }),
    getThemeGraphRankings({
      session: input.session,
      repo: input.repo,
      limit: 50
    })
  ]);

  const rankingMap = new Map(themeRankings.results.map((result) => [result.themeId, result]));
  const themesById = new Map(themes.map((theme) => [theme.id, theme]));
  const companiesInScope = companies.filter(
    (company) =>
      (!input.market || company.market === input.market) &&
      symbolMatchesFilter(company, input.symbol) &&
      themeMatchesFilter(company, themesById, input.themeId, input.theme)
  );

  const preliminary = companiesInScope.map((company) => {
    const companySignals = signals.filter((signal) => signal.companyIds.includes(company.id));
    const signalSummary = buildSignalSummary(companySignals, nowIso, signalDays);
    const themeContext = buildThemeContext(company, themes, rankingMap);
    const leverageScore = clamp(avgExposure(company) * 4 + beneficiaryTierWeight(company.beneficiaryTier), 0, 25);
    const preliminaryScore = clamp(
      themeContext.themeScore * 0.45 + signalSummary.signalScore + leverageScore * 0.45,
      0,
      85
    );

    return {
      company,
      signalSummary,
      themeContext,
      preliminaryScore
    };
  });

  const shortlist = preliminary
    .sort((left, right) => {
      if (right.preliminaryScore !== left.preliminaryScore) {
        return right.preliminaryScore - left.preliminaryScore;
      }

      if (right.signalSummary.recentSignals.length !== left.signalSummary.recentSignals.length) {
        return right.signalSummary.recentSignals.length - left.signalSummary.recentSignals.length;
      }

      return left.company.name.localeCompare(right.company.name);
    })
    .slice(0, Math.max(limit * 4, 40));

  const byDecisionMarket = new Map<Market, typeof shortlist>();
  for (const item of shortlist) {
    const bucketKey = normalizeDecisionMarket(item.company.market);
    const bucket = byDecisionMarket.get(bucketKey) ?? [];
    bucket.push(item);
    byDecisionMarket.set(bucketKey, bucket);
  }

  const decisionMap = new Map<string, MarketDecisionSummaryItem>();
  const historyQualityMap = new Map<string, MarketHistoryDiagnosticsItem>();
  const barQualityMap = new Map<string, MarketBarDiagnosticsItem>();

  for (const [market, items] of byDecisionMarket) {
    const symbols = [...new Set(items.map((item) => item.company.ticker))].join(",");
    if (!symbols) {
      continue;
    }

    const [decisionSummary, historyDiagnostics, barDiagnostics] = await Promise.all([
      getMarketDataDecisionSummary({
        session: input.session,
        symbols,
        market,
        includeStale: true,
        limit: Math.max(items.length, 20)
      }),
      getMarketQuoteHistoryDiagnostics({
        session: input.session,
        symbols,
        market,
        includeStale: true,
        limit: Math.max(items.length * 4, 40)
      }),
      getMarketBarDiagnostics({
        session: input.session,
        symbols,
        market,
        includeStale: true,
        interval: "1m",
        limit: Math.max(items.length * 2, 20)
      })
    ]);

    for (const item of decisionSummary.items) {
      decisionMap.set(`${item.market}:${item.symbol}`, item);
    }

    for (const item of historyDiagnostics.items) {
      historyQualityMap.set(`${item.market}:${item.symbol}`, item);
    }

    for (const item of barDiagnostics.items) {
      barQualityMap.set(`${market}:${item.symbol}`, item);
    }
  }

  const items = shortlist
    .map((entry) => {
      const decisionMarket = normalizeDecisionMarket(entry.company.market);
      const decision =
        decisionMap.get(`${decisionMarket}:${entry.company.ticker}`) ??
        decisionMap.get(`OTHER:${entry.company.ticker}`) ??
        null;
      const quality = combineIdeaQuality({
        history:
          historyQualityMap.get(`${decisionMarket}:${entry.company.ticker}`) ??
          historyQualityMap.get(`OTHER:${entry.company.ticker}`) ??
          null,
        bars:
          barQualityMap.get(`${decisionMarket}:${entry.company.ticker}`) ??
          barQualityMap.get(`OTHER:${entry.company.ticker}`) ??
          null
      });
      const decisionView = pickDecisionSummary(decision, decisionMode);
      const decisionName = decisionView?.decision ?? "block";
      const marketDataScore = decisionName === "allow" ? 15 : decisionName === "review" ? 8 : 0;
      const score = clamp(entry.preliminaryScore + marketDataScore, 0, 100);
      const confidence = clamp(
        score / 100 +
          (decisionView?.safe ? 0.08 : 0) +
          clamp(entry.signalSummary.conviction / 10, 0, 0.15),
        0,
        1
      );
      const topTheme = entry.themeContext.topThemes[0] ?? null;
      const themeRelevance = !topTheme
        ? "none"
        : topTheme.score >= 60 || topTheme.priority >= 4
          ? "high"
          : topTheme.score >= 35
            ? "medium"
            : "low";
      const signalPrimaryReason =
        entry.signalSummary.recentSignals.length > 0 ? "recent_signals_present" : "no_recent_signals";
      const rationalePrimaryReason =
        quality.grade !== "strategy_ready"
          ? quality.primaryReason
          : decisionView?.primaryReason && decisionName !== "allow"
          ? decisionView.primaryReason
          : entry.signalSummary.recentSignals.length > 0
            ? "recent_signals_present"
            : topTheme
              ? "theme_rank_support"
              : "composite_score";

      return {
        companyId: entry.company.id,
        symbol: entry.company.ticker,
        companyName: entry.company.name,
        market: entry.company.market,
        beneficiaryTier: entry.company.beneficiaryTier,
        direction: entry.signalSummary.direction,
        score,
        confidence: Number(confidence.toFixed(2)),
        signalCount: entry.signalSummary.recentSignals.length,
        bullishSignalCount: entry.signalSummary.bullishSignalCount,
        bearishSignalCount: entry.signalSummary.bearishSignalCount,
        latestSignalAt: entry.signalSummary.latestSignalAt,
        topThemes: entry.themeContext.topThemes,
        marketData: {
          decisionMode,
          selectedSource: decision?.selectedSource ?? null,
          readiness: decision?.readiness ?? "blocked",
          freshnessStatus: decision?.freshnessStatus ?? "missing",
          decision: decisionName,
          usable: decisionView?.usable ?? false,
          safe: decisionView?.safe ?? false,
          primaryReason: decisionView?.primaryReason ?? "missing_market_decision",
          fallbackReason: decision?.fallbackReason ?? "no_quote",
          staleReason: decision?.staleReason ?? "missing_quote"
        },
        quality,
        rationale: {
          primaryReason: rationalePrimaryReason,
          theme: {
            topThemeId: topTheme?.themeId ?? null,
            topThemeName: topTheme?.name ?? null,
            score: Number((topTheme?.score ?? 0).toFixed(2)),
            relevance: themeRelevance,
            marketState: topTheme?.marketState ?? null,
            lifecycle: topTheme?.lifecycle ?? null
          },
          signals: {
            recentCount: entry.signalSummary.recentSignals.length,
            bullishCount: entry.signalSummary.bullishSignalCount,
            bearishCount: entry.signalSummary.bearishSignalCount,
            latestSignalAt: entry.signalSummary.latestSignalAt,
            signalScore: Number(entry.signalSummary.signalScore.toFixed(2)),
            hasRecentSignals: entry.signalSummary.recentSignals.length > 0,
            primaryReason: signalPrimaryReason
          },
          marketData: {
            mode: decisionMode,
            decision: decisionName,
            selectedSource: decision?.selectedSource ?? null,
            readiness: decision?.readiness ?? "blocked",
            freshnessStatus: decision?.freshnessStatus ?? "missing",
            usable: decisionView?.usable ?? false,
            safe: decisionView?.safe ?? false,
            primaryReason: decisionView?.primaryReason ?? "missing_market_decision",
            fallbackReason: decision?.fallbackReason ?? "no_quote",
            staleReason: decision?.staleReason ?? "missing_quote"
          },
          quality: {
            grade: quality.grade,
            primaryReason: quality.primaryReason
          }
        }
      } satisfies StrategyIdea;
    })
    .filter((item) =>
      decisionPassesFilter({
        decision: item.marketData.decision,
        usable: item.marketData.usable,
        includeBlocked,
        decisionFilter: input.decisionFilter
      })
      && qualityPassesFilter({
        quality: item.quality,
        qualityFilter: input.qualityFilter
      })
    );

  const finalItems = sortIdeas(items, sort)
    .slice(0, limit);

  return strategyIdeasViewSchema.parse({
    generatedAt: nowIso,
    summary: {
      total: finalItems.length,
      allow: finalItems.filter((item) => item.marketData.decision === "allow").length,
      review: finalItems.filter((item) => item.marketData.decision === "review").length,
      block: finalItems.filter((item) => item.marketData.decision === "block").length,
      bullish: finalItems.filter((item) => item.direction === "bullish").length,
      bearish: finalItems.filter((item) => item.direction === "bearish").length,
      neutral: finalItems.filter((item) => item.direction === "neutral").length,
      quality: {
        strategyReady: finalItems.filter((item) => item.quality.grade === "strategy_ready").length,
        referenceOnly: finalItems.filter((item) => item.quality.grade === "reference_only").length,
        insufficient: finalItems.filter((item) => item.quality.grade === "insufficient").length,
        primaryReasons: summarizeQualityReasons(finalItems)
      }
    },
    items: finalItems
  });
}

export async function createStrategyRun(input: {
  session: AppSession;
  repo: TradingRoomRepository;
  payload: StrategyRunCreateInput;
}): Promise<StrategyRunRecord> {
  const ideas = await getStrategyIdeas({
    session: input.session,
    repo: input.repo,
    ...input.payload
  });

  const createdAt = new Date().toISOString();
  const run = strategyRunRecordSchema.parse({
    id: randomUUID(),
    createdAt,
    generatedAt: ideas.generatedAt,
    query: input.payload,
    summary: ideas.summary,
    outputs: buildStrategyRunOutputs(ideas.items)
  });

  await appendPersistedStrategyRun(input.session.workspace.slug, run);
  return run;
}

export async function listStrategyRuns(input: {
  session: AppSession;
  limit?: number;
}): Promise<StrategyRunListView> {
  const limit = clamp(input.limit ?? 20, 1, 50);
  const runs = await loadPersistedStrategyRuns(input.session.workspace.slug);
  return strategyRunListViewSchema.parse({
    total: runs.length,
    items: runs.slice(0, limit).map(buildStrategyRunListItem)
  });
}

export async function getStrategyRunById(input: {
  session: AppSession;
  runId: string;
}): Promise<StrategyRunRecord | null> {
  const runs = await loadPersistedStrategyRuns(input.session.workspace.slug);
  return runs.find((run) => run.id === input.runId) ?? null;
}
