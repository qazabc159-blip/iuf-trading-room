# Railway Runbook

This runbook is for day-to-day operations of the live Railway deployment.

## Current Production State

- Project: `iuf-trading-room`
- Environment: `production`
- Web: `https://web-production-7896c.up.railway.app`
- API: `https://api-production-8f08.up.railway.app`
- Active services: `web`, `api`, `worker`, `pg`, `cache`

## Health Commands

Run these from the repo root:

```powershell
railway.cmd status
railway.cmd service status --service web
railway.cmd service status --service api
railway.cmd service status --service worker
railway.cmd service status --service pg
railway.cmd service status --service cache
```

Quick production checks:

```powershell
Invoke-WebRequest -UseBasicParsing "https://api-production-8f08.up.railway.app/health"
Invoke-WebRequest -UseBasicParsing "https://api-production-8f08.up.railway.app/api/v1/session"
Invoke-WebRequest -UseBasicParsing "https://api-production-8f08.up.railway.app/api/v1/openalice/observability" -Headers @{"x-workspace-slug"="primary-desk"}
Invoke-WebRequest -UseBasicParsing "https://api-production-8f08.up.railway.app/api/v1/openalice/devices" -Headers @{"x-workspace-slug"="primary-desk"}
Invoke-WebRequest -UseBasicParsing "https://web-production-7896c.up.railway.app"
```

## Logs

```powershell
railway.cmd logs --service api --latest --lines 200
railway.cmd logs --service worker --latest --lines 200
railway.cmd logs --service pg --latest --lines 200
railway.cmd logs --service cache --latest --lines 200
railway.cmd logs --service web --latest --lines 200
```

Build logs:

```powershell
railway.cmd logs --service api --latest --build --lines 200
railway.cmd logs --service worker --latest --build --lines 200
railway.cmd logs --service web --latest --build --lines 200
```

## Redeploy And Restart

Redeploy the latest version:

```powershell
railway.cmd redeploy --service api
railway.cmd redeploy --service worker
railway.cmd redeploy --service web
```

Restart without rebuilding:

```powershell
railway.cmd restart --service api
railway.cmd restart --service worker
railway.cmd restart --service web
```

Deploy from the current local repo:

```powershell
railway.cmd up -s api -d
railway.cmd up -s worker -d
railway.cmd up -s web -d
```

## Secrets And Variables

List variables for a service:

```powershell
railway.cmd variable list --service api
railway.cmd variable list --service worker
railway.cmd variable list --service pg
railway.cmd variable list --service cache
```

Set a variable:

```powershell
railway.cmd variable set -s api KEY=value
```

Delete a variable:

```powershell
railway.cmd variable delete -s api KEY
```

When `DATABASE_URL`, `REDIS_URL`, or `NEXT_PUBLIC_API_BASE_URL` changes, redeploy the affected service immediately after the update.

OpenAlice bridge reliability knobs:

```powershell
railway.cmd variable set -s api OPENALICE_DEFAULT_TIMEOUT_SECONDS=900 OPENALICE_MAX_ATTEMPTS=3
railway.cmd variable set -s worker OPENALICE_DEFAULT_TIMEOUT_SECONDS=900 OPENALICE_MAX_ATTEMPTS=3
railway.cmd variable set -s worker OPENALICE_SWEEP_INTERVAL_SECONDS=60 OPENALICE_DEVICE_STALE_SECONDS=21600
```

TradingView webhook secret:

```powershell
railway.cmd variable set -s api TV_WEBHOOK_TOKEN=replace-with-your-secret
```

## Common Incidents

### API health fails

1. Check `api` logs.
2. Confirm `pg` is `SUCCESS`.
3. Confirm migrations completed during API boot.
4. Hit `/health` and `/api/v1/session` manually.

### Worker is up but not processing

1. Check `worker` logs for startup errors.
2. Confirm `REDIS_URL` is present on `worker`.
3. Look for `Redis connected (PONG).`
4. Look for an `OpenAlice maintenance (...)` log line after startup.
5. Check that `cache` is `SUCCESS`.

### Web loads but data is empty or broken

1. Confirm `NEXT_PUBLIC_API_BASE_URL` still points to the live API domain.
2. Check browser requests against `api-production-8f08.up.railway.app`.
3. Verify `/api/v1/session` works from the public API domain.

### Postgres issues

1. Check `pg` logs for boot or volume errors.
2. Confirm volume is still attached at `/var/lib/postgresql/data`.
3. Confirm `PGDATA=/var/lib/postgresql/data/pgdata`.

### Redis issues

1. Check `cache` logs for boot failures.
2. Confirm volume is still attached at `/data`.
3. Confirm `api` and `worker` both use `redis://cache.railway.internal:6379`.

### OpenAlice job appears stuck

1. Check `api` logs for failed claim/result requests.
2. Check `worker` or device logs for missed heartbeats.
3. Confirm `OPENALICE_DEFAULT_TIMEOUT_SECONDS` and `OPENALICE_MAX_ATTEMPTS` are set as expected.
4. Confirm the worker is still running scheduled sweeps via `OpenAlice maintenance (...)` log lines.
5. Hit `/api/v1/openalice/observability` to confirm current worker freshness and queue counters.
6. Hit `/api/v1/openalice/devices` to see whether the claimant device is stale, active, or already revoked.
7. If you need a one-off stale cleanup, call `POST /api/v1/openalice/devices/cleanup` with `{ "staleSeconds": 21600 }` or a shorter threshold for emergency remediation.
8. Inspect `iuf:openalice:last_sweep` and `iuf:openalice:metrics` in Redis if needed.
9. Wait for the lease to expire, then verify the job is re-queued or marked failed after retry exhaustion.

### TradingView webhook returns 401 or 400

1. Confirm `TV_WEBHOOK_TOKEN` is set on `api`.
2. Verify the TradingView alert body is valid JSON and includes `token` plus `ticker`.
3. Check `api` logs for `validation_error` or `unauthorized`.
4. Replay the payload locally with `Invoke-WebRequest` before changing the alert template.

## Cleanup Tasks

- Delete the legacy failed `redis` service in Railway.
- Keep only `cache` as the active Redis service.
- If domains change, update this runbook and `RAILWAY_DEPLOYMENT.md` in the same commit.

## Change Management

For platform-affecting changes, use this order:

1. Update repo docs and scripts.
2. Push to GitHub.
3. Deploy `api`.
4. Verify API health and migrations.
5. Deploy `worker`.
6. Verify worker logs and Redis connection.
7. Deploy `web`.
8. Verify the public homepage and core API reads.
