---
name: W3 B2 K-bar Interval Matrix
description: SDK interval support status for kgisuperpy subscribe_kbar — supported / unsupported / unknown; no hard-transcode
type: interval_matrix
date: 2026-04-27
sprint: W3 Read-Only Expansion Sprint
lane: B2
author: Jason (backend-strategy-jason)
---

# W3 B2 — K-bar Interval Matrix

## §1. Method Scope

This matrix covers `kgisuperpy.TWStockQuote.subscribe_kbar(symbol)` and
`TWStockQuote.recover_kbar(symbol, from_date, to_date)`.

**Hard line**: Unsupported intervals MUST NOT be hard-transcoded. They are
recorded here and surfaced in API response as `interval_status: "unsupported"`.

## §2. W3 B2 Supported Interval Set

Intervals that apps/api and gateway ACCEPT without returning unsupported:

| Interval | Status | Notes |
|---|---|---|
| `1m` | SUPPORTED (intended) | SDK granularity confirmation requires live session (Q1 open) |
| `5m` | SUPPORTED (intended) | Same as above |
| `15m` | SUPPORTED (intended) | Same as above |
| `1d` | SUPPORTED (intended) | Daily bar — recover_kbar verified shape |

**Important caveat**: "SUPPORTED (intended)" means the gateway ACCEPTS these
intervals and forwards them to the SDK. The SDK may return bars at the native
exchange granularity regardless of this value (SDK resolution param unconfirmed —
see Q1 in v0_7_0_kbar_api_audit.md §6). Phase 3 will resolve Q1 with a live
operator session.

## §3. Unsupported Interval Matrix

Intervals that the gateway surfaces as `interval_status: "unsupported"` with
an `unsupported_reason`. These are NOT transcoded.

| Interval | Status | Unsupported Reason |
|---|---|---|
| `30m` | UNSUPPORTED | SDK subscribe_kbar does not expose resolution parameter; 30m interval not confirmed |
| `1h` | UNSUPPORTED | SDK subscribe_kbar does not expose resolution parameter; 1h interval not confirmed |
| `4h` | UNSUPPORTED | SDK subscribe_kbar does not expose resolution parameter; 4h interval not confirmed |
| `1w` | UNSUPPORTED | SDK subscribe_kbar does not expose resolution parameter; 1w interval not confirmed |
| `1M` | UNSUPPORTED | SDK subscribe_kbar does not expose resolution parameter; monthly interval not confirmed |

When an unsupported interval is sent in `POST /quote/subscribe/kbar`:
- HTTP 200 (not an error)
- `interval_status: "unsupported"`
- `unsupported_reason: <reason string>`
- `label: null`
- NO hard-transcode to a different interval

## §4. Open Questions (Phase 3)

These require a live KGI session + operator time to resolve:

| Q | Question | Impact |
|---|---|---|
| Q1 | Does `subscribe_kbar` support a resolution param (1m / 5m / 15m / 1d)? | Determines real-time vs daily chart |
| Q2 | What is `recover_kbar` date range limit? | FE pagination strategy |
| Q3 | Timezone of K-bar timestamps? | UTC normalisation design |
| Q4 | Does SDK push K-bars outside market hours? | Filter logic |
| Q5 | Subscribe cadence: per-minute close vs per-tick update? | FE rendering strategy |

Source: `evidence/path_b_w2a_20260426/v0_7_0_kbar_api_audit.md` §6

## §5. Future Intervals (Reserved — Not Implemented in W3 B2)

| Interval | Future Status | Note |
|---|---|---|
| `2m` | TBD | Would need Q1 resolution |
| `3m` | TBD | Would need Q1 resolution |
| `10m` | TBD | Would need Q1 resolution |
| `30m` | TBD | Currently in unsupported matrix |
| `60m` | TBD | Alias for 1h — currently unsupported |

— Jason, 2026-04-27 W3 sprint
