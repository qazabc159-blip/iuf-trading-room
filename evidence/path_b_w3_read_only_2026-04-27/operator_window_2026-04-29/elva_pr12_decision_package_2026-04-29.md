# PR #12 Decision Package — Symbol Whitelist Option C

**Author**: Elva
**Date**: 2026-04-29
**Status**: AWAITING 楊董「PR #12 merge ACK」 — DO NOT auto-merge
**PR**: #12 / `feat/w5b-jason-a2-whitelist-draft @ 2f61a65`
**Base**: `main @ 6749d49`
**Companion docs**: `bruce_pr12_w9_verify.md` (15-point gate), `elva_w5c_hybrid_consolidated_closeout_2026-04-29.md` §3 D2

---

## §1 — Option C Definition

**Option C: config-required (no default whitelist).**

| Input (env `KGI_QUOTE_SYMBOL_WHITELIST`) | `parseSymbolWhitelist` returns |
|------------------------------------------|--------------------------------|
| `undefined` (env unset) | `{ configured: false }` |
| `null` | `{ configured: false }` |
| `""` (empty string) | `{ configured: false }` |
| `"   "` (whitespace only) | `{ configured: false }` |
| `",,,"` (all-empty after split) | `{ configured: false }` |
| `"2330"` | `{ configured: true, whitelist: ["2330"] }` |
| `"2330,2317,2454"` | `{ configured: true, whitelist: ["2330","2317","2454"] }` |
| `"2330, 2317 ,2454"` (with spaces) | `{ configured: true, whitelist: ["2330","2317","2454"] }` |
| `"2330,"` (trailing comma) | `{ configured: true, whitelist: ["2330"] }` |

The TypeScript discriminated union forces every caller to handle BOTH branches at compile time.

---

## §2 — Safety Rationale

The prior baseline (Option β) baked in `DEFAULT_WHITELIST = ["2330"]`. That meant: if ops forgot to set the env var, every `/quote/*` route on TWSE 2330 silently green-lit, while every other symbol returned a clean 422. **Same env, ambiguous failure mode.** This is a fail-open footgun: the system looks "mostly working" while running with a misconfigured allowlist.

Option C converts that to fail-closed:

- Env unset → ALL `/quote/*` requests return 503 `WHITELIST_NOT_CONFIGURED`
- Env set + symbol on list → 200 (normal)
- Env set + symbol off list → 422 `SYMBOL_NOT_ALLOWED`

This matches the direction of every other W5b reliability gate (`/order/create` 409 short-circuit, `/position` Candidate F 503 circuit breaker, freshness 4-state classifier): **prefer a loud, structured failure to a quiet partial success**.

---

## §3 — Env Var Requirements (post-merge ops surface)

