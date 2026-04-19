import process from "node:process";
import { randomUUID } from "node:crypto";

type VerifyConfig = {
  apiBase: string;
  webBase: string | null;
  workspaceSlug: string;
  accountId: string;
  symbol: string;
  // Second symbol dedicated to the resting-limit-then-cancel scenario. Must
  // differ from `symbol` so the duplicate-intent risk guard doesn't collapse
  // the two flows into a single order row.
  cancelSymbol: string;
  checkPortfolio: boolean;
};

type Envelope<T> = { data: T };

type DecisionSummaryResponse = {
  generatedAt: string;
  items: Array<{
    symbol: string;
    selectedSource: string | null;
    readiness: string;
    freshnessStatus: string;
    fallbackReason: string;
    staleReason: string;
    primaryReason: string;
    quote: {
      source: string;
      last: number | null;
      bid: number | null;
      ask: number | null;
      timestamp: string;
      ageMs: number;
      isStale: boolean;
    } | null;
    paper: {
      decision: string;
      usable: boolean;
      safe: boolean;
      primaryReason: string;
    };
    execution: {
      decision: string;
      usable: boolean;
      safe: boolean;
      primaryReason: string;
    };
  }>;
};

type TradingOrderResult = {
  blocked: boolean;
  order: {
    id: string;
    status: string;
    quoteContext: unknown;
  } | null;
  quoteGate: {
    decision: string;
    blocked: boolean;
    reasons: string[];
  } | null;
};

type ExecutionEvent = {
  type: string;
  status: string;
  payload: Record<string, unknown> | null;
};

