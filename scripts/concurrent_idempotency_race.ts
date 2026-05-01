/**
 * concurrent_idempotency_race.ts — T05 idempotency race harness
 *
 * Fires N parallel POST /api/v1/paper/orders requests with the SAME idempotencyKey
 * (inside the request body — this API reads it from JSON, not from an HTTP header)
 * and asserts that exactly 1 order is persisted in the ledger regardless of how many
 * concurrent callers hit the endpoint simultaneously.
 *
 * Usage:
 *   tsx scripts/concurrent_idempotency_race.ts
 *   tsx scripts/concurrent_idempotency_race.ts --n=10 --symbol=2330 --qty=1 --price=800
 *   tsx scripts/concurrent_idempotency_race.ts --n=5 --host=https://api.eycvector.com
 *   tsx scripts/concurrent_idempotency_race.ts --key=my-custom-key --n=20
 *
 * Auth (pick one):
 *   IUF_TEST_SESSION=<cookie-value>   Cookie: iuf_session=<value>
 *   IUF_TEST_BEARER=<token>           Authorization: Bearer <token>
 *   (Both can be set; SESSION takes precedence)
 *
 * Required env for gate to open:
 *   EXECUTION_MODE=paper
 *   PAPER_KILL_SWITCH=false
 *   PAPER_MODE_ENABLED=true
 *
 * Response classification:
 *   created  — HTTP 201  (new order accepted by paper engine)
 *   rejected — HTTP 422  (paper gate blocked or order REJECTED by executor)
 *   deduped  — HTTP 409  (DUPLICATE_IDEMPOTENCY_KEY — in-memory pre-check caught it)
 *   error    — anything else (4xx auth errors, 5xx, network failure)
 *
 * Note: the in-memory idempotency guard (_registerIdempotencyKey) fires before the DB
 * write.  Under true concurrent load the first request to acquire the Set insertion
 * gets 201; all subsequent concurrent requests with the same key get 409.
 * A 409 is idempotency protection working correctly — NOT an error for this test.
 *
 * PASS criterion: exactly 1 order persisted in the ledger for the given key.
 * FAIL criterion: 0 or >1 orders persisted (idempotency broken).
 *
 * Stop-lines:
 *   - NO KGI imports
 *   - NO /order/create route
 *   - NO real broker calls
 *   - Paper endpoint /api/v1/paper/orders ONLY
 */

