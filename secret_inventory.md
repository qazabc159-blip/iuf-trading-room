# Secret Inventory — IUF Trading Room
Generated: 2026-04-24
Last updated: 2026-04-30 (A2 redaction round)

## Local .env Files

| Key | Location | Owner | Rotation Status | Notes |
|-----|----------|-------|-----------------|-------|
| *(no local .env found)* | — | — | — | Only `.env.example` exists in repo root; no actual `.env` file present |

### Keys defined in `.env.example` (template only, no real values):
| Key | Location | Owner | Rotation Status | Notes |
|-----|----------|-------|-----------------|-------|
| NEXT_PUBLIC_API_BASE_URL | .env.example | Platform | N/A (template) | Public URL, not a secret |
| NEXT_PUBLIC_DEFAULT_WORKSPACE_SLUG | .env.example | Platform | N/A (template) | Public config, not a secret |
| DATABASE_URL | .env.example | Platform/Railway | Needs rotation policy | Contains DB credentials |
| PERSISTENCE_MODE | .env.example | Platform | N/A | Toggle value only |
| DEFAULT_WORKSPACE_SLUG | .env.example | Platform | N/A (template) | Not a secret |
| REDIS_URL | .env.example | Platform/Railway | Needs rotation policy | Contains Redis credentials |
| WORKER_HEARTBEAT_SECONDS | .env.example | Platform | N/A | Numeric config |
| OPENALICE_SWEEP_INTERVAL_SECONDS | .env.example | Platform | N/A | Numeric config |
| OPENALICE_DEVICE_STALE_SECONDS | .env.example | Platform | N/A | Numeric config |
| TV_WEBHOOK_TOKEN | .env.example | TradingView/楊董 | Should rotate every 90 days | TradingView webhook shared secret |
| TV_WEBHOOK_DEDUP_TTL_SECONDS | .env.example | Platform | N/A | Numeric config |
| TV_WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS | .env.example | Platform | N/A | Numeric config |
| TV_WEBHOOK_RATE_LIMIT_PER_MINUTE | .env.example | Platform | N/A | Numeric config |
| TV_WEBHOOK_ENFORCE_TIMESTAMP | .env.example | Platform | N/A | Boolean flag |
| OPENALICE_DEFAULT_TIMEOUT_SECONDS | .env.example | Platform | N/A | Numeric config |
| OPENALICE_MAX_ATTEMPTS | .env.example | Platform | N/A | Numeric config |

## GitHub Actions Secrets

| Key | Location | Owner | Rotation Status | Notes |
|-----|----------|-------|-----------------|-------|
| RAILWAY_TOKEN | .github/workflows/deploy.yml | 楊董/DevOps | Needs rotation policy | Used in deploy job; project-scoped Railway token |

Source: `grep -r "secrets\." .github/workflows/*.yml`
Result: Only `secrets.RAILWAY_TOKEN` found across all 3 workflow files (ci.yml, deploy.yml, execution-live-verify.yml).

## Railway Environment Variables (via inference)

Railway env vars are set in Railway dashboard (not stored in repo). Based on `.env.example` template, the following are expected to be set in Railway:

| Key | Expected Location | Owner | Rotation Status | Notes |
|-----|----------|-------|-----------------|-------|
| DATABASE_URL | Railway → api/worker service | Railway auto-provisioned | Managed by Railway | Postgres plugin URL |
| REDIS_URL | Railway → worker service | Railway auto-provisioned | Managed by Railway | Redis plugin URL |
| PERSISTENCE_MODE | Railway → api/worker | 楊董 | N/A | Should be "database" in prod |
| TV_WEBHOOK_TOKEN | Railway → api | 楊董 | Should rotate every 90 days | Must match TradingView alert config |
| DEFAULT_WORKSPACE_SLUG | Railway → api | 楊董 | N/A | Not a secret |
| NEXT_PUBLIC_API_BASE_URL | Railway → web | 楊董 | N/A on URL change | Public API base URL |

> Note: Railway env vars cannot be enumerated programmatically without Railway CLI authenticated session. This list is derived from `.env.example` + `server.ts` env var reads. To get exact live list, run: `railway variables --service api` (requires RAILWAY_TOKEN auth).

---

## KGI Broker Credentials — A2 Redaction Status (2026-04-30)

### KGI Password

| Item | Status | Notes |
|------|--------|-------|
| `KGI_PERSON_PWD` — old value | ROTATED | Rotated by 楊董 2026-04-30 (A1). Old value: `<REDACTED:KGI_PASSWORD_OLD_ROTATED>`. New value is local-only on Windows Market Agent Host (Windows Credential Manager / DPAPI / `KGI_PERSON_PWD` env). |
| Old password in git working tree | REDACTED | `evidence_content_sprint_2026-04-23/bruce_b1_w1_runtime_verify.md` line 235 — replaced with `<REDACTED:KGI_PASSWORD_OLD_ROTATED>` by A2. |
| Old password in git history | COMPROMISED (history exposure) | Remains in past commits on `origin`. Rotate-only approach in effect (Option A). See `evidence/w7_paper_sprint/history_exposure_note.md`. |

### KGI Person ID (`KGI_PERSON_ID`)

| Item | Status | Notes |
|------|--------|-------|
| Live value in evidence files (14 files) | REDACTED | All 14 L5 Cat-D evidence files have person_id replaced with `<REDACTED:KGI_PERSON_ID>`. |
| Live value in source tree | REDACTED | `services/kgi-gateway/README.md` curl examples now use `YOUR_PERSON_ID`. `apps/api/src/broker/broker-port.ts` JSDoc now uses `YOUR_PERSON_ID`. |
| Value in per-agent memory files | ACCEPTABLE | Memory files reference the identifier as an audit finding, not an operational credential. |
| Git history exposure | COMPROMISED (history exposure) | Appears in past commits. Rotate-only approach covers this (person_id is not a password). |

