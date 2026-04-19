import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const apiDir = path.join(repoRoot, "apps", "api");
const workspaceSlug = `smoke-${Date.now()}`;

type JsonEnvelope<T> = { data: T };

async function getFreePort() {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Could not resolve a free port."));
        return;
      }

      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
    server.on("error", reject);
  });
}

async function waitForHealth(baseUrl: string, attempts = 30) {
  let lastError: unknown;

  for (let index = 0; index < attempts; index += 1) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) {
        return;
      }
      lastError = new Error(`Health endpoint returned ${response.status}.`);
    } catch (error) {
      lastError = error;
    }

    await delay(500);
  }

  throw lastError instanceof Error ? lastError : new Error("API did not become healthy in time.");
}

async function request<T>(
  baseUrl: string,
  route: string,
  init?: RequestInit & { raw?: boolean }
): Promise<T> {
  const response = await fetch(`${baseUrl}${route}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${route} failed with ${response.status}: ${body}`);
  }

  if (init?.raw) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

async function main() {
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const webhookToken = "smoke-webhook-token";
  const server = spawn(process.execPath, ["dist/server.js"], {
    cwd: apiDir,
    env: {
      ...process.env,
      PORT: String(port),
      DEFAULT_WORKSPACE_SLUG: workspaceSlug,
      TV_WEBHOOK_TOKEN: webhookToken
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let stdout = "";
  let stderr = "";

  server.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });

  server.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  try {
    await waitForHealth(baseUrl);

    const health = await request<{
      status: string;
      uptime: number;
      build: {
        version: string;
        commit: string;
        deploymentId: string;
        environment: string;
        service: string;
        startedAt: string;
      };
    }>(baseUrl, "/health");
    assert.equal(health.status, "ok");
    assert.equal(typeof health.uptime, "number");
    assert.equal(typeof health.build.version, "string");
    assert.equal(typeof health.build.commit, "string");
    assert.equal(typeof health.build.deploymentId, "string");
    assert.equal(typeof health.build.environment, "string");
    assert.equal(health.build.service, "api");
    assert.match(health.build.startedAt, /\d{4}-\d{2}-\d{2}T/);

    const session = await request<JsonEnvelope<{ workspace: { slug: string } }>>(
      baseUrl,
      "/api/v1/session",
      {
        headers: { "x-workspace-slug": workspaceSlug }
      }
    );
    assert.equal(session.data.workspace.slug, workspaceSlug);

    const theme = await request<JsonEnvelope<{ id: string; name: string }>>(baseUrl, "/api/v1/themes", {
      method: "POST",
      headers: { "x-workspace-slug": workspaceSlug },
      body: JSON.stringify({
        name: "CI Smoke Theme",
        marketState: "Balanced",
        lifecycle: "Discovery",
        priority: 3,
        thesis: "Smoke-test thesis",
        whyNow: "CI should verify end-to-end CRUD.",
        bottleneck: "Execution"
      })
    });
    assert.equal(theme.data.name, "CI Smoke Theme");

    const company = await request<JsonEnvelope<{ id: string; name: string }>>(
      baseUrl,
      "/api/v1/companies",
      {
        method: "POST",
        headers: { "x-workspace-slug": workspaceSlug },
        body: JSON.stringify({
          name: "Smoke Optics",
          ticker: "SMK1",
          market: "NASDAQ",
          country: "United States",
          themeIds: [theme.data.id],
          chainPosition: "Optical systems",
          beneficiaryTier: "Direct",
          exposure: {
            volume: 4,
            asp: 3,
            margin: 3,
            capacity: 4,
            narrative: 4
          },
          validation: {
            capitalFlow: "Improving",
            consensus: "Rising",
            relativeStrength: "Positive"
          },
          notes: "Smoke test company"
        })
      }
    );
    assert.equal(company.data.name, "Smoke Optics");

    const marketProviders = await request<
      JsonEnvelope<
        Array<{
          source: string;
          connected: boolean;
          freshnessStatus: string;
          readiness: string;
          strategyUsable: boolean;
          paperUsable: boolean;
          liveUsable: boolean;
          reasons: string[];
        }>
      >
    >(baseUrl, "/api/v1/market-data/providers?sources=manual,paper,tradingview,kgi", {
      headers: { "x-workspace-slug": workspaceSlug }
    });
    assert.equal(marketProviders.data.length, 4);
    assert.equal(marketProviders.data[0]?.source, "manual");
    assert.equal(marketProviders.data[0]?.connected, true);
    assert.equal(marketProviders.data[0]?.freshnessStatus, "missing");
    assert.equal(marketProviders.data[0]?.readiness, "blocked");
    assert.equal(marketProviders.data[0]?.strategyUsable, false);
    assert.equal(marketProviders.data[0]?.paperUsable, false);
    assert.equal(marketProviders.data[0]?.liveUsable, false);
    assert.equal(marketProviders.data[0]?.reasons.includes("missing_quote"), true);

    const marketPolicy = await request<
      JsonEnvelope<{
        generatedAt: string;
        surface: {
          version: string;
          capabilities: {
            consumerSummary: boolean;
            selectionSummary: boolean;
            decisionSummary: boolean;
            historyQualitySummary: boolean;
            barQualitySummary: boolean;
          };
          preferredEntryPoints: {
            execution: string;
            historyQuality: string;
            barQuality: string;
          };
        };
        sourcePriority: Array<{ source: string; priority: number }>;
        freshnessMs: Array<{ source: string; staleAfterMs: number }>;
        historyLimit: Array<{ source: string; limit: number }>;
      }>
    >(baseUrl, "/api/v1/market-data/policy", {
      headers: { "x-workspace-slug": workspaceSlug }
    });
    assert.match(marketPolicy.data.generatedAt, /\d{4}-\d{2}-\d{2}T/);
    assert.equal(marketPolicy.data.surface.version, "market-data-v1.10-history-quality-summary");
    assert.equal(marketPolicy.data.surface.capabilities.consumerSummary, true);
    assert.equal(marketPolicy.data.surface.capabilities.selectionSummary, true);
    assert.equal(marketPolicy.data.surface.capabilities.decisionSummary, true);
    assert.equal(marketPolicy.data.surface.capabilities.historyQualitySummary, true);
    assert.equal(marketPolicy.data.surface.capabilities.barQualitySummary, true);
    assert.equal(marketPolicy.data.surface.preferredEntryPoints.execution, "/api/v1/market-data/decision-summary");
    assert.equal(marketPolicy.data.surface.preferredEntryPoints.historyQuality, "/api/v1/market-data/history/diagnostics");
    assert.equal(marketPolicy.data.surface.preferredEntryPoints.barQuality, "/api/v1/market-data/bars/diagnostics");
    assert.equal(marketPolicy.data.sourcePriority[0]?.source, "kgi");
    assert.equal(
      marketPolicy.data.freshnessMs.some((entry) => entry.source === "tradingview" && entry.staleAfterMs > 0),
      true
    );
    assert.equal(
      marketPolicy.data.historyLimit.some((entry) => entry.source === "paper" && entry.limit > 0),
      true
    );

    const marketSymbols = await request<
      JsonEnvelope<
        Array<{
          symbol: string;
          market: string;
          companyId: string | null;
        }>
      >
    >(baseUrl, "/api/v1/market-data/symbols?query=SMK1&limit=10", {
      headers: { "x-workspace-slug": workspaceSlug }
    });
    assert.equal(marketSymbols.data.some((item) => item.symbol === "SMK1"), true);

    const manualQuotes = await request<
      JsonEnvelope<
        Array<{
          symbol: string;
          market: string;
          source: string;
          last: number | null;
          isStale: boolean;
        }>
      >
    >(baseUrl, "/api/v1/market-data/manual-quotes", {
      method: "POST",
      headers: { "x-workspace-slug": workspaceSlug },
      body: JSON.stringify({
        quotes: [
          {
            symbol: "SMK1",
            market: "OTHER",
            source: "manual",
            last: 123.45,
            bid: 123.4,
            ask: 123.5,
            open: 120,
            high: 124,
            low: 119.5,
            prevClose: 121,
            volume: 1500,
            changePct: 2.02
          }
        ]
      })
    });
    assert.equal(manualQuotes.data.length, 1);
    assert.equal(manualQuotes.data[0]?.symbol, "SMK1");
    assert.equal(manualQuotes.data[0]?.isStale, false);

    const paperQuotes = await request<
      JsonEnvelope<
        Array<{
          symbol: string;
          market: string;
          source: string;
          last: number | null;
          isStale: boolean;
        }>
      >
    >(baseUrl, "/api/v1/market-data/paper-quotes", {
      method: "POST",
      headers: { "x-workspace-slug": workspaceSlug },
      body: JSON.stringify({
        quotes: [
          {
            symbol: "PAPR1",
            market: "OTHER",
            source: "manual",
            last: 77.7,
            bid: 77.6,
            ask: 77.8,
            open: 76.5,
            high: 78.2,
            low: 76.2,
            prevClose: 76.9,
            volume: 450,
            changePct: 1.04
          }
        ]
      })
    });
    assert.equal(paperQuotes.data.length, 1);
    assert.equal(paperQuotes.data[0]?.symbol, "PAPR1");
    assert.equal(paperQuotes.data[0]?.source, "paper");

    const tradingviewQuotesUpsert = await request<
      JsonEnvelope<
        Array<{
          symbol: string;
          market: string;
          source: string;
          last: number | null;
          isStale: boolean;
        }>
      >
    >(baseUrl, "/api/v1/market-data/manual-quotes", {
      method: "POST",
      headers: { "x-workspace-slug": workspaceSlug },
      body: JSON.stringify({
        quotes: [
          {
            symbol: "TVSMK1",
            market: "OTHER",
            source: "tradingview",
            last: 234.56,
            bid: 234.5,
            ask: 234.6,
            open: 230,
            high: 235,
            low: 229.5,
            prevClose: 231,
            volume: 700,
            changePct: 1.54
          }
        ]
      })
    });
    assert.equal(tradingviewQuotesUpsert.data.length, 1);
    assert.equal(tradingviewQuotesUpsert.data[0]?.source, "tradingview");

    const marketQuotes = await request<
      JsonEnvelope<
        Array<{
          symbol: string;
          market: string;
          source: string;
          last: number | null;
          isStale: boolean;
        }>
      >
    >(baseUrl, "/api/v1/market-data/quotes?symbols=SMK1&source=manual&limit=10", {
      headers: { "x-workspace-slug": workspaceSlug }
    });
    assert.equal(marketQuotes.data.length, 1);
    assert.equal(marketQuotes.data[0]?.symbol, "SMK1");
    assert.equal(marketQuotes.data[0]?.market, "OTHER");
    assert.equal(marketQuotes.data[0]?.source, "manual");
    assert.equal(marketQuotes.data[0]?.last, 123.45);

    const paperProviderQuotes = await request<
      JsonEnvelope<
        Array<{
          symbol: string;
          market: string;
          source: string;
          last: number | null;
          isStale: boolean;
        }>
      >
    >(baseUrl, "/api/v1/market-data/quotes?symbols=PAPR1&source=paper&limit=10", {
      headers: { "x-workspace-slug": workspaceSlug }
    });
    assert.equal(paperProviderQuotes.data.length, 1);
    assert.equal(paperProviderQuotes.data[0]?.symbol, "PAPR1");
    assert.equal(paperProviderQuotes.data[0]?.source, "paper");

    const resolvedQuotes = await request<
      JsonEnvelope<
        Array<{
          symbol: string;
          selectedSource: string | null;
          freshnessStatus: string;
          fallbackReason: string;
          staleReason: string;
          preferredSource: string | null;
          preferredQuote: { last: number | null } | null;
          candidates: Array<{ source: string; freshnessStatus: string; staleReason: string }>;
        }>
      >
    >(baseUrl, "/api/v1/market-data/resolve?symbols=SMK1&limit=10", {
      headers: { "x-workspace-slug": workspaceSlug }
    });
    assert.equal(resolvedQuotes.data.length, 1);
    assert.equal(resolvedQuotes.data[0]?.selectedSource, "manual");
    assert.equal(resolvedQuotes.data[0]?.freshnessStatus, "fresh");
    assert.equal(resolvedQuotes.data[0]?.fallbackReason, "higher_priority_missing");
    assert.equal(resolvedQuotes.data[0]?.staleReason, "none");
    assert.equal(resolvedQuotes.data[0]?.preferredSource, "manual");
    assert.equal(resolvedQuotes.data[0]?.preferredQuote?.last, 123.45);
    assert.equal(resolvedQuotes.data[0]?.candidates.some((item) => item.source === "manual"), true);

    const effectiveQuotes = await request<
      JsonEnvelope<{
        summary: {
          total: number;
          ready: number;
          degraded: number;
          blocked: number;
          strategyUsable: number;
          paperUsable: number;
          liveUsable: number;
        };
        items: Array<{
          symbol: string;
          selectedSource: string | null;
          readiness: string;
          strategyUsable: boolean;
          paperUsable: boolean;
          liveUsable: boolean;
          fallbackReason: string;
          staleReason: string;
          reasons: string[];
        }>;
      }>
    >(baseUrl, "/api/v1/market-data/effective-quotes?symbols=SMK1,PAPR1,TVSMK1&includeStale=true&limit=10", {
      headers: { "x-workspace-slug": workspaceSlug }
    });
    assert.equal(effectiveQuotes.data.summary.total, 3);
    assert.equal(effectiveQuotes.data.summary.strategyUsable >= 2, true);
    assert.equal(effectiveQuotes.data.summary.paperUsable >= 2, true);
    assert.equal(
      effectiveQuotes.data.items.some(
        (item) =>
          item.symbol === "TVSMK1" &&
          item.readiness === "degraded" &&
          item.selectedSource === "tradingview" &&
          item.strategyUsable === true &&
          item.paperUsable === true &&
          item.liveUsable === false &&
          item.reasons.includes("non_live_source")
      ),
      true
    );
    assert.equal(
      effectiveQuotes.data.items.some(
        (item) => item.symbol === "PAPR1" && item.readiness === "degraded" && item.reasons.includes("synthetic_source")
      ),
      true
    );

    const consumerSummary = await request<
      JsonEnvelope<{
        mode: string;
        summary: {
          total: number;
          allow: number;
          review: number;
          block: number;
          usable: number;
          safe: number;
        };
        items: Array<{
          symbol: string;
          mode: string;
          decision: string;
          usable: boolean;
          safe: boolean;
          selectedSource: string | null;
        }>;
      }>
    >(baseUrl, "/api/v1/market-data/consumer-summary?symbols=SMK1,PAPR1,TVSMK1&includeStale=true&limit=10&mode=execution", {
      headers: { "x-workspace-slug": workspaceSlug }
    });
    assert.equal(consumerSummary.data.mode, "execution");
    assert.equal(consumerSummary.data.summary.total, 3);
    assert.equal(consumerSummary.data.summary.safe, 0);
    assert.equal(consumerSummary.data.summary.allow, 0);
    assert.equal(consumerSummary.data.summary.review >= 2, true);
    assert.equal(
      consumerSummary.data.items.some(
        (item) =>
          item.symbol === "TVSMK1"
          && item.mode === "execution"
          && item.decision === "review"
          && item.usable === false
          && item.safe === false
          && item.selectedSource === "tradingview"
      ),
      true
    );

    const selectionSummary = await request<
      JsonEnvelope<{
        generatedAt: string;
        summary: {
          total: number;
          readiness: {
            ready: number;
            degraded: number;
            blocked: number;
          };
          strategy: { review: number };
          paper: { review: number };
          execution: { review: number };
        };
        items: Array<{
          symbol: string;
          selectedSource: string | null;
          strategy: { decision: string };
          paper: { decision: string };
          execution: { decision: string };
        }>;
      }>
    >(baseUrl, "/api/v1/market-data/selection-summary?symbols=SMK1,PAPR1,TVSMK1&includeStale=true&limit=10", {
      headers: { "x-workspace-slug": workspaceSlug }
    });
    assert.equal(selectionSummary.data.summary.total, 3);
    assert.equal(selectionSummary.data.summary.readiness.ready, 0);
    assert.equal(selectionSummary.data.summary.strategy.review >= 2, true);
    assert.equal(selectionSummary.data.summary.paper.review >= 2, true);
    assert.equal(selectionSummary.data.summary.execution.review >= 2, true);
    assert.equal(
      selectionSummary.data.items.some(
        (item) =>
          item.symbol === "TVSMK1"
          && item.selectedSource === "tradingview"
          && item.strategy.decision === "review"
          && item.paper.decision === "review"
          && item.execution.decision === "review"
      ),
      true
    );

    const decisionSummary = await request<
      JsonEnvelope<{
        summary: {
          total: number;
          readiness: { ready: number; degraded: number; blocked: number };
          execution: { allow: number; review: number; block: number; usable: number; safe: number };
        };
        items: Array<{
          symbol: string;
          selectedSource: string | null;
          primaryReason: string;
          quote: { source: string; last: number | null } | null;
          strategy: { decision: string; usable: boolean; safe: boolean; primaryReason: string };
          paper: { decision: string; usable: boolean; safe: boolean; primaryReason: string };
          execution: { decision: string; usable: boolean; safe: boolean; primaryReason: string };
        }>;
      }>
    >(baseUrl, "/api/v1/market-data/decision-summary?symbols=SMK1,PAPR1,TVSMK1&includeStale=true&limit=10", {
      headers: { "x-workspace-slug": workspaceSlug }
    });
    assert.equal(decisionSummary.data.summary.total, 3);
    assert.equal(decisionSummary.data.summary.readiness.ready, 0);
    assert.equal(decisionSummary.data.summary.execution.review >= 2, true);
    assert.equal(
      decisionSummary.data.items.some(
        (item) =>
          item.symbol === "TVSMK1"
          && item.selectedSource === "tradingview"
          && item.quote?.source === "tradingview"
          && item.execution.decision === "review"
          && item.execution.primaryReason === "fallback:higher_priority_unavailable"
      ),
      true
    );

    const paperProviderStatus = await request<
      JsonEnvelope<
        Array<{
          source: string;
          connected: boolean;
          freshnessStatus: string;
          readiness: string;
          strategyUsable: boolean;
          paperUsable: boolean;
          liveUsable: boolean;
          reasons: string[];
          subscribedSymbols: string[];
        }>
      >
    >(baseUrl, "/api/v1/market-data/providers?sources=paper", {
      headers: { "x-workspace-slug": workspaceSlug }
    });
    assert.equal(paperProviderStatus.data.length, 1);
    assert.equal(paperProviderStatus.data[0]?.source, "paper");
    assert.equal(paperProviderStatus.data[0]?.connected, true);
    assert.equal(paperProviderStatus.data[0]?.freshnessStatus, "fresh");
    assert.equal(paperProviderStatus.data[0]?.readiness, "degraded");
    assert.equal(paperProviderStatus.data[0]?.strategyUsable, true);
    assert.equal(paperProviderStatus.data[0]?.paperUsable, true);
    assert.equal(paperProviderStatus.data[0]?.liveUsable, false);
    assert.equal(paperProviderStatus.data[0]?.reasons.includes("synthetic_source"), true);
    assert.equal(paperProviderStatus.data[0]?.subscribedSymbols.includes("PAPR1"), true);

    const tradingviewQuotes = await request<
      JsonEnvelope<
        Array<{
          symbol: string;
          market: string;
          source: string;
          last: number | null;
          isStale: boolean;
        }>
      >
    >(baseUrl, "/api/v1/market-data/quotes?symbols=TVSMK1&source=tradingview&limit=10", {
      headers: { "x-workspace-slug": workspaceSlug }
    });
    assert.equal(tradingviewQuotes.data.length, 1);
    assert.equal(tradingviewQuotes.data[0]?.symbol, "TVSMK1");
    assert.equal(tradingviewQuotes.data[0]?.source, "tradingview");

    const tradingviewHistory = await request<
      JsonEnvelope<
        Array<{
          symbol: string;
          source: string;
          timestamp: string;
        }>
      >
    >(baseUrl, "/api/v1/market-data/history?symbols=TVSMK1&source=tradingview&limit=10", {
      headers: { "x-workspace-slug": workspaceSlug }
    });
    assert.equal(tradingviewHistory.data.length, 1);
    assert.equal(tradingviewHistory.data[0]?.symbol, "TVSMK1");
    assert.equal(tradingviewHistory.data[0]?.source, "tradingview");

    const tradingviewBars = await request<
      JsonEnvelope<
        Array<{
          symbol: string;
          source: string;
          interval: string;
          open: number;
          close: number;
        }>
      >
    >(baseUrl, "/api/v1/market-data/bars?symbols=TVSMK1&source=tradingview&interval=1m&limit=10", {
      headers: { "x-workspace-slug": workspaceSlug }
    });
    assert.equal(tradingviewBars.data.length, 1);
    assert.equal(tradingviewBars.data[0]?.symbol, "TVSMK1");
    assert.equal(tradingviewBars.data[0]?.source, "tradingview");
    assert.equal(tradingviewBars.data[0]?.interval, "1m");

    const tradingviewFilteredHistory = await request<
      JsonEnvelope<
        Array<{
          symbol: string;
          source: string;
        }>
      >
    >(
      baseUrl,
      "/api/v1/market-data/history?symbols=TVSMK1&source=tradingview&from=2026-01-01T00:00:00.000Z&limit=10",
      {
        headers: { "x-workspace-slug": workspaceSlug }
      }
    );
    assert.equal(tradingviewFilteredHistory.data.length, 1);

    const tradingviewHistoryDiagnostics = await request<
      JsonEnvelope<{
        summary: {
          total: number;
          strategyReady: number;
          referenceOnly: number;
          insufficient: number;
        };
        items: Array<{
          symbol: string;
          selectedSource: string | null;
          freshnessStatus: string;
          synthetic: boolean;
          generatedFrom: string;
          quality: {
            grade: string;
            primaryReason: string;
          };
        }>;
      }>
    >(baseUrl, "/api/v1/market-data/history/diagnostics?symbols=TVSMK1&includeStale=true&limit=10", {
      headers: { "x-workspace-slug": workspaceSlug }
    });
    assert.equal(tradingviewHistoryDiagnostics.data.summary.total, 1);
    assert.equal(tradingviewHistoryDiagnostics.data.summary.insufficient, 1);
    assert.equal(tradingviewHistoryDiagnostics.data.items[0]?.symbol, "TVSMK1");
    assert.equal(tradingviewHistoryDiagnostics.data.items[0]?.selectedSource, "tradingview");
    assert.equal(tradingviewHistoryDiagnostics.data.items[0]?.generatedFrom, "provider_quote_history");
    assert.equal(tradingviewHistoryDiagnostics.data.items[0]?.quality.grade, "insufficient");
    assert.equal(tradingviewHistoryDiagnostics.data.items[0]?.quality.primaryReason, "insufficient_points");

    const tradingviewBarDiagnostics = await request<
      JsonEnvelope<{
        summary: {
          total: number;
          strategyReady: number;
          referenceOnly: number;
          insufficient: number;
        };
        items: Array<{
          symbol: string;
          source: string;
          interval: string;
          synthetic: boolean;
          generatedFrom: string;
          quality: {
            grade: string;
            primaryReason: string;
          };
        }>;
      }>
    >(baseUrl, "/api/v1/market-data/bars/diagnostics?symbols=TVSMK1&source=tradingview&interval=1m&includeStale=true&limit=10", {
      headers: { "x-workspace-slug": workspaceSlug }
    });
    assert.equal(tradingviewBarDiagnostics.data.summary.total, 1);
    assert.equal(tradingviewBarDiagnostics.data.summary.insufficient, 1);
    assert.equal(tradingviewBarDiagnostics.data.items[0]?.symbol, "TVSMK1");
    assert.equal(tradingviewBarDiagnostics.data.items[0]?.source, "tradingview");
    assert.equal(tradingviewBarDiagnostics.data.items[0]?.generatedFrom, "quote_history");
    assert.equal(tradingviewBarDiagnostics.data.items[0]?.quality.grade, "insufficient");
    assert.equal(tradingviewBarDiagnostics.data.items[0]?.quality.primaryReason, "insufficient_bars");

    const providerStatusAfterTradingview = await request<
      JsonEnvelope<
        Array<{
          source: string;
          connected: boolean;
          freshnessStatus: string;
          readiness: string;
          strategyUsable: boolean;
          paperUsable: boolean;
          liveUsable: boolean;
          reasons: string[];
          subscribedSymbols: string[];
        }>
      >
    >(baseUrl, "/api/v1/market-data/providers?sources=tradingview", {
      headers: { "x-workspace-slug": workspaceSlug }
    });
    assert.equal(providerStatusAfterTradingview.data.length, 1);
    assert.equal(providerStatusAfterTradingview.data[0]?.source, "tradingview");
    assert.equal(providerStatusAfterTradingview.data[0]?.connected, true);
    assert.equal(providerStatusAfterTradingview.data[0]?.freshnessStatus, "fresh");
    assert.equal(providerStatusAfterTradingview.data[0]?.readiness, "degraded");
    assert.equal(providerStatusAfterTradingview.data[0]?.strategyUsable, true);
    assert.equal(providerStatusAfterTradingview.data[0]?.paperUsable, true);
    assert.equal(providerStatusAfterTradingview.data[0]?.liveUsable, false);
    assert.equal(providerStatusAfterTradingview.data[0]?.reasons.includes("non_live_source"), true);
    assert.equal(providerStatusAfterTradingview.data[0]?.subscribedSymbols.includes("TVSMK1"), true);

    const marketOverview = await request<
      JsonEnvelope<{
        generatedAt: string;
        providers: Array<{ source: string; connected: boolean }>;
        symbols: {
          total: number;
          byMarket: Array<{ market: string; total: number }>;
        };
        quotes: {
          total: number;
          fresh: number;
          stale: number;
          readiness: {
            connectedSources: string[];
            preferredSourceOrder: string[];
            effectiveSelection: {
              total: number;
              ready: number;
              degraded: number;
              blocked: number;
              strategyUsable: number;
              paperUsable: number;
              liveUsable: number;
            };
          };
          bySource: Array<{ source: string; total: number }>;
        };
        policy: {
          surface: {
            version: string;
            capabilities: {
              overview: boolean;
              selectionSummary: boolean;
              decisionSummary: boolean;
              historyQualitySummary: boolean;
              barQualitySummary: boolean;
            };
            preferredEntryPoints: {
              historyQuality: string;
              barQuality: string;
            };
          };
          sourcePriority: Array<{ source: string; priority: number }>;
        };
        leaders: {
          topGainers: Array<{ symbol: string; changePct: number | null }>;
          topLosers: Array<{ symbol: string; changePct: number | null }>;
          mostActive: Array<{ symbol: string; volume: number | null }>;
        };
      }>
    >(baseUrl, "/api/v1/market-data/overview?includeStale=true&topLimit=5", {
      headers: { "x-workspace-slug": workspaceSlug }
    });
    assert.match(marketOverview.data.generatedAt, /\d{4}-\d{2}-\d{2}T/);
    assert.equal(marketOverview.data.policy.surface.version, "market-data-v1.10-history-quality-summary");
    assert.equal(marketOverview.data.policy.surface.capabilities.overview, true);
    assert.equal(marketOverview.data.policy.surface.capabilities.selectionSummary, true);
    assert.equal(marketOverview.data.policy.surface.capabilities.decisionSummary, true);
    assert.equal(marketOverview.data.policy.surface.capabilities.historyQualitySummary, true);
    assert.equal(marketOverview.data.policy.surface.capabilities.barQualitySummary, true);
    assert.equal(marketOverview.data.policy.surface.preferredEntryPoints.historyQuality, "/api/v1/market-data/history/diagnostics");
    assert.equal(marketOverview.data.policy.surface.preferredEntryPoints.barQuality, "/api/v1/market-data/bars/diagnostics");
    assert.ok(marketOverview.data.providers.length >= 2);
    assert.ok(marketOverview.data.symbols.total >= 1);
    assert.ok(marketOverview.data.quotes.total >= 1);
    assert.equal(marketOverview.data.policy.sourcePriority[0]?.source, "kgi");
    assert.equal(marketOverview.data.quotes.readiness.connectedSources.includes("tradingview"), true);
    assert.equal(marketOverview.data.quotes.readiness.preferredSourceOrder[0], "kgi");
    assert.equal(marketOverview.data.quotes.readiness.effectiveSelection.total >= 2, true);
    assert.equal(marketOverview.data.quotes.readiness.effectiveSelection.paperUsable >= 1, true);
    assert.ok(marketOverview.data.quotes.bySource.some((item) => item.source === "manual"));
    assert.equal(marketOverview.data.leaders.topGainers[0]?.symbol, "SMK1");
    assert.equal(marketOverview.data.leaders.mostActive[0]?.symbol, "SMK1");

    const riskLimits = await request<
      JsonEnvelope<{
        accountId: string;
        maxPerTradePct: number;
        maxOrdersPerMinute: number;
      }>
    >(baseUrl, "/api/v1/risk/limits?accountId=paper-smoke", {
      headers: { "x-workspace-slug": workspaceSlug }
    });
    assert.equal(riskLimits.data.accountId, "paper-smoke");

    const updatedRiskLimits = await request<
      JsonEnvelope<{
        accountId: string;
        maxPerTradePct: number;
        symbolBlacklist: string[];
      }>
    >(baseUrl, "/api/v1/risk/limits", {
      method: "POST",
      headers: { "x-workspace-slug": workspaceSlug },
      body: JSON.stringify({
        accountId: "paper-smoke",
        maxPerTradePct: 2,
        symbolBlacklist: ["BLK1"]
      })
    });
    assert.equal(updatedRiskLimits.data.maxPerTradePct, 2);
    assert.equal(updatedRiskLimits.data.symbolBlacklist.includes("BLK1"), true);

    const riskCheck = await request<
      JsonEnvelope<{
        decision: string;
        guards: Array<{ guard: string; decision: string }>;
      }>
    >(baseUrl, "/api/v1/risk/checks", {
      method: "POST",
      headers: { "x-workspace-slug": workspaceSlug },
      body: JSON.stringify({
        order: {
          accountId: "paper-smoke",
          symbol: "SMK1",
          side: "buy",
          type: "limit",
          timeInForce: "rod",
          quantity: 10,
          price: 123.45,
          overrideGuards: [],
          overrideReason: ""
        },
        account: {
          equity: 100000,
          openOrders: 0,
          grossExposurePct: 0,
          symbolPositionPct: 0,
          themeExposurePct: 0,
          brokerConnected: true
        },
        market: {
          source: "manual",
          now: "2026-04-17T02:00:00.000Z",
          timeZone: "Asia/Taipei"
        },
        commit: true
      })
    });
    assert.equal(riskCheck.data.decision, "allow");

    const duplicateRiskCheck = await request<
      JsonEnvelope<{
        decision: string;
        guards: Array<{ guard: string; decision: string }>;
      }>
    >(baseUrl, "/api/v1/risk/checks", {
      method: "POST",
      headers: { "x-workspace-slug": workspaceSlug },
      body: JSON.stringify({
        order: {
          accountId: "paper-smoke",
          symbol: "SMK1",
          side: "buy",
          type: "limit",
          timeInForce: "rod",
          quantity: 10,
          price: 123.45,
          overrideGuards: [],
          overrideReason: ""
        },
        account: {
          equity: 100000,
          openOrders: 0,
          grossExposurePct: 0,
          symbolPositionPct: 0,
          themeExposurePct: 0,
          brokerConnected: true
        },
        market: {
          source: "manual",
          now: "2026-04-17T02:00:10.000Z",
          timeZone: "Asia/Taipei"
        }
      })
    });
    assert.equal(duplicateRiskCheck.data.decision, "block");
    assert.equal(
      duplicateRiskCheck.data.guards.some((guard) => guard.guard === "duplicate_order"),
      true
    );

    const killSwitch = await request<
      JsonEnvelope<{
        accountId: string;
        engaged: boolean;
        mode: string;
      }>
    >(baseUrl, "/api/v1/risk/kill-switch", {
      method: "POST",
      headers: { "x-workspace-slug": workspaceSlug },
      body: JSON.stringify({
        accountId: "paper-smoke",
        mode: "halted",
        reason: "Smoke halt",
        engagedBy: "ci"
      })
    });
    assert.equal(killSwitch.data.engaged, true);
    assert.equal(killSwitch.data.mode, "halted");

    const relationReplace = await request<
      JsonEnvelope<
        Array<{
          id: string;
          companyId: string;
          targetLabel: string;
          relationType: string;
        }>
      >
    >(baseUrl, `/api/v1/companies/${company.data.id}/relations`, {
      method: "PUT",
      headers: { "x-workspace-slug": workspaceSlug },
      body: JSON.stringify({
        relations: [
          {
            targetLabel: "NVIDIA",
            relationType: "customer",
            confidence: 0.9,
            sourcePath: "Pilot_Reports/Smoke/SMK1.md"
          },
          {
            targetLabel: "CoWoS",
            relationType: "technology",
            confidence: 0.7,
            sourcePath: "Pilot_Reports/Smoke/SMK1.md"
          }
        ]
      })
    });
    assert.equal(relationReplace.data.length, 2);
    assert.equal(relationReplace.data[0]?.companyId, company.data.id);

    const relationList = await request<
      JsonEnvelope<
        Array<{
          targetLabel: string;
          relationType: string;
        }>
      >
    >(baseUrl, `/api/v1/companies/${company.data.id}/relations`, {
      headers: { "x-workspace-slug": workspaceSlug }
    });
    assert.equal(relationList.data.some((item) => item.targetLabel === "NVIDIA"), true);

    const keywordReplace = await request<
      JsonEnvelope<
        Array<{
          companyId: string;
          label: string;
        }>
      >
    >(baseUrl, `/api/v1/companies/${company.data.id}/keywords`, {
      method: "PUT",
      headers: { "x-workspace-slug": workspaceSlug },
      body: JSON.stringify({
        keywords: [
          {
            label: "AI",
            confidence: 0.8,
            sourcePath: "Pilot_Reports/Smoke/SMK1.md"
          },
          {
            label: "Optics",
            confidence: 0.7,
            sourcePath: "Pilot_Reports/Smoke/SMK1.md"
          }
        ]
      })
    });
    assert.equal(keywordReplace.data.length, 2);
    assert.equal(keywordReplace.data[0]?.companyId, company.data.id);

    const keywordList = await request<
      JsonEnvelope<
        Array<{
          label: string;
        }>
      >
    >(baseUrl, `/api/v1/companies/${company.data.id}/keywords`, {
      headers: { "x-workspace-slug": workspaceSlug }
    });
    assert.equal(keywordList.data.some((item) => item.label === "AI"), true);

    const companyGraph = await request<
      JsonEnvelope<{
        focusCompanyId: string;
        nodes: Array<{ label: string; kind: string }>;
        edges: Array<{ direction: string; relationType: string }>;
        keywords: Array<{ label: string }>;
        summary: { outboundRelations: number; keywords: number };
      }>
    >(baseUrl, `/api/v1/companies/${company.data.id}/graph?limit=20&keywordLimit=10`, {
      headers: { "x-workspace-slug": workspaceSlug }
    });
    assert.equal(companyGraph.data.focusCompanyId, company.data.id);
    assert.equal(companyGraph.data.summary.outboundRelations, 2);
    assert.equal(companyGraph.data.summary.keywords, 2);
    assert.equal(companyGraph.data.nodes.some((node) => node.label === "NVIDIA"), true);

    const graphSearch = await request<
      JsonEnvelope<
        Array<{
          companyId: string;
          matchedBy: string[];
        }>
      >
    >(baseUrl, "/api/v1/company-graph/search?query=AI&limit=10", {
      headers: { "x-workspace-slug": workspaceSlug }
    });
    assert.equal(graphSearch.data.some((item) => item.companyId === company.data.id), true);

    const graphStats = await request<
      JsonEnvelope<{
        companiesWithGraph: number;
        totalRelations: number;
        totalKeywords: number;
        topConnectedCompanies: Array<{ companyId: string }>;
      }>
    >(baseUrl, "/api/v1/company-graph/stats?topLimit=10", {
      headers: { "x-workspace-slug": workspaceSlug }
    });
    assert.ok(graphStats.data.companiesWithGraph >= 1);
    assert.ok(graphStats.data.totalRelations >= 2);
    assert.ok(graphStats.data.totalKeywords >= 2);
    assert.equal(
      graphStats.data.topConnectedCompanies.some((item) => item.companyId === company.data.id),
      true
    );

    const themeGraph = await request<
      JsonEnvelope<{
        themeId: string;
        nodes: Array<{ companyId: string | null; kind: string }>;
        edges: Array<{ direction: string }>;
        topKeywords: Array<{ label: string }>;
        summary: { themeCompanyCount: number; displayedEdges: number; keywordCount: number };
      }>
    >(baseUrl, `/api/v1/themes/${theme.data.id}/graph?edgeLimit=20&keywordLimit=10`, {
      headers: { "x-workspace-slug": workspaceSlug }
    });
    assert.equal(themeGraph.data.themeId, theme.data.id);
    assert.ok(themeGraph.data.summary.themeCompanyCount >= 1);
    assert.ok(themeGraph.data.summary.displayedEdges >= 2);
    assert.ok(themeGraph.data.summary.keywordCount >= 2);
    assert.equal(
      themeGraph.data.nodes.some(
        (node) => node.kind === "theme_company" && node.companyId === company.data.id
      ),
      true
    );

    const themeGraphStats = await request<
      JsonEnvelope<{
        themeCount: number;
        connectedThemeCount: number;
        totalEdges: number;
        topThemes: Array<{ themeId: string; name: string }>;
      }>
    >(baseUrl, "/api/v1/theme-graph/stats?limit=10&keywordLimit=3", {
      headers: { "x-workspace-slug": workspaceSlug }
    });
    assert.ok(themeGraphStats.data.themeCount >= 1);
    assert.ok(themeGraphStats.data.connectedThemeCount >= 1);
    assert.ok(themeGraphStats.data.totalEdges >= 2);
    assert.equal(themeGraphStats.data.topThemes.some((item) => item.themeId === theme.data.id), true);

    const themeGraphSearch = await request<
      JsonEnvelope<{
        query: string;
        total: number;
        results: Array<{ themeId: string; matchReasons: string[] }>;
      }>
    >(baseUrl, "/api/v1/theme-graph/search?query=Smoke&limit=10&keywordLimit=3", {
      headers: { "x-workspace-slug": workspaceSlug }
    });
    assert.equal(themeGraphSearch.data.query, "Smoke");
    assert.ok(themeGraphSearch.data.total >= 1);
    assert.equal(
      themeGraphSearch.data.results.some(
        (item) => item.themeId === theme.data.id && item.matchReasons.length >= 1
      ),
      true
    );

    const themeGraphRankings = await request<
      JsonEnvelope<{
        total: number;
        results: Array<{ themeId: string; score: number; signals: string[] }>;
      }>
    >(
      baseUrl,
      "/api/v1/theme-graph/rankings?query=Smoke&marketState=Balanced&onlyConnected=false&limit=10&keywordLimit=3",
      {
        headers: { "x-workspace-slug": workspaceSlug }
      }
    );
    assert.ok(themeGraphRankings.data.total >= 1);
    assert.equal(
      themeGraphRankings.data.results.some(
        (item) => item.themeId === theme.data.id && item.score >= 1
      ),
      true
    );

    const filteredThemeGraphStats = await request<
      JsonEnvelope<{
        themeCount: number;
        connectedThemeCount: number;
        topThemes: Array<{ themeId: string }>;
      }>
    >(
      baseUrl,
      "/api/v1/theme-graph/stats?query=Smoke&marketState=Balanced&onlyConnected=false&limit=10&keywordLimit=3",
      {
        headers: { "x-workspace-slug": workspaceSlug }
      }
    );
    assert.ok(filteredThemeGraphStats.data.themeCount >= 1);
    assert.equal(
      filteredThemeGraphStats.data.topThemes.some((item) => item.themeId === theme.data.id),
      true
    );

    const themeGraphExport = await fetch(
      `${baseUrl}/api/v1/theme-graph/export?format=csv&query=Smoke&limit=10&keywordLimit=3`,
      {
        headers: { "x-workspace-slug": workspaceSlug }
      }
    );
    assert.equal(themeGraphExport.status, 200);
    assert.match(themeGraphExport.headers.get("content-type") ?? "", /text\/csv/);
    const themeGraphExportBody = await themeGraphExport.text();
    assert.match(themeGraphExportBody, /theme_id/);
    assert.match(themeGraphExportBody, /CI Smoke Theme/);

    const duplicateCompany = await request<JsonEnvelope<{ id: string; ticker: string }>>(
      baseUrl,
      "/api/v1/companies",
      {
        method: "POST",
        headers: { "x-workspace-slug": workspaceSlug },
        body: JSON.stringify({
          name: "Smoke Optics",
          ticker: "SMK1",
          market: "NASDAQ",
          country: "United States",
          themeIds: [],
          chainPosition: "Optical systems",
          beneficiaryTier: "Observation",
          exposure: {
            volume: 1,
            asp: 1,
            margin: 1,
            capacity: 1,
            narrative: 1
          },
          validation: {
            capitalFlow: "N/A",
            consensus: "N/A",
            relativeStrength: "N/A"
          },
          notes: "Duplicate smoke test company"
        })
      }
    );
    assert.equal(duplicateCompany.data.ticker, "SMK1");

    const duplicateReport = await request<
      JsonEnvelope<{
        summary: { groupCount: number; companyCount: number };
        groups: Array<{
          ticker: string;
          duplicateCount: number;
          recommendedCompanyId: string;
        }>;
      }>
    >(baseUrl, "/api/v1/companies/duplicates?limit=20&query=SMK1", {
      headers: { "x-workspace-slug": workspaceSlug }
    });
    assert.ok(duplicateReport.data.summary.groupCount >= 1);
    assert.equal(
      duplicateReport.data.groups.some(
        (group) =>
          group.ticker === "SMK1" &&
          group.duplicateCount >= 2 &&
          group.recommendedCompanyId === company.data.id
      ),
      true
    );

    const mergePreview = await request<
      JsonEnvelope<{
        allowed: boolean;
        warnings: string[];
        impact: {
          sourceCompaniesToDelete: number;
          outgoingRelationRowsToRewrite: number;
        };
      }>
    >(
      baseUrl,
      `/api/v1/companies/merge-preview?targetCompanyId=${company.data.id}&sourceCompanyIds=${duplicateCompany.data.id}`,
      {
        headers: { "x-workspace-slug": workspaceSlug }
      }
    );
    assert.equal(mergePreview.data.allowed, true);
    assert.equal(mergePreview.data.impact.sourceCompaniesToDelete, 1);
    assert.ok(mergePreview.data.impact.outgoingRelationRowsToRewrite >= 2);

    const mergeResult = await request<
      JsonEnvelope<{
        targetCompanyId: string;
        deletedCompanyIds: string[];
      }>
    >(baseUrl, "/api/v1/companies/merge", {
      method: "POST",
      headers: { "x-workspace-slug": workspaceSlug },
      body: JSON.stringify({
        targetCompanyId: company.data.id,
        sourceCompanyIds: [duplicateCompany.data.id]
      })
    });
    assert.equal(mergeResult.data.targetCompanyId, company.data.id);
    assert.equal(mergeResult.data.deletedCompanyIds.includes(duplicateCompany.data.id), true);

    const duplicateReportAfterMerge = await request<
      JsonEnvelope<{
        summary: { groupCount: number };
      }>
    >(baseUrl, "/api/v1/companies/duplicates?limit=20&query=SMK1", {
      headers: { "x-workspace-slug": workspaceSlug }
    });
    assert.equal(duplicateReportAfterMerge.data.summary.groupCount, 0);

    const signal = await request<JsonEnvelope<{ id: string; title: string }>>(baseUrl, "/api/v1/signals", {
      method: "POST",
      headers: { "x-workspace-slug": workspaceSlug },
      body: JSON.stringify({
        category: "industry",
        direction: "bullish",
        title: "CI smoke signal",
        summary: "Validates signal creation.",
        confidence: 4,
        themeIds: [theme.data.id],
        companyIds: [company.data.id]
      })
    });
    assert.equal(signal.data.title, "CI smoke signal");

    const eventTimestamp = new Date().toISOString();
    const webhookSignal = await request<
      JsonEnvelope<{ id: string; title: string; direction: string }> & {
        meta?: { duplicate: boolean; eventKey: string };
      }
    >(
      baseUrl,
      "/api/v1/webhooks/tradingview",
      {
        method: "POST",
        headers: { "x-workspace-slug": workspaceSlug },
        body: JSON.stringify({
          token: webhookToken,
          ticker: "SMK1",
          exchange: "NASDAQ",
          price: "123.45",
          interval: "1D",
          timestamp: eventTimestamp,
          eventKey: "smoke-tv-event",
          direction: "bullish",
          category: "price",
          confidence: 5,
          summary: "Webhook smoke signal",
          themeIds: [theme.data.id],
          companyIds: [company.data.id]
        })
      }
    );
    assert.match(webhookSignal.data.title, /TV Alert/);
    assert.equal(webhookSignal.data.direction, "bullish");
    assert.equal(webhookSignal.meta?.duplicate, false);

    const preferredSmk1Quote = await request<
      JsonEnvelope<
        Array<{
          symbol: string;
          source: string;
          last: number | null;
        }>
      >
    >(baseUrl, "/api/v1/market-data/quotes?symbols=SMK1&limit=10", {
      headers: { "x-workspace-slug": workspaceSlug }
    });
    assert.equal(preferredSmk1Quote.data.length, 1);
    assert.equal(preferredSmk1Quote.data[0]?.symbol, "SMK1");
    assert.equal(preferredSmk1Quote.data[0]?.source, "tradingview");
    assert.equal(preferredSmk1Quote.data[0]?.last, 123.45);

    const resolvedSmk1Quote = await request<
      JsonEnvelope<
        Array<{
          symbol: string;
          selectedSource: string | null;
          freshnessStatus: string;
          fallbackReason: string;
          preferredSource: string | null;
          candidates: Array<{ source: string; freshnessStatus: string }>;
        }>
      >
    >(baseUrl, "/api/v1/market-data/resolve?symbols=SMK1&limit=10", {
      headers: { "x-workspace-slug": workspaceSlug }
    });
    assert.equal(resolvedSmk1Quote.data.length, 1);
    assert.equal(resolvedSmk1Quote.data[0]?.selectedSource, "tradingview");
    assert.equal(resolvedSmk1Quote.data[0]?.freshnessStatus, "fresh");
    assert.equal(resolvedSmk1Quote.data[0]?.fallbackReason, "higher_priority_unavailable");
    assert.equal(resolvedSmk1Quote.data[0]?.preferredSource, "tradingview");
    assert.equal(
      resolvedSmk1Quote.data[0]?.candidates.some((item) => item.source === "manual"),
      true
    );
    assert.equal(
      resolvedSmk1Quote.data[0]?.candidates.some((item) => item.source === "tradingview"),
      true
    );

    const smk1History = await request<
      JsonEnvelope<
        Array<{
          symbol: string;
          source: string;
        }>
      >
    >(baseUrl, "/api/v1/market-data/history?symbols=SMK1&limit=10", {
      headers: { "x-workspace-slug": workspaceSlug }
    });
    assert.equal(smk1History.data.length >= 1, true);
    assert.equal(smk1History.data[0]?.source, "tradingview");

    const smk1Bars = await request<
      JsonEnvelope<
        Array<{
          symbol: string;
          source: string;
        }>
      >
    >(baseUrl, "/api/v1/market-data/bars?symbols=SMK1&interval=1m&limit=10", {
      headers: { "x-workspace-slug": workspaceSlug }
    });
    assert.equal(smk1Bars.data.length >= 1, true);
    assert.equal(smk1Bars.data[0]?.source, "tradingview");

    const duplicateWebhookSignal = await request<
      JsonEnvelope<{ id: string; title: string; direction: string }> & {
        meta?: { duplicate: boolean; eventKey: string };
      }
    >(baseUrl, "/api/v1/webhooks/tradingview", {
      method: "POST",
      headers: { "x-workspace-slug": workspaceSlug },
      body: JSON.stringify({
        token: webhookToken,
        ticker: "SMK1",
        exchange: "NASDAQ",
        price: "123.45",
        interval: "1D",
        timestamp: eventTimestamp,
        eventKey: "smoke-tv-event",
        direction: "bullish",
        category: "price",
        confidence: 5,
        summary: "Webhook smoke signal",
        themeIds: [theme.data.id],
        companyIds: [company.data.id]
      })
    });
    assert.equal(duplicateWebhookSignal.data.id, webhookSignal.data.id);
    assert.equal(duplicateWebhookSignal.meta?.duplicate, true);

    const staleWebhookResponse = await fetch(`${baseUrl}/api/v1/webhooks/tradingview`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-workspace-slug": workspaceSlug
      },
      body: JSON.stringify({
        token: webhookToken,
        ticker: "SMK1",
        timestamp: "2020-01-01T00:00:00.000Z"
      })
    });
    assert.equal(staleWebhookResponse.status, 400);
    const staleWebhookBody = (await staleWebhookResponse.json()) as { error: string };
    assert.equal(staleWebhookBody.error, "timestamp_out_of_range");

    const plan = await request<JsonEnvelope<{ id: string; companyId: string }>>(baseUrl, "/api/v1/plans", {
      method: "POST",
      headers: { "x-workspace-slug": workspaceSlug },
      body: JSON.stringify({
        companyId: company.data.id,
        status: "ready",
        entryPlan: "Enter on constructive pullback.",
        invalidationPlan: "Exit on failed reclaim.",
        targetPlan: "Scale into momentum.",
        riskReward: "1:2.8",
        notes: "Smoke-test plan"
      })
    });
    assert.equal(plan.data.companyId, company.data.id);

    const review = await request<JsonEnvelope<{ id: string; tradePlanId: string }>>(
      baseUrl,
      "/api/v1/reviews",
      {
        method: "POST",
        headers: { "x-workspace-slug": workspaceSlug },
        body: JSON.stringify({
          tradePlanId: plan.data.id,
          outcome: "Captured part of the move.",
          attribution: "Signal and setup aligned.",
          lesson: "Keep position sizing disciplined.",
          setupTags: ["smoke", "ci"],
          executionQuality: 4
        })
      }
    );
    assert.equal(review.data.tradePlanId, plan.data.id);

    const brief = await request<JsonEnvelope<{ id: string; status: string }>>(baseUrl, "/api/v1/briefs", {
      method: "POST",
      headers: { "x-workspace-slug": workspaceSlug },
      body: JSON.stringify({
        date: "2026-04-13",
        marketState: "Balanced",
        sections: [
          {
            heading: "Smoke",
            body: "Brief creation works."
          }
        ],
        generatedBy: "manual",
        status: "draft"
      })
    });
    assert.equal(brief.data.status, "draft");

    const registration = await request<
      JsonEnvelope<{ deviceId: string; deviceToken: string }>
    >(baseUrl, "/api/v1/openalice/register", {
      method: "POST",
      headers: { "x-workspace-slug": workspaceSlug },
      body: JSON.stringify({
        deviceId: "ci-device",
        deviceName: "CI OpenAlice",
        capabilities: ["drafts", "summaries"]
      })
    });
    assert.equal(registration.data.deviceId, "ci-device");

    const devicesBefore = await request<
      JsonEnvelope<Array<{ deviceId: string; status: string }>>
    >(baseUrl, "/api/v1/openalice/devices", {
      headers: { "x-workspace-slug": workspaceSlug }
    });
    const activeDevice = devicesBefore.data.find((item) => item.deviceId === registration.data.deviceId);
    assert.ok(activeDevice, "Expected registered OpenAlice device to be listed.");
    assert.equal(activeDevice?.status, "active");

    const job = await request<JsonEnvelope<{ jobId: string }>>(baseUrl, "/api/v1/openalice/jobs", {
      method: "POST",
      headers: { "x-workspace-slug": workspaceSlug },
      body: JSON.stringify({
        taskType: "daily_brief",
        schemaName: "BriefDraft",
        instructions: "Draft a concise CI brief.",
        contextRefs: [{ type: "theme", id: theme.data.id }],
        parameters: { source: "ci" }
      })
    });

    const deviceHeaders = {
      Authorization: `Bearer ${registration.data.deviceToken}`,
      "x-device-id": registration.data.deviceId
    };

    const claim = await request<JsonEnvelope<{ jobId: string }>>(baseUrl, "/api/internal/openalice/jobs/claim", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${registration.data.deviceToken}`
      },
      body: JSON.stringify({
        deviceId: registration.data.deviceId
      })
    });
    assert.equal(claim.data.jobId, job.data.jobId);

    await request<JsonEnvelope<{ ok: boolean }>>(
      baseUrl,
      `/api/internal/openalice/jobs/${job.data.jobId}/heartbeat`,
      {
        method: "POST",
        headers: deviceHeaders,
        body: JSON.stringify({
          deviceId: registration.data.deviceId
        })
      }
    );

    const result = await request<JsonEnvelope<{ status: string }>>(
      baseUrl,
      `/api/internal/openalice/jobs/${job.data.jobId}/result`,
      {
        method: "POST",
        headers: deviceHeaders,
        body: JSON.stringify({
          jobId: job.data.jobId,
          status: "draft_ready",
          schemaName: "BriefDraft",
          structured: {
            title: "CI Brief",
            bullets: ["Smoke passed"]
          },
          rawText: "Draft ready",
          warnings: [],
          artifacts: []
        })
      }
    );
    assert.equal(result.data.status, "draft_ready");

    const jobs = await request<JsonEnvelope<Array<{ id: string; status: string }>>>(
      baseUrl,
      "/api/v1/openalice/jobs",
      {
        headers: { "x-workspace-slug": workspaceSlug }
      }
    );
    const createdJob = jobs.data.find((item) => item.id === job.data.jobId);
    assert.ok(createdJob, "Expected smoke job to be listed.");
    assert.equal(createdJob?.status, "draft_ready");

    const reviewed = await request<
      JsonEnvelope<{ id: string; status: string; reviewedAt: string }>
    >(baseUrl, `/api/v1/openalice/jobs/${job.data.jobId}/review`, {
      method: "PATCH",
      headers: { "x-workspace-slug": workspaceSlug },
      body: JSON.stringify({
        status: "published",
        note: "smoke review publish"
      })
    });
    assert.equal(reviewed.data.id, job.data.jobId);
    assert.equal(reviewed.data.status, "published");

    const revokedDevice = await request<
      JsonEnvelope<{ deviceId: string; status: string }>
    >(baseUrl, `/api/v1/openalice/devices/${registration.data.deviceId}/revoke`, {
      method: "POST",
      headers: { "x-workspace-slug": workspaceSlug },
      body: JSON.stringify({})
    });
    assert.equal(revokedDevice.data.deviceId, registration.data.deviceId);
    assert.equal(revokedDevice.data.status, "revoked");

    const cleanup = await request<
      JsonEnvelope<{ revokedCount: number; staleBeforeCleanup: number }>
    >(baseUrl, "/api/v1/openalice/devices/cleanup", {
      method: "POST",
      headers: { "x-workspace-slug": workspaceSlug },
      body: JSON.stringify({ staleSeconds: 1 })
    });
    assert.equal(cleanup.data.revokedCount, 0);
    assert.equal(cleanup.data.staleBeforeCleanup, 0);

    const observability = await request<
      JsonEnvelope<{
        source: string;
        metrics: {
          queuedJobs: number;
          runningJobs: number;
          terminalJobs: number;
          activeDevices: number;
        };
      }>
    >(baseUrl, "/api/v1/openalice/observability", {
      headers: { "x-workspace-slug": workspaceSlug }
    });
    assert.equal(observability.data.source, "bridge_fallback");
    assert.equal(observability.data.metrics.queuedJobs, 0);
    assert.equal(observability.data.metrics.runningJobs, 0);
    assert.ok(observability.data.metrics.terminalJobs >= 1);
    assert.equal(observability.data.metrics.activeDevices, 0);

    const auditLogs = await request<
      JsonEnvelope<Array<{ id: string; action: string; entityType: string }>>
    >(baseUrl, "/api/v1/audit-logs", {
      headers: { "x-workspace-slug": workspaceSlug }
    });
    assert.ok(Array.isArray(auditLogs.data));

    const filteredAuditLogs = await request<
      JsonEnvelope<Array<{ action: string; entityType: string }>>
    >(baseUrl, "/api/v1/audit-logs?action=create&entityType=theme", {
      headers: { "x-workspace-slug": workspaceSlug }
    });
    assert.ok(Array.isArray(filteredAuditLogs.data));

    const auditSummary = await request<
      JsonEnvelope<{
        windowHours: number;
        total: number;
        actions: Array<{ action: string; count: number }>;
        entities: Array<{ entityType: string; count: number }>;
      }>
    >(baseUrl, "/api/v1/audit-logs/summary?hours=24", {
      headers: { "x-workspace-slug": workspaceSlug }
    });
    assert.equal(auditSummary.data.windowHours, 24);
    assert.ok(auditSummary.data.total >= 0);
    assert.ok(Array.isArray(auditSummary.data.actions));
    assert.ok(Array.isArray(auditSummary.data.entities));

    const richerAuditLogs = await request<
      JsonEnvelope<
        Array<{
          action: string;
          entityType: string;
          method?: string;
          role?: string;
        }>
      >
    >(baseUrl, "/api/v1/audit-logs?method=POST&role=Owner&search=theme", {
      headers: { "x-workspace-slug": workspaceSlug }
    });
    assert.ok(
      richerAuditLogs.data.every(
        (entry) => entry.method === "POST" && entry.role === "Owner"
      )
    );

    const auditExport = await fetch(
      `${baseUrl}/api/v1/audit-logs/export?format=csv&method=POST&search=theme`,
      {
        headers: { "x-workspace-slug": workspaceSlug }
      }
    );
    assert.equal(auditExport.status, 200);
    assert.match(auditExport.headers.get("content-type") ?? "", /text\/csv/);
    const auditExportBody = await auditExport.text();
    assert.match(auditExportBody, /created_at/);
    assert.match(auditExportBody, /payload_json/);

    const eventHistory = await request<
      JsonEnvelope<
        Array<{
          source: string;
          entityType: string;
          title: string;
        }>
      >
    >(baseUrl, "/api/v1/event-history?hours=24&limit=10&sources=audit,signal,plan,review,brief,openalice&search=smoke", {
      headers: { "x-workspace-slug": workspaceSlug }
    });
    assert.ok(Array.isArray(eventHistory.data));
    assert.ok(eventHistory.data.some((entry) => entry.source === "signal"));

    const eventHistorySummary = await request<
      JsonEnvelope<{
        windowHours: number;
        total: number;
        sources: Array<{ source: string; count: number }>;
        severities: Array<{ severity: string; count: number }>;
      }>
    >(baseUrl, "/api/v1/event-history/summary?hours=24&sources=audit,signal,plan,review,brief,openalice", {
      headers: { "x-workspace-slug": workspaceSlug }
    });
    assert.equal(eventHistorySummary.data.windowHours, 24);
    assert.ok(eventHistorySummary.data.total >= 1);
    assert.ok(Array.isArray(eventHistorySummary.data.sources));
    assert.ok(Array.isArray(eventHistorySummary.data.severities));

    const eventHistoryExport = await fetch(
      `${baseUrl}/api/v1/event-history/export?format=csv&hours=24&severity=success&limit=10`,
      {
        headers: { "x-workspace-slug": workspaceSlug }
      }
    );
    assert.equal(eventHistoryExport.status, 200);
    assert.match(eventHistoryExport.headers.get("content-type") ?? "", /text\/csv/);
    const eventHistoryExportBody = await eventHistoryExport.text();
    assert.match(eventHistoryExportBody, /created_at/);
    assert.match(eventHistoryExportBody, /severity/);

    const opsSnapshot = await request<
      JsonEnvelope<{
        generatedAt: string;
        stats: { companies: number; themes: number };
        rankings: { total: number; results: Array<{ themeId: string; score: number }> };
        openAlice: { queue: { reviewable: number } };
        eventHistory: {
          summary: { total: number };
          recent: Array<{ source: string }>;
        };
        latest: { companies: Array<{ id: string }> };
      }>
    >(baseUrl, "/api/v1/ops/snapshot?auditHours=24&recentLimit=5", {
      headers: { "x-workspace-slug": workspaceSlug }
    });
    assert.match(opsSnapshot.data.generatedAt, /\d{4}-\d{2}-\d{2}T/);
    assert.ok(opsSnapshot.data.stats.companies >= 1);
    assert.ok(opsSnapshot.data.stats.themes >= 1);
    assert.ok(opsSnapshot.data.rankings.total >= 1);
    assert.ok(Array.isArray(opsSnapshot.data.rankings.results));
    assert.ok(Array.isArray(opsSnapshot.data.latest.companies));
    assert.ok(opsSnapshot.data.openAlice.queue.reviewable >= 0);
    assert.ok(opsSnapshot.data.eventHistory.summary.total >= 0);
    assert.ok(Array.isArray(opsSnapshot.data.eventHistory.recent));

    const opsTrends = await request<
      JsonEnvelope<{
        summary: {
          days: number;
          timeZone: string;
          totals: { signalsCreated: number; auditEvents: number };
          latestDay: { date: string } | null;
        };
        series: Array<{ date: string; totalActivity: number }>;
      }>
    >(baseUrl, "/api/v1/ops/trends?days=7&timeZone=Asia/Taipei", {
      headers: { "x-workspace-slug": workspaceSlug }
    });
    assert.equal(opsTrends.data.summary.days, 7);
    assert.equal(opsTrends.data.summary.timeZone, "Asia/Taipei");
    assert.ok(opsTrends.data.summary.totals.signalsCreated >= 1);
    assert.ok(opsTrends.data.summary.totals.auditEvents >= 0);
    assert.ok(opsTrends.data.series.length >= 7);
    assert.ok(opsTrends.data.series.some((item) => item.totalActivity >= 1));
    assert.ok(opsTrends.data.summary.latestDay !== null);

    console.log("Smoke API checks passed.");
  } catch (error) {
    const details = [
      error instanceof Error ? error.stack ?? error.message : String(error),
      stdout ? `--- stdout ---\n${stdout}` : "",
      stderr ? `--- stderr ---\n${stderr}` : ""
    ]
      .filter(Boolean)
      .join("\n");

    throw new Error(details);
  } finally {
    if (!server.killed) {
      server.kill("SIGTERM");
      await delay(250);
      if (server.exitCode === null) {
        server.kill("SIGKILL");
      }
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
