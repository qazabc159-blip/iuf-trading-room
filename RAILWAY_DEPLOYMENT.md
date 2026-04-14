# Railway Deployment

This repo is deployed on Railway as a single project with five active services:

- `web`: Next.js control tower
- `api`: Hono API
- `worker`: long-running background worker
- `pg`: PostgreSQL 16 container with a Railway volume
- `cache`: Redis 7 container with a Railway volume

Current production endpoints:

- `web`: `https://web-production-7896c.up.railway.app`
- `api`: `https://api-production-8f08.up.railway.app`

There is also one legacy failed service named `redis` left over from an early image-tag mistake. It is not used by production and can be deleted from the Railway dashboard.

## Service Inventory

| Service | Type | Source | Notes |
| --- | --- | --- | --- |
| `web` | App | GitHub repo root | Uses `pnpm build:web` and `pnpm start:web` |
| `api` | App | GitHub repo root | Runs migrations before boot with `pnpm start:api:railway` |
| `worker` | App | GitHub repo root | Connects to Postgres and Redis |
| `pg` | Docker image | `postgres:16-alpine` | Volume mounted at `/var/lib/postgresql/data` |
| `cache` | Docker image | `redis:7-alpine` | Volume mounted at `/data` |

## Build And Start Commands

Configure each app service from the repo root.

### web

- Build command: `pnpm build:web`
- Start command: `pnpm start:web`

### api

- Build command: `pnpm build:api`
- Start command: `pnpm start:api:railway`

### worker

- Build command: `pnpm build:worker`
- Start command: `pnpm start:worker`

The root scripts that support these commands live in `package.json`.

## Environment Matrix

### Shared defaults

```env
DEFAULT_WORKSPACE_SLUG=primary-desk
NEXT_PUBLIC_DEFAULT_WORKSPACE_SLUG=primary-desk
HOST=0.0.0.0
```

### pg

Set these directly on the `pg` service:

```env
POSTGRES_DB=iuf_trading_room
POSTGRES_USER=iuf_admin
POSTGRES_PASSWORD=<secret>
PGDATA=/var/lib/postgresql/data/pgdata
```

Internal connection host: `pg.railway.internal`

### cache

No extra runtime config is required beyond the default `redis:7-alpine` image.  
Internal connection host: `cache.railway.internal`

### api

```env
PERSISTENCE_MODE=database
DATABASE_URL=postgresql://iuf_admin:<secret>@pg.railway.internal:5432/iuf_trading_room
REDIS_URL=redis://cache.railway.internal:6379
DEFAULT_WORKSPACE_SLUG=primary-desk
HOST=0.0.0.0
TV_WEBHOOK_TOKEN=<secret-used-by-tradingview-alerts>
OPENALICE_DEFAULT_TIMEOUT_SECONDS=900
OPENALICE_MAX_ATTEMPTS=3
RAILPACK_INSTALL_CMD=pnpm install --frozen-lockfile
RAILPACK_BUILD_CMD=pnpm build:api
RAILPACK_START_CMD=pnpm start:api:railway
```

### worker

```env
PERSISTENCE_MODE=database
DATABASE_URL=postgresql://iuf_admin:<secret>@pg.railway.internal:5432/iuf_trading_room
REDIS_URL=redis://cache.railway.internal:6379
DEFAULT_WORKSPACE_SLUG=primary-desk
WORKER_HEARTBEAT_SECONDS=60
OPENALICE_SWEEP_INTERVAL_SECONDS=60
OPENALICE_DEVICE_STALE_SECONDS=21600
OPENALICE_DEFAULT_TIMEOUT_SECONDS=900
OPENALICE_MAX_ATTEMPTS=3
RAILPACK_INSTALL_CMD=pnpm install --frozen-lockfile
RAILPACK_BUILD_CMD=pnpm build:worker
RAILPACK_START_CMD=pnpm start:worker
```

### web

```env
NEXT_PUBLIC_API_BASE_URL=https://api-production-8f08.up.railway.app
NEXT_PUBLIC_DEFAULT_WORKSPACE_SLUG=primary-desk
HOST=0.0.0.0
RAILPACK_INSTALL_CMD=pnpm install --frozen-lockfile
RAILPACK_BUILD_CMD=pnpm build:web
RAILPACK_START_CMD=pnpm start:web
```

## Deployment Order

1. Create the Railway project.
2. Add empty services: `web`, `api`, `worker`.
3. Add Docker image services: `pg` with `postgres:16-alpine`, `cache` with `redis:7-alpine`.
4. Attach a Railway volume to `pg` at `/var/lib/postgresql/data`.
5. Attach a Railway volume to `cache` at `/data`.
6. Set `pg` credentials and application environment variables.
7. Deploy `api` first so migrations run against Postgres.
8. Deploy `worker` after `api` is healthy.
9. Generate a Railway domain for `api`.
10. Set `NEXT_PUBLIC_API_BASE_URL` on `web`.
11. Deploy `web`.

## Verification Checklist

After deploy, verify all of the following:

1. `api` returns `{"status":"ok"}` from `/health`
2. `api` returns a database-backed session from `/api/v1/session`
3. `api` returns an OpenAlice observability snapshot from `/api/v1/openalice/observability`
4. `api` returns the registered device list from `/api/v1/openalice/devices`
5. `worker` logs show `Redis connected (PONG).`
6. `web` returns HTTP `200` from the production URL
7. `pg` and `cache` are both in `SUCCESS` status in Railway

## Important Notes

- `pnpm start:api:railway` runs migrations before the API boots.
- The migration runner uses an advisory lock and tracks applied SQL files in `schema_migrations`, so repeated API deploys are safe.
- `worker` writes a Redis heartbeat key at `iuf:worker:last_heartbeat`.
- `worker` also writes `iuf:openalice:last_sweep` and `iuf:openalice:metrics` into Redis for bridge observability.
- OpenAlice jobs now use lease expiry and retry limits, controlled by `OPENALICE_DEFAULT_TIMEOUT_SECONDS` and `OPENALICE_MAX_ATTEMPTS`.
- `OPENALICE_SWEEP_INTERVAL_SECONDS` and `OPENALICE_DEVICE_STALE_SECONDS` control background maintenance cadence and stale-device reporting on the worker.
- `POST /api/v1/openalice/devices/:deviceId/revoke` and `POST /api/v1/openalice/devices/cleanup` are available for manual remediation of bad or stale devices.
- `TV_WEBHOOK_TOKEN` must be set on `api` before enabling the TradingView webhook.
- `MY_TW_COVERAGE_PATH` is a local-ingest concern and should not be set in Railway.
- Trial resources were enough for `web + api + worker + pg`, but the full stack with `cache` required the `Hobby` upgrade.
- Delete the unused `redis` service in the Railway dashboard when convenient to avoid future confusion.
