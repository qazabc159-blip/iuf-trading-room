/**
 * kgi-subscription-manager.ts — KGI Quote Subscription Quota Manager
 *
 * 凱基新星等級訂閱限制：
 *   - 2 條連線，每條最多 20 檔 = 40 檔同時 subscribe 上限
 *   - 一條連線可拿「五檔 + Tick」兩種 stream（不分開吃配額）
 *
 * 優先序 (priority tiers):
 *   TIER_0_INDEX     — 大盤指數 (永久固定, 不 swap)
 *   TIER_1_STRATEGY  — 策略 holdings (永久固定, 不 swap)
 *   TIER_2_HOLDINGS  — 楊董持倉 (LRU swap 候選 lowest priority within holdings)
 *   TIER_3_WATCHLIST — 楊董 watchlist (LRU swap 候選)
 *   TIER_4_CORE      — 權值股核心 前 15 (永久固定, 不 swap)
 *   TIER_5_BUFFER    — Buffer pool — swap 用
 *
 * Hard lines:
 *   - MAX_SLOTS = 40 (hard cap, no override)
 *   - CONN_SLOT_MAX = 20 (per connection)
 *   - 永久固定 tier (INDEX + STRATEGY + CORE) 不可被 swap 出去
 *   - 不 import broker.* (kgi-gateway-client / kgi-broker / paper-broker)
 *   - 不改 contracts
 *   - 不做 DB migration
 *   - subscribe/unsubscribe 直接呼叫 KGI_GATEWAY_URL (POST /quote/subscribe/tick)
 *   - 非市場時段 gateway 可能離線 → 所有 network call fail-open (log warn, 不 throw)
 */

// ── Constants ──────────────────────────────────────────────────────────────────

export const MAX_SLOTS = 40;
export const CONN_SLOT_MAX = 20;
export const CONN_COUNT = 2;

// ── Priority tiers ─────────────────────────────────────────────────────────────

export const TIER = {
  INDEX: 0,      // 大盤指數 — permanent
  STRATEGY: 1,   // 策略 holdings — permanent
  HOLDINGS: 2,   // 楊董持倉 — LRU swappable
  WATCHLIST: 3,  // 楊董 watchlist — LRU swappable
  CORE: 4,       // 權值股核心 — permanent
  BUFFER: 5,     // buffer pool — swappable
} as const;

export type SubscriptionTier = (typeof TIER)[keyof typeof TIER];

/** Symbols that are PERMANENT (never swapped out) */
const PERMANENT_TIERS = new Set<SubscriptionTier>([TIER.INDEX, TIER.STRATEGY, TIER.CORE]);

// ── Fixed slot definitions ─────────────────────────────────────────────────────

/** 大盤指數 — always subscribed */
export const INDEX_SYMBOLS = ["^TWII", "^TPEX"] as const;

/** 策略 holdings — always subscribed */
export const STRATEGY_SYMBOLS = ["3707", "2426", "6205", "2486"] as const;

/** 權值股核心前 15 — always subscribed */
export const CORE_SYMBOLS = [
  "2330", "2317", "2454", "2882", "2881",
  "2308", "2412", "2891", "2886", "6505",
  "3711", "2207", "3008", "2002", "1303",
] as const;

/**
 * Display universe for the dashboard core heatmap.
 *
 * CORE_SYMBOLS is intentionally only the permanently subscribed KGI quota set
 * (15 symbols). The dashboard needs a broader, stable 40-symbol universe and
 * can enrich non-subscribed symbols from TWSE EOD/cache. Keeping this separate
 * prevents the UI from shrinking to 0-4 names per sector whenever KGI slots are
 * sparse or off-hours.
 */
export const HEATMAP_CORE_SYMBOLS = [
  "2330", "2317", "2454", "2882", "2881",
  "2308", "2412", "2891", "2886", "6505",
  "3711", "2207", "3008", "2002", "1303",
  "3707", "2426", "6205", "2486", "1301",
  "1326", "1216", "5871", "5876", "3045",
  "2395", "2382", "3034", "2379", "6669",
  "2603", "2609", "2615", "2618", "2884",
  "2885", "2892", "1101", "1102", "2912",
] as const;

