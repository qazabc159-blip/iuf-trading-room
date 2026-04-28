---
name: Jason W4 odd_lot Kwarg Fix Implementation Note
description: B2 Q1 fix — remove odd_lot from subscribe_kbar SDK call; DRAFT PR #9
type: impl-note
date: 2026-04-28
author: Jason (backend-strategy-jason)
pr: https://github.com/qazabc159-blip/iuf-trading-room/pull/9
commit: be5ba7f
branch: feat/w4-kbar-odd-lot-fix
base: fab35f2 (main HEAD at time of branch cut)
---

# Jason W4 — odd_lot Kwarg Fix Implementation Note

## §1 Bruce Flag Context

Bruce W4 operator window check A5 surfaced a live SDK incompatibility blocking all K-bar subscribe calls.

Evidence file: `evidence/path_b_w3_read_only_2026-04-27/bruce_w4_partA_partB_lane4_audit.md` §A5

Bruce observed: POST /quote/subscribe/kbar with body {symbol:2330,interval:1m} (and 5m/15m/1d) returned HTTP 502 for all four intervals. The gateway log showed:

```
KGI_SUBSCRIBE_KBAR_FAILED: _Quote.subscribe_kbar() got an unexpected keyword argument 'odd_lot'
```

Bruce verdict: FLAG_SDK_KWARG_INCOMPATIBILITY — needs Jason to check kgisuperpy SDK version and remove/fix odd_lot kwarg.

The error was caught and wrapped correctly (gateway did not crash, returned structured 502), so this was flagged but not a stop-line.

## §2 Diagnosis

**Where the kwarg comes from:**

The call chain is:

1. Client sends: POST /quote/subscribe/kbar with body `{"symbol":"2330","odd_lot":false,"interval":"1m"}`
2. `schemas.py` `SubscribeKbarRequest`: accepts `odd_lot: bool = False` as request schema field
3. `app.py` line 792: calls `kbar_manager.subscribe_kbar(session.api, body.symbol, odd_lot=body.odd_lot)`
4. `kgi_kbar.py` line 255: `KgiKbarManager.subscribe_kbar(self, api, symbol: str, odd_lot: bool = False)` — manager method
5. `kgi_kbar.py` line 315 (version path): `kbar_subscribe_fn(symbol, odd_lot=odd_lot, version=QuoteVersion.v1)`
6. `kgi_kbar.py` line 317 (fallback path): `kbar_subscribe_fn(symbol, odd_lot=odd_lot)`

Steps 5 and 6 call `api.Quote.subscribe_kbar()` directly. The SDK's `subscribe_kbar()` does not accept `odd_lot` as a kwarg in the installed kgisuperpy version (2.0.3).

**Why it was written this way:**

W3 B2 K-bar implementation followed the pattern from `kgi_quote.py` subscribe_tick/subscribe_bidask, where `odd_lot` is a valid SDK kwarg (`api.Quote.subscribe_tick(symbol, odd_lot=..., version=...)`). The kbar implementation assumed subscribe_kbar would have the same signature. The kbar SDK surface is more limited — it does not accept odd_lot.

**Why it is safe to remove:**

The `odd_lot` kwarg controls whether to subscribe to odd-lot (zero-lot) trades vs regular lots. For K-bar data, the SDK appears to only expose regular-lot bars and does not provide odd-lot filtering at the subscribe level. Dropping the kwarg means the SDK will use its default (regular lot), which is correct behavior for the trading context.

## §3 Fix Scope

**File changed:** `services/kgi-gateway/kgi_kbar.py`

**Lines changed:** 2 lines removed, 4 lines added (net +2)

Before:
```python
        try:
            from kgisuperpy.marketdata.quote_data.quotedata import QuoteData as _QuoteData
            QuoteVersion = _QuoteData.QuoteVersion
            label = kbar_subscribe_fn(symbol, odd_lot=odd_lot, version=QuoteVersion.v1)
        except Exception:
            label = kbar_subscribe_fn(symbol, odd_lot=odd_lot)
```

After:
```python
        try:
            from kgisuperpy.marketdata.quote_data.quotedata import QuoteData as _QuoteData
            QuoteVersion = _QuoteData.QuoteVersion
            # odd_lot kwarg removed: installed kgisuperpy subscribe_kbar() does not accept it (W4 B2 Q1 fix)
            label = kbar_subscribe_fn(symbol, version=QuoteVersion.v1)
        except Exception:
            # Fallback: no version kwarg, no odd_lot kwarg
            label = kbar_subscribe_fn(symbol)
```

**Not changed (intentionally retained):**
- `schemas.py` `SubscribeKbarRequest.odd_lot: bool = False` — retained for backward-compatible client interface; the field is accepted but not forwarded to SDK
- `kgi_kbar.py` `KgiKbarManager.subscribe_kbar(... odd_lot: bool = False)` — method signature retained; the parameter is received but not forwarded to SDK
- `app.py` line 792 call to `kbar_manager.subscribe_kbar(session.api, body.symbol, odd_lot=body.odd_lot)` — retained; the manager silently ignores odd_lot at the SDK boundary

## §4 SDK Signature Evidence