import process from "node:process";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// CLI arg parsing — minimal, no deps
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const arg of argv) {
    const m = arg.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

const N           = Math.max(2, parseInt(args["n"]    ?? "10", 10));
const HOST        = (args["host"]   ?? process.env["IUF_TEST_HOST"] ?? "http://localhost:3001").replace(/\/$/, "");
const SYMBOL      = (args["symbol"] ?? "2330").toUpperCase();
const QTY         = Math.max(1, parseInt(args["qty"]   ?? "1", 10));
const PRICE       = args["price"] !== undefined ? parseFloat(args["price"]) : 800;
const ORDER_TYPE  = args["orderType"] ?? "limit";
const SIDE        = args["side"] ?? "buy";
const IDEM_KEY    = args["key"] ?? `t05-race-${randomUUID()}`;
const WORKSPACE   = args["workspace"] ?? process.env["IUF_WORKSPACE"] ?? "primary-desk";

// ---------------------------------------------------------------------------
// Auth headers
// ---------------------------------------------------------------------------

function buildAuthHeaders(): Record<string, string> {
  const session = process.env["IUF_TEST_SESSION"];
  const bearer  = process.env["IUF_TEST_BEARER"];

  if (session) {
    return { "Cookie": `iuf_session=${session}` };
  }
  if (bearer) {
    return { "Authorization": `Bearer ${bearer}` };
  }
  // No auth set — requests will likely return 401; harness will count them as errors.
  return {};
}

// ---------------------------------------------------------------------------
// Color helpers (ANSI, disabled in CI / non-TTY)
// ---------------------------------------------------------------------------

const noColor = !process.stdout.isTTY || process.env["NO_COLOR"] !== undefined || process.env["CI"] !== undefined;
const c = {
  green:  (s: string) => noColor ? s : `\x1b[32m${s}\x1b[0m`,
  red:    (s: string) => noColor ? s : `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => noColor ? s : `\x1b[33m${s}\x1b[0m`,
  cyan:   (s: string) => noColor ? s : `\x1b[36m${s}\x1b[0m`,
  bold:   (s: string) => noColor ? s : `\x1b[1m${s}\x1b[0m`,
  dim:    (s: string) => noColor ? s : `\x1b[2m${s}\x1b[0m`,
};

// ---------------------------------------------------------------------------
// Types for API response shapes
// ---------------------------------------------------------------------------

interface OrderIntent {
  id: string;
  idempotencyKey: string;
  symbol: string;
  side: string;
  orderType: string;
  qty: number;
  quantity_unit: string;
  price: number | null;
  status: string;
  userId: string;
}

interface OrderState {
  intent: OrderIntent;
  fill: unknown | null;
}

interface PostSuccessBody {
  data: OrderState;
}

interface PostDuplicateBody {
  error: "DUPLICATE_IDEMPOTENCY_KEY";
  idempotencyKey: string;
}

interface PostGateBlockedBody {
  error: "paper_gate_blocked";
  reason: string;
  layer: string;
}

type PostResponseBody = PostSuccessBody | PostDuplicateBody | PostGateBlockedBody | Record<string, unknown>;

interface ListResponseBody {
  data: OrderState[];
}

// ---------------------------------------------------------------------------
// Response classification
// ---------------------------------------------------------------------------

type ResponseClass = "created" | "deduped" | "rejected" | "error";

interface ClassifiedResponse {
  index: number;
  status: number;
  cls: ResponseClass;
  orderId: string | null;
  errorDetail: string | null;
  durationMs: number;
}

function classify(index: number, status: number, body: PostResponseBody, durationMs: number): ClassifiedResponse {
  if (status === 201) {
    const b = body as PostSuccessBody;
    const orderId = b.data?.intent?.id ?? null;
    return { index, status, cls: "created", orderId, errorDetail: null, durationMs };
  }

  if (status === 409) {
    // DUPLICATE_IDEMPOTENCY_KEY — idempotency protection fired correctly
    return { index, status, cls: "deduped", orderId: null, errorDetail: null, durationMs };
  }

  if (status === 422) {
    // Could be gate blocked OR an order that reached REJECTED state in executor
    const b = body as Record<string, unknown>;
    const detail = typeof b["error"] === "string" ? b["error"] : `HTTP 422`;
    const reason = typeof b["reason"] === "string" ? ` reason=${b["reason"]}` : "";
    return { index, status, cls: "rejected", orderId: null, errorDetail: `${detail}${reason}`, durationMs };
  }

  // 400, 401, 403, 5xx, etc.
  const b = body as Record<string, unknown>;
  const detail = typeof b["error"] === "string" ? b["error"] : `HTTP ${status}`;
  return { index, status, cls: "error", orderId: null, errorDetail: detail, durationMs };
}

// ---------------------------------------------------------------------------
// Single POST request
// ---------------------------------------------------------------------------

async function postOrder(index: number, authHeaders: Record<string, string>): Promise<ClassifiedResponse> {
  const t0 = Date.now();
  const body = {
    idempotencyKey: IDEM_KEY,
    symbol: SYMBOL,
    side: SIDE,
    orderType: ORDER_TYPE,
    quantity_unit: "SHARE",
    qty: QTY,
    price: PRICE,
  };

  let status = 0;
  let parsed: PostResponseBody = {};

  try {
    const res = await fetch(`${HOST}/api/v1/paper/orders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-workspace-slug": WORKSPACE,
        ...authHeaders,
      },
      body: JSON.stringify(body),
    });

    status = res.status;
    const text = await res.text();
    try {
      parsed = JSON.parse(text) as PostResponseBody;
    } catch {
      parsed = { _raw: text };
    }
  } catch (err) {
    // Network-level failure
    return {
      index,
      status: 0,
      cls: "error",
      orderId: null,
      errorDetail: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - t0,
    };
  }

  return classify(index, status, parsed, Date.now() - t0);
}

// ---------------------------------------------------------------------------
// GET /api/v1/paper/orders — count persisted orders for this idempotencyKey
// ---------------------------------------------------------------------------

async function countPersistedOrders(authHeaders: Record<string, string>): Promise<{
  count: number;
  orders: OrderState[];
  fetchError: string | null;
}> {
  try {
    const res = await fetch(`${HOST}/api/v1/paper/orders`, {
      headers: {
        "x-workspace-slug": WORKSPACE,
        ...authHeaders,
      },
    });

    if (!res.ok) {
      return { count: 0, orders: [], fetchError: `GET /api/v1/paper/orders returned HTTP ${res.status}` };
    }

    const body = await res.json() as ListResponseBody;
    const all = Array.isArray(body.data) ? body.data : [];
    const matching = all.filter((o) => o.intent?.idempotencyKey === IDEM_KEY);
    return { count: matching.length, orders: matching, fetchError: null };
  } catch (err) {
    return {
      count: 0,
      orders: [],
      fetchError: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const authHeaders = buildAuthHeaders();

  console.log(c.bold(`\n=== T05 concurrent_idempotency_race ===`));
  console.log(`N=${N} host=${HOST} key=${IDEM_KEY}`);
  console.log(c.dim(`symbol=${SYMBOL} side=${SIDE} orderType=${ORDER_TYPE} qty=${QTY} price=${PRICE} unit=SHARE`));

  if (!process.env["IUF_TEST_SESSION"] && !process.env["IUF_TEST_BEARER"]) {
    console.log(c.yellow("  WARN: no IUF_TEST_SESSION or IUF_TEST_BEARER set — requests will likely return 401"));
  }

  // Fire all N requests in parallel
  const t0 = Date.now();
  const tasks = Array.from({ length: N }, (_, i) => postOrder(i, authHeaders));
  const results = await Promise.allSettled(tasks);
  const wallMs = Date.now() - t0;

  // Unwrap settled results (all are fulfilled — postOrder never throws)
  const classified: ClassifiedResponse[] = results.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    // Should never happen since postOrder catches all errors, but handle defensively
    return {
      index: i,
      status: 0,
      cls: "error" as ResponseClass,
      orderId: null,
      errorDetail: r.reason instanceof Error ? r.reason.message : String(r.reason),
      durationMs: 0,
    };
  });

  // Tally
  const created  = classified.filter((r) => r.cls === "created");
  const deduped  = classified.filter((r) => r.cls === "deduped");
  const rejected = classified.filter((r) => r.cls === "rejected");
  const errors   = classified.filter((r) => r.cls === "error");

  console.log(`\nResponses: created=${created.length} deduped=${deduped.length} rejected=${rejected.length} error=${errors.length} (${wallMs}ms wall)`);

  // Show any errors or unexpected rejections inline
  if (errors.length > 0) {
    console.log(c.red(`\n  Errors (${errors.length}):`));
    for (const e of errors) {
      console.log(c.red(`    [${e.index}] HTTP ${e.status} — ${e.errorDetail ?? "unknown"}`));
    }
  }
  if (rejected.length > 0) {
    console.log(c.yellow(`\n  Rejected (${rejected.length}) — likely gate blocked:`));
    for (const r of rejected) {
      console.log(c.yellow(`    [${r.index}] ${r.errorDetail ?? "HTTP 422"}`));
    }
  }

  // Count persisted orders via GET
  console.log(c.dim(`\n  Querying ${HOST}/api/v1/paper/orders for idempotencyKey=${IDEM_KEY}...`));
  const { count, orders, fetchError } = await countPersistedOrders(authHeaders);

  if (fetchError) {
    console.log(c.red(`  GET /api/v1/paper/orders failed: ${fetchError}`));
    console.log(`Persisted orders: UNKNOWN`);
    console.log(c.red(`RESULT: FAIL — could not verify persisted order count`));
    process.exit(1);
  }

  console.log(`Persisted orders: ${count}`);

  // Show persisted order ids for audit trail
  if (orders.length > 0) {
    for (const o of orders) {
      const id = o.intent?.id ?? "unknown-id";
      const status = o.intent?.status ?? "unknown";
      console.log(c.dim(`  order id=${id} status=${status}`));
    }
  }

  // PASS/FAIL judgment
  const EXPECTED_PERSISTED = 1;
  const allOkOrDeduped = errors.length === 0 && rejected.length === 0;

  if (count === EXPECTED_PERSISTED) {
    // Core assertion: exactly 1 order in DB
    if (!allOkOrDeduped) {
      // Warn but do not fail: gate blocks and auth errors are environment setup issues
      // that prevent the race from running properly — escalate to operator
      console.log(c.yellow(`\n  WARN: ${errors.length} error(s) and/or ${rejected.length} rejected response(s).`));
      console.log(c.yellow(`  If errors are 401 set IUF_TEST_SESSION or IUF_TEST_BEARER.`));
      console.log(c.yellow(`  If rejections are paper_gate_blocked set EXECUTION_MODE=paper PAPER_KILL_SWITCH=false PAPER_MODE_ENABLED=true.`));
      // Only 1 persisted but some requests did not even reach idempotency check — partial run
      if (created.length === 0) {
        console.log(c.red(`RESULT: FAIL — 1 persisted but 0 created responses; idempotency key collision in ledger is unexpected`));
        process.exit(1);
      }
    }
    console.log(c.green(`RESULT: PASS`));
    process.exit(0);
  } else {
    const detail = count === 0
      ? `no orders created — gate may be blocked or auth failed`
      : `idempotency BROKEN — ${count} duplicate orders persisted`;
    console.log(c.red(`RESULT: FAIL — expected 1 persisted, got ${count} (${detail})`));
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error(c.red("\n[FATAL]"), err instanceof Error ? err.message : String(err));
  process.exit(1);
});