/** Total permanent slots (index 2 + strategy 4 + core 15 = 21) */
export const PERMANENT_SLOT_COUNT =
  INDEX_SYMBOLS.length + STRATEGY_SYMBOLS.length + CORE_SYMBOLS.length;

/** Dynamic budget (MAX_SLOTS - PERMANENT) = 19 slots for holdings + watchlist + buffer */
export const DYNAMIC_SLOT_COUNT = MAX_SLOTS - PERMANENT_SLOT_COUNT;

// ── Slot entry ─────────────────────────────────────────────────────────────────

export interface SlotEntry {
  symbol: string;
  tier: SubscriptionTier;
  /** Which logical connection (0 = conn_a, 1 = conn_b) */
  connection: 0 | 1;
  /** When this subscription was last requested/refreshed (used for LRU eviction) */
  lastUsedAt: string; // ISO 8601
  /** Last tick data received from gateway */
  lastTickAt: string | null;
  /**
   * Whether the gateway has actually confirmed this subscription — either a
   * `POST /quote/subscribe/tick` call returned ok, or a reconcile pass saw
   * the symbol in the gateway's own `subscribed_symbols.tick` list.
   * NOT the same as "present in `_slots`" — a symbol can be bookkept here
   * (e.g. permanent-tier seeded by `initSubscriptionManager()`) without the
   * gateway ever having been told about it. See `ensurePermanentSubscriptions()`.
   */
  subscribed: boolean;
}

// ── State ──────────────────────────────────────────────────────────────────────

let _slots: SlotEntry[] = [];
let _initialized = false;

/** For test cleanup / reset */
export function _resetSubscriptionManager(): void {
  _slots = [];
  _initialized = false;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function nowIso(): string {
  return new Date().toISOString();
}

function assignConnection(slotIndex: number): 0 | 1 {
  // Assign to connection_a (0) if count < CONN_SLOT_MAX, else connection_b (1)
  const connACnt = _slots.filter((s) => s.connection === 0).length;
  if (connACnt < CONN_SLOT_MAX) return 0;
  return 1;
}

function getGatewayUrl(): string {
  return (
    process.env.KGI_GATEWAY_URL ??
    process.env.KGI_GATEWAY_BASE_URL ??
    "http://127.0.0.1:8787"
  );
}

async function gatewaySubscribe(symbol: string): Promise<boolean> {
  const url = `${getGatewayUrl()}/quote/subscribe/tick`;
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol, odd_lot: false }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!resp.ok) {
      console.warn(
        `[kgi-subscription-manager] subscribe ${symbol} → HTTP ${resp.status}`
      );
      return false;
    }
    return true;
  } catch (err) {
    console.warn(
      `[kgi-subscription-manager] subscribe ${symbol} network error:`,
      err instanceof Error ? err.message : String(err)
    );
    return false;
  }
}

async function gatewayUnsubscribe(symbol: string): Promise<boolean> {
  const url = `${getGatewayUrl()}/quote/unsubscribe`;
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!resp.ok) {
      // Unsubscribe failure is non-fatal (gateway may have already dropped it)
      console.warn(
        `[kgi-subscription-manager] unsubscribe ${symbol} → HTTP ${resp.status} (non-fatal)`
      );
    }
    return resp.ok;
  } catch (err) {
    console.warn(
      `[kgi-subscription-manager] unsubscribe ${symbol} network error (non-fatal):`,
      err instanceof Error ? err.message : String(err)
    );
    return false;
  }
}

/**
 * Query the gateway's own view of which tick symbols are actually live
 * (`GET /quote/status` → `subscribed_symbols.tick`). This is ground truth —
 * our local `_slots[].subscribed` flag is Railway-side bookkeeping that can
 * drift from reality (e.g. after any gateway process restart, which wipes the
 * KGI SDK's in-memory subscription state — see reports/quote_chain_outage_
 * 20260710/TLS_FIX_2026_07_16.md). Fail-open: gateway unreachable → null, do
 * NOT throw, do NOT infer either "subscribed" or "not subscribed" from a
 * failed probe.
 */