Direct evidence: Bruce A5 live error `_Quote.subscribe_kbar() got an unexpected keyword argument 'odd_lot'` — this is the SDK's own TypeError, confirming the method does not accept odd_lot.

Supporting evidence:
- kgisuperpy 2.0.3 is installed (confirmed in W2c parallel sprint learnings)
- `api.Quote.subscribe_tick()` DOES accept odd_lot (confirmed working in kgi_quote.py — tick subscribe works)
- `api.Quote.subscribe_bidask()` DOES accept odd_lot (confirmed in W2c bidask fix — bidask subscribe works)
- `api.Quote.subscribe_kbar()` does NOT accept odd_lot (confirmed by live 502 on all 4 intervals)

The asymmetry (tick/bidask accept odd_lot, kbar does not) is an SDK design choice — kbar subscription likely only exposes regular-lot OHLCV bars.

No local kgisuperpy stub file was found in the gateway directory to read the signature statically; the live error from Bruce is conclusive.

## §5 Pre-Restart Code-Level Verify

The following can be verified without gateway restart:

1. grep confirms `odd_lot` NO LONGER appears in the two SDK call sites:
   ```
   grep -n "kbar_subscribe_fn" services/kgi-gateway/kgi_kbar.py
   # Expected: line 316 kbar_subscribe_fn(symbol, version=...) — no odd_lot
   # Expected: line 319 kbar_subscribe_fn(symbol) — no odd_lot
   ```

2. Python kbar tests still pass (13/13) — no test asserts on the exact SDK call signature. Tests mock at the handler level (QUOTE_DISABLED / NOT_LOGGED_IN gates), not at the SDK call level.

3. The change is in `services/kgi-gateway/kgi_kbar.py` only. Zero files in apps/api, contracts, or frontend are touched.

## §6 Hard-Line Check

| Hard line | Status |
|---|---|
| Zero contracts touched | HELD — IUF_SHARED_CONTRACTS HEAD 9957c91 unchanged |
| Zero apps/api routes or Zod touched | HELD |
| Zero frontend touched | HELD |
| Zero write-path touched (/order/create, /position, broker/*) | HELD |
| Zero merge / deploy | HELD — DRAFT PR only |
| Zero gateway restart | HELD — operator action required |
| Zero KGI relogin | HELD — operator action required |
| Zero real order | HELD |
| Zero secret in evidence | HELD |
| Lane boundary maintained | HELD — only kgi-gateway Python files touched |

## §7 Next Step

**Operator action required (in order):**

1. Gateway restart: stop current uvicorn, restart with same env (`KGI_GATEWAY_POSITION_DISABLED=true`, `KGI_GATEWAY_QUOTE_DISABLED=false`). The restart must pick up the new `kgi_kbar.py` from this branch. If operator restarts on main without this fix, the 502 will persist.
   - Operator should pull `feat/w4-kbar-odd-lot-fix` or wait until this PR is merged to main before restarting for the fix.
   - Alternatively: operator can apply the 2-line change manually before restart.

2. KGI relogin: POST /session/login after restart.

3. Bruce re-verify A5: POST /quote/subscribe/kbar {symbol:2330,interval:1m} — expected HTTP 200 with `ok:true` and label. Repeat for 5m/15m/1d.

4. If A5 passes: PR #9 can be readied for review and squash-merged to main in next merge window.

**PR URL:** https://github.com/qazabc159-blip/iuf-trading-room/pull/9
**Commit:** be5ba7f
**Branch:** feat/w4-kbar-odd-lot-fix (base: fab35f2 main)
**DRAFT:** Yes — NOT for merge until Bruce re-verify A5 PASS

## §8 Test Suite Addition (2026-04-28 overnight sprint)

Six new tests added to `services/kgi-gateway/tests/test_kbar.py` (T14–T19):

1. `test_subscribe_kbar_odd_lot_omitted` (T14) — SDK call with no odd_lot in request; confirms `odd_lot` kwarg absent from SDK call
2. `test_subscribe_kbar_odd_lot_false` (T15) — odd_lot=False in request; SDK boundary still receives no odd_lot kwarg
3. `test_subscribe_kbar_odd_lot_true` (T16) — odd_lot=True in request; SDK boundary still receives no odd_lot kwarg
4. `test_subscribe_kbar_sdk_signature_no_kwarg` (T17) — static source audit; verifies `kbar_subscribe_fn(` call lines contain no `odd_lot` string
5. `test_unsupported_interval_remains_unsupported` (T18) — regression guard; `interval=30m` still surfaces `interval_status=unsupported` (odd_lot fix did not break interval matrix)
6. `test_no_order_module_import` (T19) — no-order guarantee; kgi_kbar.py and test_kbar.py contain no `kgisuperpy.order` import or write-path function calls

Full test run result: **19/19 PASS**
- Existing 13 tests (T1–T13): 13/13 PASS
- New 6 tests (T14–T19): 6/6 PASS

No-order proof: `evidence/path_b_w3_read_only_2026-04-27/jason_w4_odd_lot_no_order_proof.md`

Bruce gate: §1 gate of `bruce_w4_odd_lot_fix_verify_checklist.md` is now satisfied at the code level.
Operator window gate remains: gateway restart + KGI relogin + live A5 verify still required.
