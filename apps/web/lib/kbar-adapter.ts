/**
 * kbar-adapter.ts — Forward-looking Phase 2 adapter for KGI gateway K-bar data.
 * Ported from sandbox: evidence/design_handoff_2026-04-26/v0.7.0_work/nextjs/src/lib/kbar-adapter.ts
 *
 * Phase 2 design (Path B gateway-native): two endpoints (NOT YET IN PRODUCTION):
 *   REST: GET /api/v1/kgi/quote/kbar?symbol=<s>&interval=<i>&limit=<n>
 *         response: { data: KBar[] }  — wraps kgisuperpy recover_kbar()
 *   WS:   /api/v1/kgi/quote/subscribe/kbar?symbol=<s>
 *         push frames: { type: "kbar", data: KBar }  — wraps subscribe_kbar()
 *
 * Hard lines:
 *   - NO import from apps/api/* or packages/contracts/*
 *   - NO order entry, NO /order/create, NO broker paths
 *   - NO hardcoded production URL — always env-derived
 *   - 0 Hz polling — this is a fetch-once adapter (polling in useReadOnlyQuote)
 */

interface KBar {
  time: number;     // Unix timestamp seconds (UTC)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";
const MOCK_FALLBACK = process.env.NEXT_PUBLIC_KBAR_MOCK_FALLBACK !== "false";

/**
 * fetchKBars — historical K-bars from KGI gateway REST endpoint.
 *
 * Returns [] on failure when MOCK_FALLBACK=true (default).
 * Caller (getKBarsAsync in mock-kbar.ts) detects [] and falls back to mock.
 */
export async function fetchKBars(
  symbol: string,
  interval: string = "1d",
  limit: number = 30,
): Promise<KBar[]> {
  const url =
    `${API_BASE}/api/v1/kgi/quote/kbar` +
    `?symbol=${encodeURIComponent(symbol)}` +
    `&interval=${encodeURIComponent(interval)}` +
    `&limit=${limit}`;

  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      if (MOCK_FALLBACK) {
        console.warn(`[kbar-adapter] fetchKBars ${res.status} ${url} — returning [] for mock fallback`);
        return [];
      }
      throw new Error(`fetchKBars: ${res.status} ${res.statusText}`);
    }
    const json = (await res.json()) as { data: KBar[] };
    return json.data ?? [];
  } catch (e) {
    if (MOCK_FALLBACK) {
      console.warn("[kbar-adapter] fetchKBars error — returning [] for mock fallback:", e);
      return [];
    }
    throw e;
  }
}

/**
 * wireUpKBarStream — WebSocket K-bar streaming skeleton.
 * SKELETON ONLY: endpoint not yet deployed.
 */
export function wireUpKBarStream(
  symbol: string,
  onBar: (bar: KBar) => void,
): () => void {
  console.info(
    `[kbar-adapter] wireUpKBarStream SKELETON — WS endpoint not deployed. symbol=${symbol}`,
  );
  void onBar;  // suppress unused-var lint in skeleton
  return () => {};
}