async function gatewayLiveTickSymbols(): Promise<Set<string> | null> {
  const url = `${getGatewayUrl()}/quote/status`;
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    if (!resp.ok) return null;
    const body = (await resp.json()) as {
      subscribed_symbols?: { tick?: string[] };
    };
    const tick = body.subscribed_symbols?.tick;
    return new Set(Array.isArray(tick) ? tick : []);
  } catch (err) {
    console.warn(
      `[kgi-subscription-manager] gateway status probe network error:`,
      err instanceof Error ? err.message : String(err)
    );
    return null;
  }
}

function symbolInSlots(symbol: string): boolean {
  return _slots.some((s) => s.symbol === symbol);
}

/** Find the LRU swappable slot (lowest tier priority among swappable = HOLDINGS → WATCHLIST → BUFFER, oldest lastUsedAt) */
function findLruSwappableSlot(): SlotEntry | null {
  const candidates = _slots.filter((s) => !PERMANENT_TIERS.has(s.tier));
  if (candidates.length === 0) return null;
  // Sort by tier descending (BUFFER=5 > WATCHLIST=3 > HOLDINGS=2), then by lastUsedAt ascending
  candidates.sort((a, b) => {
    if (b.tier !== a.tier) return b.tier - a.tier;
    return a.lastUsedAt < b.lastUsedAt ? -1 : 1;
  });
  return candidates[0] ?? null;
}

// ── Initialise permanent slots ─────────────────────────────────────────────────

/**
 * Initialise the manager with permanent slots (bookkeeping only).
 * Idempotent — calling twice is safe.
 * Does NOT call gateway (gateway may be offline at startup, and this function
 * is synchronous — it's called from many hot request paths without await).
 * Actually telling the gateway about these symbols is
 * `ensurePermanentSubscriptions()`'s job — call that from a boot task /
 * recurring scheduler, not here. See 2026-07-16 durable-fix note: previously
 * NOTHING ever called the gateway for permanent-tier symbols, so `subscribed`
 * stayed `false` forever and e.g. `/kgi/quote/ticks?symbol=2330` 404'd
 * indefinitely even when the gateway itself was healthy.
 */
export function initSubscriptionManager(): void {
  if (_initialized) return;

  const permanentEntries: Array<{ symbol: string; tier: SubscriptionTier }> = [
    ...INDEX_SYMBOLS.map((s) => ({ symbol: s, tier: TIER.INDEX as SubscriptionTier })),
    ...STRATEGY_SYMBOLS.map((s) => ({ symbol: s, tier: TIER.STRATEGY as SubscriptionTier })),
    ...CORE_SYMBOLS.map((s) => ({ symbol: s, tier: TIER.CORE as SubscriptionTier })),
  ];

  for (const entry of permanentEntries) {
    if (symbolInSlots(entry.symbol)) continue;
    const conn = assignConnection(_slots.length);
    _slots.push({
      symbol: entry.symbol,
      tier: entry.tier,
      connection: conn,
      lastUsedAt: nowIso(),
      lastTickAt: null,
      subscribed: false, // will be confirmed when gateway is reachable
    });
  }

  _initialized = true;
}

export interface EnsurePermanentSubscriptionsResult {
  gatewayReachable: boolean;
  /** Already live per the gateway's own status — no network call needed this pass. */
  alreadyLive: string[];
  /** Were not live; a real `gatewaySubscribe()` call was made and succeeded. */
  subscribed: string[];
  /** Were not live; a real `gatewaySubscribe()` call was made and failed. */
  failed: string[];
}

