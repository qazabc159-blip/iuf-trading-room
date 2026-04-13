# IUF Trading Room App

Wave 0 scaffold for the IUF Trading Room website.

## Workspace Apps

- `apps/web`: Next.js control tower UI
- `apps/api`: Hono API service
- `apps/worker`: background jobs and automation runner

## Shared Packages

- `packages/contracts`: shared schemas and API contracts
- `packages/db`: PostgreSQL schema definitions
- `packages/domain`: domain services and mock repository
- `packages/auth`: role and workspace auth helpers
- `packages/ui`: shared UI constants and primitives

## Quick Start

```bash
pnpm install
pnpm dev
```

Default local ports:

- web: `http://localhost:3000`
- api: `http://localhost:3001`

## Railway Service Commands

Use the repo root as the source directory for all Railway services, then set:

- `web` build command: `pnpm build:web`
- `web` start command: `pnpm start:web`
- `api` build command: `pnpm build:api`
- `api` start command: `pnpm start:api:railway`
- `worker` build command: `pnpm build:worker`
- `worker` start command: `pnpm start:worker`

`pnpm start:api:railway` runs migrations before booting the API.

See [RAILWAY_DEPLOYMENT.md](./RAILWAY_DEPLOYMENT.md) for the full setup checklist.