function argValue(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

function loadConfig(): VerifyConfig {
  const apiBase =
    argValue("--base") ??
    process.env.EXEC_VERIFY_API_BASE ??
    "http://127.0.0.1:3001";
  const webBase =
    argValue("--web-base") ?? process.env.EXEC_VERIFY_WEB_BASE ?? null;
  const workspaceSlug =
    argValue("--workspace") ??
    process.env.EXEC_VERIFY_WORKSPACE ??
    `execution-verify-${Date.now()}`;
  const accountId =
    argValue("--account") ?? process.env.EXEC_VERIFY_ACCOUNT_ID ?? "paper-default";
  const symbol =
    argValue("--symbol") ??
    process.env.EXEC_VERIFY_SYMBOL ??
    `PX${randomUUID().slice(0, 8).toUpperCase()}`;
  const cancelSymbol =
    argValue("--cancel-symbol") ??
    process.env.EXEC_VERIFY_CANCEL_SYMBOL ??
    `CX${randomUUID().slice(0, 8).toUpperCase()}`;
  const checkPortfolio =
    !process.argv.includes("--skip-portfolio") &&
    process.env.EXEC_VERIFY_SKIP_PORTFOLIO !== "1";

  return {
    apiBase: apiBase.replace(/\/$/, ""),
    webBase: webBase ? webBase.replace(/\/$/, "") : null,
    workspaceSlug,
    accountId,
    symbol,
    cancelSymbol,
    checkPortfolio
  };
}

async function requestJson<T>(
  config: VerifyConfig,
  path: string,
  init?: RequestInit
): Promise<{ status: number; json: Envelope<T> }> {
  const response = await fetch(`${config.apiBase}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-workspace-slug": config.workspaceSlug,
      ...(init?.headers ?? {})
    }
  });

  const json = (await response.json()) as Envelope<T>;
  return { status: response.status, json };
}

async function requestText(url: string): Promise<{ status: number; text: string }> {
  const response = await fetch(url);
  return { status: response.status, text: await response.text() };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  const config = loadConfig();
  const portfolioRoute = config.checkPortfolio && config.webBase
    ? await requestText(`${config.webBase}/portfolio`)
    : null;

  const quoteTimestamp = new Date().toISOString();
  await requestJson(config, "/api/v1/market-data/paper-quotes", {
    method: "POST",
    body: JSON.stringify({
      source: "paper",
      quotes: [
        {
          symbol: config.symbol,
          market: "TWSE",
          last: 333.5,
          bid: 333.0,
          ask: 334.0,
          timestamp: quoteTimestamp
        }
      ]
    })
  });

  await requestJson(config, "/api/v1/risk/limits", {
    method: "POST",
    body: JSON.stringify({
      accountId: config.accountId,
      maxPerTradePct: 100,
      maxDailyLossPct: 100,
      maxSinglePositionPct: 100,
      maxGrossExposurePct: 200,
      maxThemeCorrelatedPct: 100,
      maxOpenOrders: 99,
      maxOrdersPerMinute: 99,
      tradingHoursStart: "00:00",
      tradingHoursEnd: "23:59",
      whitelistOnly: false,
      whitelistSymbols: [],
      blacklistSymbols: []
    })
  });

  const decisionSummary = await requestJson<DecisionSummaryResponse>(
    config,
    `/api/v1/market-data/decision-summary?symbols=${encodeURIComponent(config.symbol)}&includeStale=true&limit=1`
  );
  const item = decisionSummary.json.data.items[0] ?? null;
  assert(item, "decision-summary did not return an item");

  const orderPayload = {
    accountId: config.accountId,
    symbol: config.symbol,
    side: "buy",
    type: "market",
    timeInForce: "rod",
    quantity: 1000,
    price: null,
    stopPrice: null,
    tradePlanId: null,
    strategyId: null,
    overrideGuards: ["quote_review"],
    overrideReason: "operator accepted paper review gate"
  };

  const preview = await requestJson<TradingOrderResult>(
    config,
    "/api/v1/trading/orders/preview",
    {
      method: "POST",
      body: JSON.stringify(orderPayload)
    }
  );

  const submit = await requestJson<TradingOrderResult>(
    config,
    "/api/v1/trading/orders",
    {
      method: "POST",
      body: JSON.stringify(orderPayload)
    }
  );

  const events = await requestJson<ExecutionEvent[]>(
    config,
    `/api/v1/trading/events?accountId=${encodeURIComponent(config.accountId)}&limit=10`
  );

  const eventTypes = events.json.data.map((event) => event.type);
  const eventWithQuoteDecision = events.json.data.find(
    (event) => event.payload && "quoteDecision" in event.payload
  );
  const eventWithAccountId = events.json.data.find(
    (event) => event.payload?.accountId === config.accountId
  );
  const portfolioTitle =
    portfolioRoute?.text.match(/<title>([^<]+)<\/title>/i)?.[1] ?? null;

  assert(decisionSummary.status === 200, "decision-summary request failed");
  assert(preview.json.data.blocked === false, "preview unexpectedly blocked");
  assert(
    preview.json.data.quoteGate?.decision === "review_accepted",
    `preview quoteGate decision was ${preview.json.data.quoteGate?.decision ?? "null"}`
  );
  assert(submit.status === 201, `submit status was ${submit.status}, expected 201`);
  assert(submit.json.data.blocked === false, "submit unexpectedly blocked");
  assert(
    submit.json.data.quoteGate?.decision === "review_accepted",
    `submit quoteGate decision was ${submit.json.data.quoteGate?.decision ?? "null"}`
  );
  assert(submit.json.data.order?.status === "filled", "order did not fill");
  assert(Boolean(submit.json.data.order?.quoteContext), "order.quoteContext missing");
  assert(events.status === 200, `events status was ${events.status}`);
  assert(events.json.data.length > 0, "events history returned 0 rows");
  assert(eventTypes.includes("submit"), "events history missing submit");
  assert(eventTypes.includes("fill"), "events history missing fill");
  assert(Boolean(eventWithQuoteDecision), "events history missing quoteDecision payload");
  assert(Boolean(eventWithAccountId), "events history missing accountId payload");

  const output = {
    kind: "execution-lane-verify",
    success: true,
    verifiedAt: new Date().toISOString(),
    apiBase: config.apiBase,
    webBase: config.webBase,
    workspaceSlug: config.workspaceSlug,
    accountId: config.accountId,
    symbol: config.symbol,
    portfolio: portfolioRoute
      ? {
          status: portfolioRoute.status,
          title: portfolioTitle,
          hasIufMarker: portfolioRoute.text.includes("IUF"),
          hasNextDataMarker: portfolioRoute.text.includes("__NEXT_DATA__")
        }
      : null,
    decisionSummary: {
      selectedSource: item.selectedSource,
      readiness: item.readiness,
      freshnessStatus: item.freshnessStatus,
      fallbackReason: item.fallbackReason,
      staleReason: item.staleReason,
      primaryReason: item.primaryReason,
      paperDecision: item.paper.decision,
      executionDecision: item.execution.decision
    },
    preview: {
      status: preview.status,
      blocked: preview.json.data.blocked,
      quoteGateDecision: preview.json.data.quoteGate?.decision ?? null
    },
    submit: {
      status: submit.status,
      blocked: submit.json.data.blocked,
      quoteGateDecision: submit.json.data.quoteGate?.decision ?? null,
      orderStatus: submit.json.data.order?.status ?? null,
      hasQuoteContext: Boolean(submit.json.data.order?.quoteContext)
    },
    events: {
      status: events.status,
      count: events.json.data.length,
      eventTypes,
      hasQuoteDecision: Boolean(eventWithQuoteDecision),
      hasAccountId: Boolean(eventWithAccountId)
    },
    checks: {
      portfolioReachable: portfolioRoute ? portfolioRoute.status === 200 : null,
      decisionSummaryAvailable: decisionSummary.status === 200,
      previewAllowsReviewAccepted:
        preview.status === 200 &&
        preview.json.data.blocked === false &&
        preview.json.data.quoteGate?.decision === "review_accepted",
      submitAllowsReviewAccepted:
        submit.status === 201 &&
        submit.json.data.blocked === false &&
        submit.json.data.quoteGate?.decision === "review_accepted",
      orderFilled:
        submit.json.data.order?.status === "filled" &&
        Boolean(submit.json.data.order?.quoteContext),
      eventsRecorded:
        events.status === 200 &&
        eventTypes.includes("submit") &&
        eventTypes.includes("fill") &&
        Boolean(eventWithQuoteDecision) &&
        Boolean(eventWithAccountId)
    }
  };

  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error("[verify-execution-lane]", error);
  process.exitCode = 1;
});
