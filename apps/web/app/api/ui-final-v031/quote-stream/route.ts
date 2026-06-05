import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL
  ?? (process.env.NODE_ENV === "production" ? "" : "http://localhost:3001");
const WORKSPACE_SLUG = process.env.NEXT_PUBLIC_DEFAULT_WORKSPACE_SLUG ?? "primary-desk";

const STREAM_HEADERS = {
  "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
  "CDN-Cache-Control": "no-store",
  "Vercel-CDN-Cache-Control": "no-store",
  "Connection": "keep-alive",
  "Content-Type": "text/event-stream; charset=utf-8",
  "X-Accel-Buffering": "no",
};

const STREAM_INTERVAL_MS = 2_000;
const STREAM_MAX_LIFETIME_MS = 120_000;

type UpstreamResult = {
  ok: boolean;
  status: number;
  data: unknown;
  error?: string;
};

function validSymbol(symbol: string | null) {
  const normalized = String(symbol || "").trim().toUpperCase();
  return /^[0-9A-Z._-]{2,16}$/.test(normalized) ? normalized : null;
}

function validCompanyId(companyId: string | null) {
  const normalized = String(companyId || "").trim();
  return /^[0-9A-Za-z._:-]{1,96}$/.test(normalized) ? normalized : null;
}

function unwrap(json: unknown): unknown {
  if (json && typeof json === "object" && Object.prototype.hasOwnProperty.call(json, "data")) {
    return (json as { data?: unknown }).data;
  }
  return json;
}

function nestedArray(value: unknown, key: string): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    const nested = (value as Record<string, unknown>)[key];
    return Array.isArray(nested) ? nested : [];
  }
  return [];
}

function firstPositiveNumber(...values: unknown[]) {
  for (const raw of values) {
    const value = Number(raw);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

function finiteNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function roundNumber(value: number, digits = 2) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function normalizeSymbolToken(value: unknown) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/\.TW$/, "")
    .replace(/[^0-9A-Z._-]/g, "");
}

function tickSymbolMatch(tick: Record<string, unknown>, symbol: string): boolean | null {
  const expected = normalizeSymbolToken(symbol);
  const keys = ["symbol", "stockNo", "stockId", "stock_id", "code", "ticker", "ch"];
  let sawSymbolField = false;
  for (const key of keys) {
    const raw = tick[key];
    if (raw === null || raw === undefined || raw === "") continue;
    sawSymbolField = true;
    if (normalizeSymbolToken(raw) === expected) return true;
  }
  return sawSymbolField ? false : null;
}

function latestTick(ticks: unknown[], symbol: string, allowUnlabeled: boolean) {
  if (!ticks.length) return null;
  const scored = ticks
    .filter((tick): tick is Record<string, unknown> => Boolean(tick) && typeof tick === "object")
    .filter((tick) => {
      const match = tickSymbolMatch(tick, symbol);
      return match === true || (allowUnlabeled && match === null);
    })
    .map((tick, index) => {
      const stamp = String(tick._received_at ?? tick.datetime ?? tick.timestamp ?? tick.ts ?? "");
      const parsed = Date.parse(stamp);
      return { tick, score: Number.isFinite(parsed) ? parsed : index };
    })
    .sort((a, b) => a.score - b.score);
  return scored[scored.length - 1]?.tick ?? null;
}

function tickLastPrice(tick: Record<string, unknown> | null) {
  if (!tick) return null;
  return firstPositiveNumber(tick.close, tick.price, tick.closePrice, tick.lastPrice);
}