/**
 * Actually tell the gateway about every permanent-tier (INDEX/STRATEGY/CORE)
 * symbol, using the gateway's own `/quote/status` as ground truth rather than
 * our local `subscribed` flag (which can't detect a gateway process restart
 * on its own — see `gatewayLiveTickSymbols()`).
 *
 * Designed to be called both once shortly after boot AND on a recurring
 * interval (see `startSchedulers()` in server.ts) so it self-heals two
 * distinct real-world timing problems:
 *   1. Railway API boots before the EC2 gateway's scheduled 08:20 TST
 *      EventBridge start — the first pass(es) will see `gatewayReachable:
 *      false` and no-op; a later interval tick picks it up once the gateway
 *      is actually up.
 *   2. The gateway process restarts mid-day (deploy, crash, manual fix like
 *      the 2026-07-16 TLS cert repair) — the KGI SDK's in-memory
 *      subscription state is wiped, but our local `_slots[].subscribed`
 *      flags don't know that. Comparing against `subscribed_symbols.tick`
 *      each pass catches this and re-subscribes.
 *
 * Fail-open throughout: gateway unreachable → returns immediately with
 * `gatewayReachable:false`, no state mutation, no throw. Idempotent: once a
 * symbol shows up in the gateway's own live set, subsequent passes make zero
 * additional subscribe calls for it.
 *
 * TODO(follow-up, not required for this fix): detection cadence is bounded by
 * the caller's interval (5 min in server.ts as of this writing) — a gateway
 * restart is invisible to desk-exact for up to that long. If that's ever too
 * slow, a push-based signal (gateway calls back into the API on its own
 * startup) would close the gap faster than polling.
 */
export async function ensurePermanentSubscriptions(): Promise<EnsurePermanentSubscriptionsResult> {
  if (!_initialized) initSubscriptionManager();

  const result: EnsurePermanentSubscriptionsResult = {
    gatewayReachable: false,
    alreadyLive: [],
    subscribed: [],
    failed: [],
  };

  const liveSet = await gatewayLiveTickSymbols();
  if (liveSet === null) return result; // fail-open, try again next pass
  result.gatewayReachable = true;

  const permanentSlots = _slots.filter((s) => PERMANENT_TIERS.has(s.tier));

  for (const slot of permanentSlots) {
    if (liveSet.has(slot.symbol)) {
      slot.subscribed = true;
      result.alreadyLive.push(slot.symbol);
      continue;
    }
    const ok = await gatewaySubscribe(slot.symbol);
    slot.subscribed = ok;
    if (ok) {
      slot.lastUsedAt = nowIso();
      result.subscribed.push(slot.symbol);
    } else {
      result.failed.push(slot.symbol);
    }
  }

  return result;
}

// ── Core subscribe API ─────────────────────────────────────────────────────────

export interface SubscribeResult {
  ok: boolean;
  symbol: string;
  action: "already_subscribed" | "subscribed" | "quota_exceeded" | "gateway_error";
  tier?: SubscriptionTier;
  connection?: 0 | 1;
  swappedOut?: string;
  slotsUsed: number;
  slotsMax: number;
  suggestion?: string;
}

/**
 * Subscribe a symbol to the quota pool.
 *
 * @param symbol  - Symbol to subscribe
 * @param tier    - Priority tier (HOLDINGS, WATCHLIST, BUFFER)
 * @param forceSwap - If quota full, automatically swap LRU swappable slot
 */
