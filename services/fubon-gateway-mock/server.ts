/**
 * fubon-gateway-mock/server.ts — contract-mock for GAP-v1 (UTA-C3, 2026-07-04)
 *
 * This is NOT the real Fubon gateway. 楊董's 富邦 API access is not yet
 * granted (安全閘 spec O-4) — this mock is GAP-v1's executable spec so the
 * API-side adapter can be built and tested before that. All 7 endpoints from
 * FUBON_ADAPTER_INTERFACE_FREEZE_v1.md §2 return fixed fixtures.
 *
 * Node (not Python, unlike the real future services/fubon-gateway/) so it can
 * be started in-process by tests/ci.test.ts (`node --test` + tsx) without a
 * subprocess or extra runtime dependency.
 *
 * Safety (§3): both gates read env at request time (not cached), so tests can
 * toggle them per-case.
 *   - FUBON_READ_ONLY_MODE (default true)         -> 403 FUBON_READ_ONLY_MODE_BLOCKED
 *   - FUBON_LIVE_TRADING_ENABLED (default false)   -> 409 FUBON_LIVE_DISABLED_STAGE_GATE
 * Both gate /order/create and /order/cancel; read-only is checked first.
 */

import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";

const FIXTURE_POSITIONS = [
  { symbol: "2330", qty: 1000, avg_price: 580.5, last_price: 585.0, unrealized: 4500, realized: 0 },
  { symbol: "00981A", qty: 36, avg_price: 21.05, last_price: 21.3, unrealized: 9, realized: 0 },
];
const FIXTURE_BALANCE = { cash_available: 5_000_000 };
const FIXTURE_ORDERS_TODAY = [
  { symbol: "2330", action: "Buy", qty: 1000, status: "filled", external_order_id: "fubon-mock-1", filled_qty: 1000, filled_price: 580.5, submitted_at: "2026-07-04T01:30:00.000Z" },
];

const cancelledIds = new Set<string>();

function isReadOnly(): boolean {
  return process.env.FUBON_READ_ONLY_MODE !== "false";
}
function isLiveTradingEnabled(): boolean {
  return process.env.FUBON_LIVE_TRADING_ENABLED === "true";
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) });
  res.end(payload);
}

function sendGateError(res: ServerResponse): boolean {
  if (isReadOnly()) {
    sendJson(res, 403, { error: { code: "FUBON_READ_ONLY_MODE_BLOCKED", message: "Fubon gateway is in read-only mode." } });
    return true;
  }
  if (!isLiveTradingEnabled()) {
    sendJson(res, 409, { error: { code: "FUBON_LIVE_DISABLED_STAGE_GATE", message: "Fubon live trading is not enabled for this stage." } });
    return true;
  }
  return false;
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return {};
  }
}

export function createFubonMockGatewayServer(): Server {
  return createServer((req, res) => {
    void (async () => {
      const method = req.method ?? "GET";
      const url = req.url ?? "/";

      if (method === "GET" && url === "/health") {
        return sendJson(res, 200, { ok: true, broker: "fubon", is_simulation: true, read_only_mode: isReadOnly() });
      }
      if (method === "GET" && url === "/session/status") {
        return sendJson(res, 200, { logged_in: true, account_masked: "****5678", env: "sim" });
      }
      if (method === "GET" && url === "/positions") {
        return sendJson(res, 200, { positions: FIXTURE_POSITIONS });
      }
      if (method === "GET" && url === "/balances") {
        return sendJson(res, 200, FIXTURE_BALANCE);
      }
      if (method === "GET" && url === "/orders/today") {
        return sendJson(res, 200, { orders: FIXTURE_ORDERS_TODAY });
      }
      if (method === "POST" && url === "/order/create") {
        if (sendGateError(res)) return;
        return sendJson(res, 200, { external_order_id: `fubon-mock-${Date.now()}`, status: "submitted" });
      }
      if (method === "POST" && url === "/order/cancel") {
        if (sendGateError(res)) return;
        const body = await readJsonBody(req);
        const id = String(body.external_order_id ?? "");
        const alreadyCancelled = cancelledIds.has(id);
        cancelledIds.add(id);
        return sendJson(res, 200, { external_order_id: id, status: alreadyCancelled ? "already_cancelled" : "cancelled" });
      }
      return sendJson(res, 404, { error: { code: "NOT_FOUND", message: `${method} ${url} not implemented in mock` } });
    })();
  });
}

export function _resetFubonMockGatewayStateForTests(): void {
  cancelledIds.clear();
}
