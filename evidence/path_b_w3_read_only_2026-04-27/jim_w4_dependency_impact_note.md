# W4 Frontend Cutover — Dependency Impact Note

**Date**: 2026-04-28 (overnight augment)
**Branch**: `feat/w4-frontend-cutover`
**PR**: #8 (DRAFT)

---

## §1 New Deps Added (versions + why)

| Package | Version | Why | Used by |
|---------|---------|-----|---------|
| `lightweight-charts` | `^5.2.0` | K-line chart rendering — no React dep, zero-config canvas-based | `apps/web/components/chart/KLineChart.tsx` |
| `@radix-ui/react-dialog` | `^1.1.15` | Accessible modal primitive — used by RightInspector sheet | `apps/web/components/RightInspector.tsx` |
| `cmdk` | `^1.1.1` | Command menu primitive — CommandPalette base | `apps/web/components/command-palette.tsx` |
| `clsx` | `^2.1.1` | Classname utility | `apps/web/components/command-palette.tsx` |
| `class-variance-authority` | `^0.7.1` | Variant styling utility | `apps/web/components/RightInspector.tsx` |
| `tailwind-merge` | `^3.5.0` | Tailwind class merge utility | `apps/web/components/command-palette.tsx` |

**Total new runtime deps**: 6

**Rationale for `lightweight-charts` over alternatives**:
- Tremor was evaluated and rejected (Tailwind v3/v4 conflict + ~30 kB overhead for simple sparklines)
- `@visx` packages were installed but not used yet (future heatmap/xychart scope)
- `lightweight-charts` v5 is MIT, 0 peer deps, canvas-based (no SSR issue with `"use client"`)

**Note**: `@radix-ui/react-dialog`, `cmdk`, `clsx`, `class-variance-authority`, `tailwind-merge` may have been pre-installed in `node_modules` from other sources (e.g., shared UI package or previous experiment). Explicitly declaring them in `package.json` ensures reproducible installs.

---

## §2 Removed Deps

None removed. This PR is additive only.

---

## §3 Lockfile Diff Summary

**`pnpm-lock.yaml` net changes** (estimated — working tree diff, not audited line by line):
- Additions: ~40-80 lockfile entries for the 6 new packages + their transitive deps
- Removals: 0
- Net: additive only

Key transitive deps added by `lightweight-charts`:
- No additional transitive deps (zero-dep package)

Key transitive deps added by `@radix-ui/react-dialog`:
- `@radix-ui/react-dialog` pulls in `@radix-ui/react-*` primitives (compose, context, dismissable-layer, etc.)

Key transitive deps added by `cmdk`:
- `cmdk` v1 depends on `@radix-ui/react-dialog` (overlaps with above)

---

## §4 Bundle Size Delta Estimate

**From `web_build.txt` (run with all deps installed)**:

| Route | Size | First Load JS |
|-------|------|--------------|
| `/` (dashboard) | 2.65 kB | 116 kB |
| `/companies` | 6.5 kB | 119 kB |
| `/companies/[symbol]` | (dynamic, ƒ) | N/A in static manifest |
| `/portfolio` | 19.2 kB | 132 kB |
| `/runs/[id]` | 7.71 kB | 121 kB |

**Shared chunks**: 102 kB first-load JS shared by all

**Before W4 (estimated baseline from W2d `web_build.txt`)**: ~102 kB shared, similar per-route sizes

**`lightweight-charts` size contribution** (gzip estimate):
- `lightweight-charts` v5 standalone: ~90 kB uncompressed, ~30 kB gzip
- This appears only in routes that import `KLineChart.tsx` — primarily `/companies/[symbol]`
- Shared chunk does NOT include `lightweight-charts` (it's only dynamically split on demand)

**Delta flag — WARNING**: `/companies/[symbol]` first-load JS will include `lightweight-charts` (~30 kB gzip). This is **above +50 kB uncompressed threshold** but below +50 kB gzip threshold. Flagged for awareness.

**`cmdk` + `@radix-ui` contribution**: ~15-20 kB gzip total, shared across pages that import CommandPalette

---

## §5 Breaking Changes Risk: LOW

**Assessment: LOW**

Rationale:
- All new deps are additive (no removals)
- `lightweight-charts` v5 has no breaking API vs v4 for our canvas usage
- `@radix-ui/react-dialog` v1.1.x is stable API
- No peer dep conflicts detected (React 19 compatible)
- `pnpm-lock.yaml` pinned versions prevent drift
- No existing code paths changed — new deps only appear in new files

**Risk item**: `cmdk` v1 changed API vs v0 (`CommandInput`, `CommandList`, etc.) — our implementation uses v1 API, so no regression risk. If any existing code used cmdk v0, it would conflict. Search confirms no existing cmdk v0 usage on main.