export async function subscribeSymbol(
  symbol: string,
  tier: SubscriptionTier,
  forceSwap = false
): Promise<SubscribeResult> {
  if (!_initialized) initSubscriptionManager();

  // In the pool already — update lastUsedAt.
  if (symbolInSlots(symbol)) {
    const existing = _slots.find((s) => s.symbol === symbol)!;
    existing.lastUsedAt = nowIso();

    // Being IN the pool is bookkeeping, not proof the gateway was ever told.
    // Permanent-tier slots are seeded by initSubscriptionManager() with
    // subscribed:false and nothing else used to ever confirm them (see
    // 2026-07-16 durable-fix note) — if we still haven't confirmed, do the
    // real gateway call now instead of silently returning a false "ok".
    if (!existing.subscribed) {
      const confirmed = await gatewaySubscribe(symbol);
      existing.subscribed = confirmed;
      return {
        ok: confirmed,
        symbol,
        action: confirmed ? "subscribed" : "gateway_error",
        tier: existing.tier,
        connection: existing.connection,
        slotsUsed: _slots.length,
        slotsMax: MAX_SLOTS,
      };
    }

    return {
      ok: true,
      symbol,
      action: "already_subscribed",
      tier: existing.tier,
      connection: existing.connection,
      slotsUsed: _slots.length,
      slotsMax: MAX_SLOTS,
    };
  }

  // Check quota
  if (_slots.length >= MAX_SLOTS) {
    if (!forceSwap) {
      const lru = findLruSwappableSlot();
      return {
        ok: false,
        symbol,
        action: "quota_exceeded",
        slotsUsed: _slots.length,
        slotsMax: MAX_SLOTS,
        suggestion: lru
          ? `Quota full (${_slots.length}/${MAX_SLOTS}). Consider swapping out: ${lru.symbol} (${tierName(lru.tier)}, last used ${lru.lastUsedAt})`
          : `Quota full (${_slots.length}/${MAX_SLOTS}). No swappable slots available (all permanent).`,
      };
    }

    // forceSwap: evict LRU
    const lru = findLruSwappableSlot();
    if (!lru) {
      return {
        ok: false,
        symbol,
        action: "quota_exceeded",
        slotsUsed: _slots.length,
        slotsMax: MAX_SLOTS,
        suggestion: "Quota full and all slots are permanent — cannot swap.",
      };
    }

    // Unsubscribe LRU from gateway (non-fatal)
    await gatewayUnsubscribe(lru.symbol);
    const swappedSymbol = lru.symbol;
    _slots = _slots.filter((s) => s.symbol !== lru.symbol);

    // Add new symbol
    const conn = assignConnection(_slots.length);
    const subscribed = await gatewaySubscribe(symbol);
    _slots.push({
      symbol,
      tier,
      connection: conn,
      lastUsedAt: nowIso(),
      lastTickAt: null,
      subscribed,
    });

    return {
      ok: true,
      symbol,
      action: "subscribed",
      tier,
      connection: conn,
      swappedOut: swappedSymbol,
      slotsUsed: _slots.length,
      slotsMax: MAX_SLOTS,
    };
  }

  // Normal subscribe
  const conn = assignConnection(_slots.length);
  const subscribed = await gatewaySubscribe(symbol);
  _slots.push({
    symbol,
    tier,
    connection: conn,
    lastUsedAt: nowIso(),
    lastTickAt: null,
    subscribed,
  });

  return {
    ok: true,
    symbol,
    action: subscribed ? "subscribed" : "gateway_error",
    tier,
    connection: conn,
    slotsUsed: _slots.length,
    slotsMax: MAX_SLOTS,
  };
}

// ── Unsubscribe ────────────────────────────────────────────────────────────────

export interface UnsubscribeResult {
  ok: boolean;
  symbol: string;
  wasPresent: boolean;
  isPermanent: boolean;
  slotsUsed: number;
  slotsMax: number;
  message?: string;
}

/**
 * Unsubscribe a symbol from the pool.
 * Permanent slots (INDEX, STRATEGY, CORE) cannot be unsubscribed.
 */
export async function unsubscribeSymbol(symbol: string): Promise<UnsubscribeResult> {
  if (!_initialized) initSubscriptionManager();

  const slot = _slots.find((s) => s.symbol === symbol);
  if (!slot) {
    return {
      ok: false,
      symbol,
      wasPresent: false,
      isPermanent: false,
      slotsUsed: _slots.length,
      slotsMax: MAX_SLOTS,
      message: "Symbol not in subscription pool.",
    };
  }

  if (PERMANENT_TIERS.has(slot.tier)) {
    return {
      ok: false,
      symbol,
      wasPresent: true,
      isPermanent: true,
      slotsUsed: _slots.length,
      slotsMax: MAX_SLOTS,
      message: `Cannot unsubscribe permanent slot (tier=${tierName(slot.tier)}).`,
    };
  }

  await gatewayUnsubscribe(symbol);
  _slots = _slots.filter((s) => s.symbol !== symbol);

  return {
    ok: true,
    symbol,
    wasPresent: true,
    isPermanent: false,
    slotsUsed: _slots.length,
    slotsMax: MAX_SLOTS,
  };
}

