# Railway Deployment

This repo is set up for a `Railway-first` topology:

- `web`: Next.js control tower
- `api`: Hono API
- `worker`: long-running background worker
- `Postgres`: managed Railway PostgreSQL
- `Redis`: managed Railway Redis

## Service Layout

Create one Railway project with five services:

1. `web`
2. `api`
3. `worker`
4. `Postgres`
5. `Redis`

Use the same GitHub repo for `web`, `api`, and `worker`.

## Build and Start Commands

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

## Variables

### Shared defaults

Set these once unless you need a different workspace slug:

```env
DEFAULT_WORKSPACE_SLUG=primary-desk
NEXT_PUBLIC_DEFAULT_WORKSPACE_SLUG=primary-desk
```

### API service

```env
PERSISTENCE_MODE=database
DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}
DEFAULT_WORKSPACE_SLUG=primary-desk
```

### Worker service

```env
PERSISTENCE_MODE=database
DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}
DEFAULT_WORKSPACE_SLUG=primary-desk
WORKER_HEARTBEAT_SECONDS=60
```

### Web service

```env
NEXT_PUBLIC_API_BASE_URL=https://<your-api-domain>
NEXT_PUBLIC_DEFAULT_WORKSPACE_SLUG=primary-desk
```

The web app currently calls the API directly from the browser, so `api` needs a public domain.

## Deployment Order

1. Create the Railway project.
2. Add `Postgres` and `Redis`.
3. Add `api`, `worker`, and `web` from GitHub.
4. Set the service variables.
5. Assign a public domain to `api`.
6. Set `NEXT_PUBLIC_API_BASE_URL` on `web` to that domain.
7. Deploy `api` first so migrations can run.
8. Deploy `worker`.
9. Deploy `web`.

## Notes

- The migration runner uses an advisory lock and tracks applied SQL files in `schema_migrations`, so repeated API deploys are safe.
- `worker` is intentionally long-running and writes a Redis heartbeat at `iuf:worker:last_heartbeat` when `REDIS_URL` is configured.
- `MY_TW_COVERAGE_PATH` is a local-ingest concern and is not expected on Railway.
