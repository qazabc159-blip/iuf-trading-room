# CODEX_COMPANY_COVERAGE_PROXY_2026-05-15

Cycle: 2026-05-15 19:18 TST
Branch: `fix/web-company-coverage-proxy-2026-05-15`
Worktree: `IUF_TRADING_ROOM_APP_company_coverage_proxy_worktree`

## Scope

Frontend-only fix for company page My-TW-Coverage wiring.

The company detail `CoverageSection` already fetches same-origin:

- `/api/v1/companies/:ticker/coverage`
- `/api/v1/themes/:token/companies`

but the web app had no same-origin routes for those paths. In split web/API deployments, the accordion could show `此公司尚無深度研究資料` even when backend coverage data existed.

## Shipped locally

Added web proxy routes:

- `apps/web/app/api/v1/companies/[ticker]/coverage/route.ts`
- `apps/web/app/api/v1/themes/[token]/companies/route.ts`

Both proxy to `${NEXT_PUBLIC_API_BASE_URL}/api/v1/...`, forward `Cookie` and `x-workspace-slug`, and use no-store headers. No mock data is generated.

## Verification

Dependency setup in the clean worktree:

```powershell
pnpm.cmd install --frozen-lockfile --prefer-offline
pnpm.cmd --filter @iuf-trading-room/contracts build
```

Typecheck:

```powershell
pnpm.cmd --filter @iuf-trading-room/web typecheck
```

Result: PASS.

Local proxy smoke:

- Fake backend: `http://127.0.0.1:3045`
- Web dev: `http://127.0.0.1:3046`
- `NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:3045`

| Path | Status | Result |
| --- | ---: | --- |
| `/api/v1/companies/2330/coverage` | 200 | proxied coverage payload containing `foundry coverage smoke` |
| `/api/v1/themes/AI/companies` | 200 | proxied peer payload containing `聯電` |
| `/api/v1/themes/%E5%8D%8A%E5%B0%8E%E9%AB%94/companies` | 200 | unicode token path proxied peer payload containing `聯電` |

## Safety

- No `apps/api` changes.
- No broker/risk/contracts changes.
- No KGI live write path.
- No real-order or `PAPER_LIVE` promotion.
- Company detail still does not import or render `PaperOrderPanel`; trading remains in `交易室`.

## Release status

Patch is prepared locally on a clean branch.

Not pushed/opened yet because GitHub Actions is still failing at the repo/account billing or spending-limit gate.