### KGI Account Number

| Item | Status | Notes |
|------|--------|-------|
| Live value in evidence files (14 files) | REDACTED | Replaced with `<REDACTED:KGI_ACCOUNT>` across all L5 Cat-D evidence files. |
| Live value in source tree (`README.md`, `schemas.py`, `SCHEMA_MAPPING.md`) | REDACTED | Replaced with `YOUR_ACCOUNT` placeholder. |
| Live value in test fixture (`tests/test_health_account_set.py`) | REDACTED | Replaced with `TEST_ACCT_SENTINEL`. |
| Live value in `apps/api/src/broker/broker-port.ts` | REDACTED | JSDoc replaced with `YOUR_ACCOUNT`. |
| Live value in `apps/api/src/broker/kgi-broker.ts` | REDACTED | Comment replaced with `YOUR_ACCOUNT`. |

### KGI Broker ID

| Item | Status | Notes |
|------|--------|-------|
| Live value in evidence files | REDACTED | Replaced with `<REDACTED:KGI_BROKER_ID>` across evidence files. |
| Live value in source tree (`README.md`, `schemas.py`, `SCHEMA_MAPPING.md`) | REDACTED | Replaced with `YOUR_BROKER_ID` placeholder. |
| Live value in `apps/api/src/broker/broker-port.ts` | REDACTED | JSDoc replaced with `YOUR_BROKER_ID`. |

### Files Covered by A2 Redaction

| # | File | Identifiers Redacted | Status |
|---|------|---------------------|--------|
| 1 | `evidence_content_sprint_2026-04-23/bruce_b1_w1_runtime_verify.md` | person_id, password, account, broker_id | REDACTED 2026-04-30 |
| 2 | `evidence/path_b_w2a_20260426/read_side_live.json` | person_id, account, broker_id | REDACTED 2026-04-30 |
| 3 | `evidence/path_b_w2a_20260426/read_side_live_crash.json` | account, broker_id | REDACTED 2026-04-30 |
| 4 | `evidence/path_b_w2a_20260426/bruce_verify_candidate_f_live_20260427T031621.json` | person_id (note field) | REDACTED 2026-04-30 |
| 5 | `evidence/path_b_w2a_20260426/bruce_verify_pr3_health_note_20260427T053421.json` | account (detail + flag fields) | REDACTED 2026-04-30 |
| 6 | `evidence/path_b_w2a_20260426/post_merge_w2b_regression_20260427T050725.json` | account, person_id (audit section) | REDACTED 2026-04-30 |
| 7 | `evidence/path_b_w2a_20260426/health_account_set_diagnosis.md` | account | REDACTED 2026-04-30 |
| 8 | `evidence/path_b_w2a_20260426/step3a_blocked_gateway_missing_routes_2026-04-27.md` | account, broker_id | REDACTED 2026-04-30 |
| 9 | `evidence/path_b_w2a_20260426/post_merge_w2b_regression_report.md` | account, person_id, broker_id | REDACTED 2026-04-30 |
| 10 | `evidence/path_b_w2a_20260426/bruce_verify_pr3_health_note_summary.md` | account | REDACTED 2026-04-30 |
| 11 | `evidence/path_b_w3_read_only_2026-04-27/bruce_w4_lane4_phase2_audit.md` | account (reference text) | REDACTED 2026-04-30 |
| 12 | `evidence/path_b_w3_read_only_2026-04-27/bruce_w4_overnight_drift_audit.md` | account, broker_id (audit text) | REDACTED 2026-04-30 |
| 13 | `evidence/path_b_w3_read_only_2026-04-27/bruce_w5b_verify_closeout.md` | account (forbidden pattern list) | REDACTED 2026-04-30 |
| 14 | `evidence/path_b_w3_read_only_2026-04-27/kgi_escalation_w5b_final_polish.md` | account (redaction check table) | REDACTED 2026-04-30 |
| 15 | `services/kgi-gateway/README.md` | person_id, account, broker_id | REDACTED 2026-04-30 |
| 16 | `services/kgi-gateway/schemas.py` | account, broker_id | REDACTED 2026-04-30 |
| 17 | `services/kgi-gateway/SCHEMA_MAPPING.md` | account, broker_id | REDACTED 2026-04-30 |
| 18 | `services/kgi-gateway/tests/test_health_account_set.py` | account (test fixture) | REDACTED 2026-04-30 |
| 19 | `apps/api/src/broker/broker-port.ts` | person_id, account, broker_id | REDACTED 2026-04-30 |
| 20 | `apps/api/src/broker/kgi-broker.ts` | account | REDACTED 2026-04-30 |

---

## Anti-Regression

A Python regression check script has been added at `scripts/audit/secret_regression_check.py`.
It is wired into `.github/workflows/ci.yml` as job `secret_regression`.

Run locally: `python scripts/audit/secret_regression_check.py`

---

## Summary

- Real secrets requiring rotation policy: `DATABASE_URL`, `REDIS_URL`, `TV_WEBHOOK_TOKEN`, `RAILWAY_TOKEN`
- KGI password: ROTATED (A1) + REDACTED in working tree (A2). History exposure remains (rotate-only).
- KGI person_id / account / broker_id: REDACTED across 20 files (A2 complete).
- No `.env` file committed to repo (correct)
- No live secrets hardcoded in source files after A2 (verified by A2 redaction + regression check)
