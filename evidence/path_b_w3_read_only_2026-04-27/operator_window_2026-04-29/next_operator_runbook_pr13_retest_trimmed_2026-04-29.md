# Operator Retest Runbook — PR #13 (TRIMMED, 5-item)

**Trigger**: 楊董 verbatim 「operator window ready for PR13 retest」 — and only this exact phrase.
**Owner during run**: 楊董 (operator)
**Repo state at runbook authoring**: `main @ 6749d49` (PR #13 merge commit `f9d3b46` confirmed on remote main)
**Time budget**: ~5 min total (down from 6 min in the prior 10-item version)
**Supersedes (in scope)**: `next_operator_runbook_pr13_retest_2026-04-29.md` 5-payload section. The full version is preserved as the deeper-dive runbook for any future fuller verify; this trimmed version is the **default** for the next operator window.

---

## Why trimmed

楊董 directive 2026-04-29 narrows the next operator window to a minimum-viable green-bar verify. Specifically: confirm that `main @ 6749d49` is live on production gateway, that the read-side surface is unchanged, and that the two highest-risk write-side rejections (`/order/create` empty body, `/order/create` valid-shape body) still fail closed. Everything else is held until a future operator window with explicit additional scope.

The 5 items below are the minimum needed to call the merge "live-confirmed".

---

## Pre-flight (one-time, ~1 min)

```powershell
cd C:\Users\User\Desktop\小楊機密\交易\IUF_TRADING_ROOM_APP
git fetch origin main
git checkout main
git pull --ff-only origin main
git log -1 --oneline   # Expect: 6749d49 docs(w5c): ... — and PR #13 merge commit f9d3b46 visible in git log -5

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$logPath = "evidence/path_b_w3_read_only_2026-04-27/operator_window_2026-04-29/gateway_pr13_trimmed_$stamp.log"
python services/kgi-gateway/app.py 2>&1 | Tee-Object -FilePath $logPath
```

Wait until `Uvicorn running on http://0.0.0.0:8787` (or the configured port).

**STOP-LINE — preflight gate**: do NOT proceed with the 5 items until BOTH:
- `/health` returns 200, AND
- One W1.5 endpoint (e.g. `/quote/snapshot/2330`) returns 200 with `freshness != STALE`

Per `feedback_gateway_preflight_must_probe_w1_5.md`: a `/health` 200 alone is not sufficient confidence that the gateway is healthy. If the W1.5 probe fails, **STOP**, capture log, surface to Elva. Do NOT continue with the 5 items.

---

## The 5 items

```powershell
$base = "http://127.0.0.1:8787"
$out  = "evidence/path_b_w3_read_only_2026-04-27/operator_window_2026-04-29"

# Item 1 — read-side health (sanity)
curl.exe -s -o "$out/trimmed_1_health.json" -w "%{http_code}`n" "$base/health"
# Expect: 200

# Item 2 — /position 503 (Candidate F circuit breaker still active)
curl.exe -s -o "$out/trimmed_2_position.json" -w "%{http_code}`n" "$base/position"
# Expect: 503 with Candidate F envelope (assumes POSITION_DISABLED=1 in env, the default)
# If POSITION_DISABLED is explicitly cleared by 楊董, expect 200 instead — note in evidence

# Item 3 — /order/create empty body (the canonical PR #13 fix case)
curl.exe -s -o "$out/trimmed_3_order_empty.json" -w "%{http_code}`n" -X POST "$base/order/create" -H "Content-Type: application/json" -d "{}"
# Expect: 409 with body { "error": { "code": "NOT_ENABLED_IN_W1", ... } }

# Item 4 — /order/create valid-shape body (must STILL 409, not 200)
curl.exe -s -o "$out/trimmed_4_order_valid.json" -w "%{http_code}`n" -X POST "$base/order/create" -H "Content-Type: application/json" -d '{"symbol":"2330","side":"buy","qty":1,"price":600,"order_type":"limit"}'
# Expect: 409 NOT_ENABLED_IN_W1 — same envelope as Item 3, regardless of payload validity

# Item 5 — read-side combined: /quote/kbar/2330 + /quote/status (any order)
curl.exe -s -o "$out/trimmed_5a_kbar.json"   -w "%{http_code}`n" "$base/quote/kbar/2330?interval=1m&count=10"
curl.exe -s -o "$out/trimmed_5b_status.json" -w "%{http_code}`n" "$base/quote/status"
# Expect: 200 each. Item 5a body: count=10 k-bars. Item 5b body: gateway-level status block.
```

---

## Acceptance — ALL of:

- Item 1 → HTTP 200, body has `status: "ok"` (or equivalent live-mode shape)
- Item 2 → HTTP 503, body has Candidate F envelope (or 200 if 楊董 cleared POSITION_DISABLED — capture in evidence)
- Item 3 → HTTP 409, body matches `{ "error": { "code": "NOT_ENABLED_IN_W1", "message": ... } }`
- Item 4 → HTTP 409, identical envelope to Item 3
- Items 5a + 5b → HTTP 200 each; 5a returns 10 k-bars; 5b returns a gateway-level status block

If ANY of Items 3 or 4 returns 200 / 422 / 500: **STOP**. Capture response body. Surface to Elva immediately. Do NOT retry; do NOT change env vars. The route handler must short-circuit BEFORE Pydantic validation.

If Item 5 fails but Items 1–4 PASS: surface as a separate read-side regression — Items 1–4 still confirm the PR #13 merge, but Item 5 indicates the gateway lost W1.5 surface mid-window.

---

## 5 prohibitions (hard lines for this operator window)

1. **NO additional payload variants** — do NOT run T1 null-body / T4 partial-body / T5 over-large-body from the deeper-dive runbook. Those are deferred to a separate operator window.
2. **NO env var mutation** — do NOT change `POSITION_DISABLED`, `KGI_QUOTE_SYMBOL_WHITELIST`, or any other env in this window. The verify must run against the env exactly as Railway / operator host has it.
3. **NO write-side beyond `/order/create` 409 verify** — do NOT touch `/portfolio/kill-mode`, `/run/start`, `/run/stop`, or any other state-mutating route.
4. **NO retry on a failing item** — if any item fails, STOP and surface. Do not assume transient.
5. **NO operator-window extension** — when the 5 items are done, tear down. Do NOT extend the window into KGI escalation / Jim visual / Athena dispatch / W9 wiring / paper-live cutover. Those are explicitly out of scope.

---

## Tear-down

```powershell
# Ctrl-C the gateway window, then:
git status   # expect: only the .json/.log evidence files newly added under operator_window_2026-04-29/
```

Stage evidence (no commit yet — Elva batches into the next consolidated closeout):

```powershell
git add evidence/path_b_w3_read_only_2026-04-27/operator_window_2026-04-29/trimmed_*.json
git add evidence/path_b_w3_read_only_2026-04-27/operator_window_2026-04-29/gateway_pr13_trimmed_*.log
```

---

## Time budget

- Pre-flight (start gateway + W1.5 probe): ~2 min
- 5 items: ~2 min (parallel-safe but sequential keeps log readable)
- Tear-down + evidence stage: ~1 min
- **Total**: ~5 min

---

## Trigger phrase reminder

The ONLY phrase that authorises this runbook to execute:

> **「operator window ready for PR13 retest」**

Variants ("the operator is ready", "go ahead with the retest", "do it") do NOT authorise. If 楊董 issues anything other than the verbatim phrase, surface for clarification before running gateway start. This rule is from the 2026-04-29 directive and is not relaxable by Elva autonomous mode.