async function upstreamFetch(path: string, request: NextRequest): Promise<UpstreamResult> {
  if (!API_BASE) {
    return { ok: false, status: 503, data: null, error: "API_BASE_UNCONFIGURED" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4_000);
  try {
    const headers = new Headers({
      "Content-Type": "application/json",
      "x-workspace-slug": request.headers.get("x-workspace-slug") ?? WORKSPACE_SLUG,
    });
    const cookie = request.headers.get("cookie");
    if (cookie) headers.set("cookie", cookie);

    const response = await fetch(new URL(path, API_BASE), {
      method: "GET",
      headers,
      cache: "no-store",
      signal: controller.signal,
    });
    const contentType = response.headers.get("content-type") || "";
    const json = contentType.includes("json") ? await response.json().catch(() => null) : null;
    return {
      ok: response.ok,
      status: response.status,
      data: unwrap(json),
      error: response.ok ? undefined : `api_${response.status}`,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: error instanceof Error ? error.name || error.message : "upstream_fetch_failed",
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function buildQuotePayload(symbol: string, companyId: string | null, request: NextRequest, sequence: number) {
  const [quoteResult, bidAskResult, ticksResult] = await Promise.all([
    companyId
      ? upstreamFetch(`/api/v1/companies/${encodeURIComponent(companyId)}/quote/realtime`, request)
      : Promise.resolve({ ok: false, status: 0, data: null, error: "company_id_unavailable" } satisfies UpstreamResult),
    upstreamFetch(`/api/v1/kgi/quote/bidask?symbol=${encodeURIComponent(symbol)}`, request),
    upstreamFetch(`/api/v1/kgi/quote/ticks?symbol=${encodeURIComponent(symbol)}&limit=16`, request),
  ]);

  const quote = quoteResult.ok ? quoteResult.data : null;
  const bidAsk = bidAskResult.ok ? bidAskResult.data : null;
  const ticksEnvelope = ticksResult.ok ? ticksResult.data : null;
  const ticks = nestedArray(ticksEnvelope, "ticks");
  const quoteObject = quote && typeof quote === "object" ? quote as Record<string, unknown> : {};
  const quotePrice = firstPositiveNumber(
    quoteObject.lastPrice,
    quoteObject.price,
    quoteObject.close,
    quoteObject.closePrice,
  );
  const tick = latestTick(ticks, symbol, quotePrice === null);
  const tickPrice = tickLastPrice(tick);
  const lastPrice = tickPrice ?? quotePrice;
  const prevClose = firstPositiveNumber(
    quoteObject.prevClose,
    quoteObject.previousClose,
    quoteObject.referencePrice,
    quoteObject.yesterdayClose,
    quoteObject.lastClose,
  );
  const computedChange = lastPrice !== null && prevClose !== null
    ? roundNumber(lastPrice - prevClose)
    : null;
  const computedChangePct = computedChange !== null && prevClose !== null && prevClose > 0
    ? roundNumber((computedChange / prevClose) * 100)
    : null;
  const quoteChange = finiteNumber(quoteObject.change ?? quoteObject.changePrice);
  const quoteChangePct = finiteNumber(quoteObject.changePct ?? quoteObject.changePercent);
  const tickChange = tick ? finiteNumber(tick.price_chg ?? tick.change ?? tick.changePrice) : null;
  const tickPct = tick ? finiteNumber(tick.pct_chg ?? tick.changePct ?? tick.changePercent) : null;

  return {
    symbol,
    sequence,
    serverTime: new Date().toISOString(),
    source: "web_quote_stream",
    pollIntervalMs: STREAM_INTERVAL_MS,
    quote,
    bidAsk,
    ticks,
    lastPrice,
    prevClose,
    change: computedChange ?? quoteChange ?? tickChange ?? null,
    changePct: computedChangePct ?? quoteChangePct ?? tickPct ?? null,
    upstream: {
      quote: { ok: quoteResult.ok, status: quoteResult.status, error: quoteResult.error ?? null },
      bidAsk: { ok: bidAskResult.ok, status: bidAskResult.status, error: bidAskResult.error ?? null },
      ticks: { ok: ticksResult.ok, status: ticksResult.status, error: ticksResult.error ?? null },
    },
    degraded: !quoteResult.ok || lastPrice == null,
  };
}

export async function GET(request: NextRequest) {
  const symbol = validSymbol(request.nextUrl.searchParams.get("symbol"));
  const companyId = validCompanyId(request.nextUrl.searchParams.get("companyId"));

  if (!symbol) {
    return new Response("event: error\ndata: {\"error\":\"INVALID_SYMBOL\"}\n\n", {
      status: 400,
      headers: STREAM_HEADERS,
    });
  }

  const encoder = new TextEncoder();
  let interval: ReturnType<typeof setInterval> | null = null;
  let lifetime: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  let sequence = 0;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };

      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (interval) clearInterval(interval);
        if (lifetime) clearTimeout(lifetime);
        try {
          controller.close();
        } catch {
          // stream already closed
        }
      };

      const tick = async () => {
        if (closed) return;
        sequence += 1;
        const payload = await buildQuotePayload(symbol, companyId, request, sequence);
        send("quote", payload);
      };

      send("ready", {
        symbol,
        source: "web_quote_stream",
        pollIntervalMs: STREAM_INTERVAL_MS,
        serverTime: new Date().toISOString(),
      });
      tick().catch((error) => {
        send("error", { error: error instanceof Error ? error.message : "quote_stream_tick_failed" });
      });
      interval = setInterval(() => {
        tick().catch((error) => {
          send("error", { error: error instanceof Error ? error.message : "quote_stream_tick_failed" });
        });
      }, STREAM_INTERVAL_MS);
      lifetime = setTimeout(() => {
        send("done", { symbol, reason: "stream_lifetime_elapsed", serverTime: new Date().toISOString() });
        cleanup();
      }, STREAM_MAX_LIFETIME_MS);
      request.signal.addEventListener("abort", cleanup, { once: true });
    },
    cancel() {
      closed = true;
      if (interval) clearInterval(interval);
      if (lifetime) clearTimeout(lifetime);
    },
  });

  return new Response(stream, { headers: STREAM_HEADERS });
}
