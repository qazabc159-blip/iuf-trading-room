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
