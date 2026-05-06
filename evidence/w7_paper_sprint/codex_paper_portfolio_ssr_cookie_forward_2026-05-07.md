# Codex Paper Portfolio SSR Cookie Forward - 2026-05-07

Status: READY FOR PR
Branch: `fix-web-paper-portfolio-ssr-cookie-2026-05-07`
Trade Capability Score: `+1`

## Why This Exists

`/portfolio` is a server-rendered page, but `apps/web/lib/paper-orders-api.ts` did not forward the incoming browser `Cookie` header when SSR fetched paper endpoints. A logged-in operator could therefore see paper portfolio/fills as blocked or empty because the API request looked unauthenticated server-side.

## Files

- `apps/web/lib/paper-orders-api.ts`

## Endpoint / Source List

- `GET /api/v1/paper/portfolio`
- `GET /api/v1/paper/fills`
- `GET /api/v1/paper/orders`
- `GET /api/v1/paper/health`
- `POST /api/v1/paper/preview`
- existing paper submit/cancel wrappers keep the same route behavior and now also forward SSR cookies if ever called server-side.

## Behavior

- Adds `ssrCookieHeader()` using `next/headers` only on the server.
- For server-side paper API calls, forwards `Cookie` to the API together with `x-workspace-slug`.
- Client-side behavior remains unchanged: browser credentials still use `credentials: "include"`.
- No endpoint, route, schema, or order behavior changed.

## Trade Workflow Impact

- Paper portfolio page can authenticate SSR API calls and show real paper positions/fills/readiness instead of false login-expired or empty states.
- Company page paper preview flow and portfolio readout are less likely to become disconnected after login.

## Checks

- `pnpm.cmd --filter @iuf-trading-room/web typecheck` - PASS
- `pnpm.cmd --filter @iuf-trading-room/web build` - PASS
- `git diff --check` - PASS with CRLF warning only
- Stop-line grep - PASS

## Stop-Line Proof

- No token value in UI, logs, or evidence.
- No `/order/create`.
- No KGI SDK / broker write-side touched.
- No backend schema, migration, or destructive DB action.
- No fake positions or fake fills added.
- No paper/live gate relaxed.
- No FinMind/K-line fill-price use.
