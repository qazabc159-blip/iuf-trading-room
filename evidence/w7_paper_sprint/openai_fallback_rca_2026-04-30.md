# OpenAI Fallback Root Cause Analysis — 2026-04-30

## Symptom
`GET /api/v1/themes/daily/2026-04-30` returns `generatedBy: "worker_cron:fallback_template"` instead of `worker_cron:gpt-5.4-mini`.

## (a) Env vars the worker reads

File: `apps/worker/src/jobs/daily-theme-summary-producer.ts`

| Var | Purpose | Fallback |
|---|---|---|
| `OPENAI_API_KEY` | Bearer token for OpenAI API. If absent → `routeReason: "api_key_missing"` | none — silently falls to template |
| `OPENAI_MODEL` | NOT read from env — hardcoded `"gpt-5.4-mini"` (lock prevents flip) | n/a |
| `PERSISTENCE_MODE` | Must be `"database"` for the cron to run at all | n/a |
| `DAILY_THEME_SUMMARY_INTERVAL_MS` | Cron cadence (default 4h) | 4 hours |

## (b) What to check on Railway

1. Go to Railway dashboard → **worker** service → **Variables** tab.
2. Confirm `OPENAI_API_KEY` is set. If it is missing → this is the sole root cause. Add it.
3. If present, check Railway **Deploy Logs** for the worker service around 03:27 UTC (when the row was generated). Search for:
   - `[daily-theme-summary] OPENAI_API_KEY not set` → key was missing at cron time
   - `[daily-theme-summary] OpenAI 4xx` → key present but invalid/rate-limited
   - `[daily-theme-summary] OpenAI call failed` → network or timeout
4. Confirm `PERSISTENCE_MODE=database` is set on the worker service (api service sets this too; they must match).

## (c) Error log signatures to look for

```
[daily-theme-summary] OPENAI_API_KEY not set — using fallback template
→ routeReason: api_key_missing
```

```
[daily-theme-summary] OpenAI 401: { "error": { "message": "Incorrect API key" } }
→ routeReason: http_error
```

```
[daily-theme-summary] OpenAI 429: { "error": { "message": "Rate limit exceeded" } }
→ routeReason: http_error
```

```
[daily-theme-summary] OpenAI call failed: fetch failed
→ routeReason: http_error (network)
```

## (d) Code fix shipped (this PR)

`callOpenAi()` now returns `{ content, routeReason }` instead of `string | null`.
`DailyThemeSummaryResult` now includes `routeReason: "api_key_missing" | "http_error" | "parse_error" | "success" | "skipped_existing"`.

Next cron run will log and return the exact reason. Example output after fix:
```json
{
  "route": "fallback_template",
  "routeReason": "api_key_missing",
  "generatedBy": "worker_cron:fallback_template"
}
```

## Resolution path

1. Add `OPENAI_API_KEY` to Railway worker service Variables.
2. Trigger a re-run: either wait for next 4h cron window, or temporarily set `DAILY_THEME_SUMMARY_INTERVAL_MS=60000` to force a run within 1 minute (then reset).
3. Confirm `route: "openai"` and `routeReason: "success"` in next cron output.

## Hard lines respected
- `OPENAI_API_KEY` value is never logged.
- `OPENAI_MODEL` is not flipped (remains `gpt-5.4-mini`).
- No secret value echoed here.