// ── Subscription status ────────────────────────────────────────────────────────

export interface ConnectionDistribution {
  connection_a: string[];
  connection_b: string[];
}

export interface SubscriptionStatusResult {
  slotsUsed: number;
  slotsMax: number;
  bufferRemaining: number;
  permanentSlots: number;
  dynamicSlots: number;
  slots: SlotEntry[];
  connections: ConnectionDistribution;
  tierSummary: Record<string, number>;
}

export function getSubscriptionStatus(): SubscriptionStatusResult {
  if (!_initialized) initSubscriptionManager();

  const connA = _slots.filter((s) => s.connection === 0).map((s) => s.symbol);
  const connB = _slots.filter((s) => s.connection === 1).map((s) => s.symbol);

  const tierSummary: Record<string, number> = {};
  for (const slot of _slots) {
    const name = tierName(slot.tier);
    tierSummary[name] = (tierSummary[name] ?? 0) + 1;
  }

  return {
    slotsUsed: _slots.length,
    slotsMax: MAX_SLOTS,
    bufferRemaining: MAX_SLOTS - _slots.length,
    permanentSlots: _slots.filter((s) => PERMANENT_TIERS.has(s.tier)).length,
    dynamicSlots: _slots.filter((s) => !PERMANENT_TIERS.has(s.tier)).length,
    slots: [..._slots],
    connections: {
      connection_a: connA,
      connection_b: connB,
    },
    tierSummary,
  };
}

// ── Tick update (called by KGI quote feed) ─────────────────────────────────────

/**
 * Update lastTickAt for a symbol when a tick arrives.
 * No-op if symbol not in pool.
 */
export function recordTickReceived(symbol: string): void {
  const slot = _slots.find((s) => s.symbol === symbol);
  if (slot) {
    slot.lastTickAt = nowIso();
    slot.subscribed = true;
  }
}

// ── Holdings sync ──────────────────────────────────────────────────────────────

export interface SyncResult {
  added: string[];
  removed: string[];
  skipped: string[];
  errors: string[];
}

/**
 * Sync user holdings to the subscription pool.
 * - New holdings → subscribe (LRU swap if quota full)
 * - Holdings no longer held → unsubscribe (if not permanent)
 * - Max 5 holdings slots (楊董持倉個股 budget)
 */
export const HOLDINGS_BUDGET = 5;
export const WATCHLIST_BUDGET = 10;

export async function syncHoldings(symbols: string[]): Promise<SyncResult> {
  if (!_initialized) initSubscriptionManager();

  const added: string[] = [];
  const removed: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];

  // Remove symbols that are no longer held (HOLDINGS tier only, non-permanent)
  const currentHoldings = _slots.filter((s) => s.tier === TIER.HOLDINGS).map((s) => s.symbol);
  const toRemove = currentHoldings.filter((s) => !symbols.includes(s));

  for (const sym of toRemove) {
    const result = await unsubscribeSymbol(sym);
    if (result.ok) removed.push(sym);
  }

  // Enforce budget: take only first HOLDINGS_BUDGET symbols
  const toAdd = symbols.slice(0, HOLDINGS_BUDGET).filter((s) => !symbolInSlots(s));

  for (const sym of toAdd) {
    const result = await subscribeSymbol(sym, TIER.HOLDINGS, true);
    if (result.ok) added.push(sym);
    else errors.push(`${sym}: ${result.suggestion ?? result.action}`);
  }

  // Symbols beyond budget are skipped
  for (const sym of symbols.slice(HOLDINGS_BUDGET)) {
    if (!symbolInSlots(sym)) skipped.push(sym);
  }

  return { added, removed, skipped, errors };
}

