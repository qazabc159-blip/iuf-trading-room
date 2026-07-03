import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

// Unified order flow PR-2 (D1/D3): the desk proxy must let through the single
// unified order submit endpoint (POST /trading/orders) and the unified order
// report read (GET /uta/orders), while still 403-blocking everything else.
// See reports/epic_trading_desk_20260702/S1_UNIFIED_ORDER_FLOW_DESIGN_v1.md §4 PR-2.

let GET: (request: NextRequest) => Promise<Response>;
let POST: (request: NextRequest) => Promise<Response>;

beforeAll(async () => {
  // route.ts reads NEXT_PUBLIC_API_BASE_URL at module load time — must be set
  // before the dynamic import below.
  process.env.NEXT_PUBLIC_API_BASE_URL = "http://localhost:9999";
  const mod = await import("./route");
  GET = mod.GET;
  POST = mod.POST;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function makeRequest(method: string, path: string) {
  const url = new URL("http://localhost/api/ui-final-v031/backend");
  url.searchParams.set("path", path);
  return new NextRequest(url, { method });
}

describe("ui-final-v031 backend proxy allowlist — unified order flow PR-2", () => {
  it("allows POST /api/v1/trading/orders through to upstream (200 shape)", async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, id: "test-order" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const res = await POST(makeRequest("POST", "/api/v1/trading/orders"));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("allows GET /api/v1/uta/orders through to upstream (200 shape)", async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const res = await GET(makeRequest("GET", "/api/v1/uta/orders"));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ data: [] });
  });

  it("blocks an off-allowlist POST path with 403 and never calls upstream", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const res = await POST(makeRequest("POST", "/api/v1/broker/trading-service"));

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("FINAL_V031_PROXY_PATH_BLOCKED");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("blocks an off-allowlist GET path with 403 and never calls upstream", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const res = await GET(makeRequest("GET", "/api/v1/admin/users"));

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("FINAL_V031_PROXY_PATH_BLOCKED");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
