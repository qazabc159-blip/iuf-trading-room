# JASON_DISCOVER_2026-05-15

## Task
Buzzword → company 3-layer fallback discovery endpoint.
Port My-TW-Coverage/scripts/discover.py reverse-search logic to IUF backend.

## New Files
- `apps/api/src/data-sources/discover.ts` — core 3-layer logic
- `apps/api/src/data-sources/__tests__/discover.test.ts` — DISC1–DISC4

## Modified Files
- `apps/api/src/data-sources/tw-coverage-loader.ts` — added `getAllWikilinks()` + `_resetWikilinkCache()`
- `apps/api/src/server.ts` — added `GET /api/v1/discover?q=...` endpoint

## Implementation

### Layer 1 — Exact match
`findCompaniesByWikilink(buzzword)` — confidence 1.0, matchStrategy: 'exact'

### Layer 2 — Fuzzy match
Levenshtein distance + substring overlap vs. all known wikilinks (from `getAllWikilinks()`).
Default threshold 0.7. Top 5 fuzzy candidates each resolved via exact lookup.
matchStrategy: 'fuzzy'

### Layer 3 — LLM inference
gpt-4o-mini (MODEL_ROUTINE) infers 3–5 related wikilinks from sample of known tokens.
In-process rate limit: max 5 calls/min.
Each inferred wikilink resolved via exact lookup.
matchStrategy: 'llm_inference'

### Endpoint
`GET /api/v1/discover?q=<buzzword>[&fuzzyThreshold=0.7][&llmFallback=true|false]`
- Owner-only auth (403 if not Owner)
- Per-user 30/min rate limit (429 if exceeded)
- Returns DiscoverResult JSON

## Build / Test
- `api build`: GREEN (no TS errors)
- DISC1: exact match CoWoS → 10+ tickers PASS
- DISC2: fuzzy match 液冷 → finds related companies PASS
- DISC3: impossible term → no_match PASS
- DISC4: LLM mock confirms prompt shape + model PASS

## Lane Boundary
- No contracts changes
- No risk/broker/frontend files touched
- No real OpenAI in tests (global.fetch mocked)
- No DB writes

## Branch
feat/api-discover-buzzword-2026-05-15
