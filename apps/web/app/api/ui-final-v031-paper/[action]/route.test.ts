import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";

// Test lock for 統一下單流 D4 (S1_UNIFIED_ORDER_FLOW_DESIGN_v1.md §4): quantity_unit
// (SHARE|LOT) is REQUIRED with no default. PR-5 (#1201) removed the last silent-default
// site here (`body.quantity_unit === "SHARE" ? "SHARE" : "LOT"`), replacing it with a hard
// 400 QUANTITY_UNIT_REQUIRED rejection — this repo has a standing board rule
// (quantity_unit Required No Default) because a silent LOT default is a 1000x
// share-count risk. Before this file, `grep -r QUANTITY_UNIT_REQUIRED` across the whole
// repo returned zero test matches, so a future regression re-adding the default would not
// go red. This file exists to close that gap.

let POST: (
  request: Request,
  context: { params: Promise<{ action: string }> },
) => Promise<Response>;

beforeAll(async () => {
  // route.ts / paper-orders-api.ts read NEXT_PUBLIC_API_BASE_URL at module load time —
  // must be set before the dynamic import below (same pattern as
  // ui-final-v031/backend/route.test.ts).
  process.env.NEXT_PUBLIC_API_BASE_URL = "http://localhost:9999";
  const mod = await import("./route");
  POST = mod.POST;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/ui-final-v031-paper/preview", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function ctx(action: string) {
  return { params: Promise.resolve({ action }) };
}

const validBase = { symbol: "2330", side: "buy", orderType: "market", qty: 1000 };

describe("ui-final-v031-paper [action] route — quantity_unit REQUIRED lock (D4)", () => {
  it("preview: missing quantity_unit -> 400 QUANTITY_UNIT_REQUIRED, never calls upstream (does not silently default to LOT)", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const res = await POST(makeRequest({ ...validBase }), ctx("preview"));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ ok: false, error: "QUANTITY_UNIT_REQUIRED" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("preview: illegal quantity_unit value -> 400 QUANTITY_UNIT_REQUIRED, never calls upstream", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const res = await POST(makeRequest({ ...validBase, quantity_unit: "SHARES" }), ctx("preview"));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ ok: false, error: "QUANTITY_UNIT_REQUIRED" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("submit: missing quantity_unit -> 400 QUANTITY_UNIT_REQUIRED, never calls upstream", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const res = await POST(makeRequest({ ...validBase }), ctx("submit"));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ ok: false, error: "QUANTITY_UNIT_REQUIRED" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("submit: illegal quantity_unit value -> 400 QUANTITY_UNIT_REQUIRED, never calls upstream", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const res = await POST(makeRequest({ ...validBase, quantity_unit: "lot" }), ctx("submit"));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ ok: false, error: "QUANTITY_UNIT_REQUIRED" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("preview: legal quantity_unit=SHARE passes through to upstream unchanged (200)", async () => {
    const fetchSpy = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify({ data: { ok: true } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const res = await POST(makeRequest({ ...validBase, quantity_unit: "SHARE" }), ctx("preview"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0];
    const sentBody = JSON.parse(init!.body as string);
    expect(sentBody.quantity_unit).toBe("SHARE");
  });

  it("preview: legal quantity_unit=LOT passes through to upstream unchanged (200)", async () => {
    const fetchSpy = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify({ data: { ok: true } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const res = await POST(makeRequest({ ...validBase, quantity_unit: "LOT" }), ctx("preview"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0];
    const sentBody = JSON.parse(init!.body as string);
    expect(sentBody.quantity_unit).toBe("LOT");
  });
});