/**
 * Sync user watchlist to the subscription pool.
 * - New entries → subscribe (LRU swap if quota full)
 * - Removed entries → unsubscribe (WATCHLIST tier only)
 * - Max 10 watchlist slots
 */
export async function syncWatchlist(symbols: string[]): Promise<SyncResult> {
  if (!_initialized) initSubscriptionManager();

  const added: string[] = [];
  const removed: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];

  // Remove symbols no longer in watchlist (WATCHLIST tier only)
  const currentWatchlist = _slots.filter((s) => s.tier === TIER.WATCHLIST).map((s) => s.symbol);
  const toRemove = currentWatchlist.filter((s) => !symbols.includes(s));

  for (const sym of toRemove) {
    const result = await unsubscribeSymbol(sym);
    if (result.ok) removed.push(sym);
  }

  // Enforce budget: take only first WATCHLIST_BUDGET symbols
  const toAdd = symbols.slice(0, WATCHLIST_BUDGET).filter((s) => !symbolInSlots(s));

  for (const sym of toAdd) {
    const result = await subscribeSymbol(sym, TIER.WATCHLIST, true);
    if (result.ok) added.push(sym);
    else errors.push(`${sym}: ${result.suggestion ?? result.action}`);
  }

  // Symbols beyond budget
  for (const sym of symbols.slice(WATCHLIST_BUDGET)) {
    if (!symbolInSlots(sym)) skipped.push(sym);
  }

  return { added, removed, skipped, errors };
}

// ── KGI Market Overview (realtime from KGI tick) ──────────────────────────────

export interface KgiTickSnapshot {
  symbol: string;
  value: number | null;
  change: number | null;
  changePct: number | null;
  ts: string | null;
  source: "kgi_tick";
  staleSec: number | null;
}

/**
 * Build a market overview snapshot from KGI live tick data.
 * Pulls latest tick from gateway for TAIEX (^TWII) and OTC (^TPEX).
 * Returns null fields if gateway unreachable or no tick data.
 */
export async function getKgiMarketOverview(): Promise<{
  taiex: KgiTickSnapshot;
  otc: KgiTickSnapshot;
  source: "kgi_tick";
  staleAfterSec: number;
}> {
  const [taiex, otc] = await Promise.all([
    fetchKgiLatestTick("^TWII"),
    fetchKgiLatestTick("^TPEX"),
  ]);

  return {
    taiex,
    otc,
    source: "kgi_tick",
    staleAfterSec: 5,
  };
}

/**
 * Exported (2026-07-10 quote-chain outage diagnosis P1) so the KGI quote
 * ingest cron in server.ts can pull ticks for the tracked equity universe
 * and bridge them into `quoteProviders.kgi` via `upsertKgiQuotes`
 * (market-data.ts). No logic change — was previously module-private and
 * only called from `getKgiMarketOverview`/`getKgiCoreHeatmap` below.
 */
export async function fetchKgiLatestTick(symbol: string): Promise<KgiTickSnapshot> {
  // Gateway runs on an EventBridge weekday 08:20-14:10 schedule. Off-hours
  // every call would burn the full 3s timeout — /heatmap/kgi-core fans out to
  // 40 symbols in parallel (~3.5s dead latency per request, measured 6/15
  // 15:13) and /overview/kgi hits the index pair. Short-circuit to a null
  // snapshot so the heatmap enricher and overview fall straight through to
  // their MIS intraday / EOD tiers instead of waiting on a closed gateway.
  const { isKgiGatewayScheduledOff } = await import("./broker/kgi-gateway-schedule.js");
  if (isKgiGatewayScheduledOff()) return nullTickSnapshot(symbol);

  const gatewayUrl = getGatewayUrl();
  const encodedSymbol = encodeURIComponent(symbol);
  const url = `${gatewayUrl}/quote/ticks?symbol=${encodedSymbol}&limit=1`;

  try {
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(3_000),
    });

    if (!resp.ok) {
      return nullTickSnapshot(symbol);
    }

    const raw = (await resp.json()) as {
      ticks?: Array<{
        close?: number;
        price_chg?: number;
        pct_chg?: number;
        datetime?: string;
        _received_at?: string;
      }>;
    };

    const tick = raw.ticks?.[0];
    if (!tick) return nullTickSnapshot(symbol);

    // Real tick made it all the way back — this is the one place in the file
    // that actually observes live gateway data flowing for a symbol, so it's
    // the natural (and only, until 2026-07-16) writer of recordTickReceived().
    recordTickReceived(symbol);

    const ts = tick.datetime ?? tick._received_at ?? null;
    const staleSec = ts ? Math.round((Date.now() - Date.parse(ts)) / 1000) : null;

    return {
      symbol,
      value: tick.close ?? null,
      change: tick.price_chg ?? null,
      changePct: tick.pct_chg != null ? Math.round(tick.pct_chg * 100) / 100 : null,
      ts,
      source: "kgi_tick",
      staleSec,
    };
  } catch {
    return nullTickSnapshot(symbol);
  }
}