When the W9 wiring PR lands (separate PR — NOT in #12), Railway env config will require:

| Env var | Required when | Example value | Failure if missing |
|---------|---------------|---------------|--------------------|
| `KGI_QUOTE_SYMBOL_WHITELIST` | Quote routes are intended to serve traffic | `"2330,2317,2454"` | All `/quote/*` return 503 `WHITELIST_NOT_CONFIGURED` |

**Production env state today**: Railway main does not yet read this env var via `lib/symbol-whitelist.ts` — the existing `kgi-quote-client.ts` reads it directly with its own internal default. So merging PR #12 does NOT change runtime behavior; the wiring PR will.

**Pre-W9 ops checklist (gated)**: before W9 wiring PR is merged, confirm `KGI_QUOTE_SYMBOL_WHITELIST` is set on Railway with the explicit symbol list 楊董 has authorised for live quote.

---

## §4 — Unset Behavior (post-W9-wiring)

Caller pattern (illustrative — actual wiring lands in W9 PR):

```ts
import {
  parseSymbolWhitelist,
  isSymbolAllowed,
  buildWhitelistNotConfiguredEnvelope,
  buildSymbolNotAllowedEnvelope,
  WHITELIST_ENV_VAR,
} from "./lib/symbol-whitelist.js";

const result = parseSymbolWhitelist(process.env[WHITELIST_ENV_VAR]);

if (!result.configured) {
  // Whitelist not configured — fail closed
  reply.code(503).send(buildWhitelistNotConfiguredEnvelope());
  return; // 0 SDK calls, 0 KGI gateway hits
}

if (!isSymbolAllowed(symbol, result.whitelist)) {
  reply.code(422).send(buildSymbolNotAllowedEnvelope(symbol));
  return; // 0 SDK calls
}

// proceed to KGI gateway
```

Hard line: callers MUST short-circuit BEFORE any SDK or network call when `configured: false` or `isSymbolAllowed === false`.

---

## §5 — Rejection Behavior (post-W9-wiring)

Two distinct rejection envelopes:

```jsonc
// 503 — whitelist not configured
{
  "error": {
    "code": "WHITELIST_NOT_CONFIGURED",
    "message": "Symbol whitelist env var 'KGI_QUOTE_SYMBOL_WHITELIST' is not set. Quote routes are disabled until ops configures an explicit symbol list.",
    "envVar": "KGI_QUOTE_SYMBOL_WHITELIST"
  }
}

// 422 — symbol off the configured whitelist
{
  "error": {
    "code": "SYMBOL_NOT_ALLOWED",
    "message": "Symbol '9999' is not on the quote whitelist (KGI_QUOTE_SYMBOL_WHITELIST).",
    "symbol": "9999"
  }
}
```

Status code rationale:
- **503** for `WHITELIST_NOT_CONFIGURED` — service-config error (ops surface), not client error. Distinguishes "we are not ready" from "your request was bad".
- **422** for `SYMBOL_NOT_ALLOWED` — the request is well-formed but semantically refused; matches W5b convention for unprocessable-entity rejections.

---

## §6 — Deferred Items (NOT in PR #12 scope)

The following are **explicitly excluded** from PR #12 and tracked as follow-up:

1. **W9 wiring PR**: Replace `kgi-quote-client.ts`'s internal `parseSymbolWhitelist` + `DEFAULT_WHITELIST` with imports from `lib/symbol-whitelist.ts`. Wire `/quote/snapshot/:symbol` and `/quote/kbar/:symbol` to surface `WHITELIST_NOT_CONFIGURED` (503) when env-unset. Separate PR; separate Bruce verify; separate operator-window retest.
2. **Railway env audit**: Confirm `KGI_QUOTE_SYMBOL_WHITELIST` value on production Railway BEFORE the W9 wiring PR merges. Today's verify did not touch Railway env.
3. **`server.ts` line 2393 stale comment**: References `KGI_QUOTE_SYMBOL_WHITELIST (D-W2D-2)` — re-validate after W9 wiring; may be redundant.
4. **`/quote/status` whitelist policy**: undecided whether `/quote/status` itself (no symbol param) should be gated by `WHITELIST_NOT_CONFIGURED`. Currently leans toward **no** (status returns gateway-level health, not symbol-level data). Decision held until W9.
5. **WS `/ws/quote` enforcement**: WS subscribe path may bypass HTTP route guards. W9 wiring PR must address WS enforcement explicitly.

---

## §7 — Elva Recommendation

**Merge PR #12 as-is**, gated by 楊董「PR #12 merge ACK」.

Reasoning:
- Pure additive refactor with `0 / 0` modifications to existing files
- CI green at 2026-04-29T04:09:33Z
- Zero runtime behavior change until W9 wiring PR (the new lib is dead code post-merge until wired)
- 16/16 unit tests PASS, including no-order grep proof and envelope shape assertions
- Discriminated union forces correct handling at every future caller — TypeScript-enforced safety
- Rollback is one `git revert <merge-commit>` — no migration, no env change to undo

**Do not auto-merge.** This package + Bruce W9 verify give 楊董 the basis to issue the merge ACK with full audit trail.

---

## §8 — Risks (residual)

| Risk | Severity | Mitigation |
|------|----------|------------|
| Behavior divergence: new lib (no default) vs existing `kgi-quote-client.ts` (default `["2330"]`) coexists post-merge | LOW (not user-visible until wired) | W9 wiring PR must remove `DEFAULT_WHITELIST` from `kgi-quote-client.ts` in the same commit that imports the new lib |
| W9 wiring PR mis-handles the `configured: false` branch and returns 200 | MEDIUM | Discriminated union forces compile-time check; Bruce W9 verify on the wiring PR will assert `503` envelope shape |
| Railway env `KGI_QUOTE_SYMBOL_WHITELIST` is not set when W9 lands | MEDIUM | Pre-W9 deploy gate: confirm env is set BEFORE merging the wiring PR; `WHITELIST_NOT_CONFIGURED` 503 itself is fail-closed, so worst case is loud breakage, not silent regression |
| `/quote/*` callers (apps/web hooks, Jim sandbox) treat 503 as 5xx and retry-storm | LOW | Frontend SWR defaults already cap retries; W9 wiring PR docs the new 503 contract |
| Stray remote branch `pr12` re-pushed | RESOLVED | Deleted in prior session; verify pre-merge: `git ls-remote origin pr12` should return 0 lines |

---

## §9 — Rollback Plan

If post-merge regression surfaces:

1. **Trigger**: any of:
   - `validate` CI red on main
   - Production Railway deploy red
   - Any `/quote/*` route returns unexpected 503 / 422 in production smoke
   - Any test from `apps/api/src/__tests__/symbol-whitelist.test.ts` flakes on main

2. **Action**:
   ```powershell
   # On main, post-merge commit X assumed
   git fetch origin main
   git checkout main
   git pull --ff-only origin main
   git revert <X> --no-edit
   git push origin main
   ```
   - Reverts both new files (additive → revert removes them cleanly)
   - No env var to roll back (PR #12 doesn't read any env)
   - No DB migration to roll back
   - No deploy script change to roll back

3. **Verify revert**:
   - CI green on revert commit
   - Railway deploy green
   - `apps/api/src/lib/symbol-whitelist.ts` no longer exists on main
   - Existing `kgi-quote-client.ts` behavior unchanged (it never read the new lib)

4. **Post-rollback**: re-evaluate Option C design before re-attempting; do not auto-rebuild.

Estimated rollback time: < 10 min from trigger to production green.

---

## Decision Trail

| Date | Decision | Authority |
|------|----------|-----------|
| 2026-04-28 | PR #12 opened with Option β (default `["2330"]`) | Jason draft |
| 2026-04-29 | 楊董 D2: switch to Option C (no default) | 楊董 verbatim |
| 2026-04-29 12:07 TST | `2f61a65` pushed to PR head — Option C complete + 16/16 tests | Elva |
| 2026-04-29 04:09Z | CI `validate` SUCCESS on PR head | GitHub Actions |
| 2026-04-29 (this doc) | Bruce W9 verify 15/15 PASS; decision package filed | Elva (Bruce-substitute) |
| TBD | Merge ACK | 楊董 verbatim「PR #12 merge ACK」 |

**Awaiting**: 楊董「PR #12 merge ACK」.