function nullTickSnapshot(symbol: string): KgiTickSnapshot {
  return {
    symbol,
    value: null,
    change: null,
    changePct: null,
    ts: null,
    source: "kgi_tick",
    staleSec: null,
  };
}

// ── KGI Core Heatmap (realtime from KGI tick) ─────────────────────────────────

export interface KgiHeatmapTile {
  symbol: string;
  name?: string;
  price: number | null;
  change: number | null;
  changePct: number | null;
  tier: string;
  ts: string | null;
  source: "kgi_tick";
}

/**
 * Build core heatmap from KGI tick data for:
 *   - 前 15 權值股 (CORE_SYMBOLS)
 *   - 策略 holdings (STRATEGY_SYMBOLS)
 *   - 楊董持倉 (dynamic, from subscription pool HOLDINGS tier)
 *
 * Returns array of tiles. Symbols with no tick data have null price/change.
 */
export async function getKgiCoreHeatmap(): Promise<{
  tiles: KgiHeatmapTile[];
  source: "kgi_tick";
  staleAfterSec: number;
  tileCount: number;
}> {
  if (!_initialized) initSubscriptionManager();

  // Use the 40-symbol dashboard universe, then add any current holdings.
  // The subscribed KGI quota set is only 19 symbols (15 core + 4 strategy);
  // using it here made the visible heatmap collapse to a few tiles per sector.
  const holdingSymbols = _slots
    .filter((s) => s.tier === TIER.HOLDINGS)
    .map((s) => s.symbol);

  const allSymbols = Array.from(
    new Set([
      ...HEATMAP_CORE_SYMBOLS,
      ...holdingSymbols,
    ])
  );

  const tiles = await Promise.all(
    allSymbols.map(async (symbol) => {
      const tick = await fetchKgiLatestTick(symbol);
      const slot = _slots.find((s) => s.symbol === symbol);
      const tier =
        CORE_SYMBOLS.includes(symbol as typeof CORE_SYMBOLS[number])
          ? "core"
          : STRATEGY_SYMBOLS.includes(symbol as typeof STRATEGY_SYMBOLS[number])
          ? "strategy"
          : holdingSymbols.includes(symbol)
          ? "holdings"
          : "core_display";

      return {
        symbol,
        price: tick.value,
        change: tick.change,
        changePct: tick.changePct,
        tier,
        ts: tick.ts,
        source: "kgi_tick" as const,
      } satisfies KgiHeatmapTile;
    })
  );

  return {
    tiles,
    source: "kgi_tick",
    staleAfterSec: 5,
    tileCount: tiles.length,
  };
}

// ── Utility ────────────────────────────────────────────────────────────────────

function tierName(tier: SubscriptionTier): string {
  const names: Record<SubscriptionTier, string> = {
    [TIER.INDEX]: "index",
    [TIER.STRATEGY]: "strategy",
    [TIER.HOLDINGS]: "holdings",
    [TIER.WATCHLIST]: "watchlist",
    [TIER.CORE]: "core",
    [TIER.BUFFER]: "buffer",
  };
  return names[tier] ?? String(tier);
}
