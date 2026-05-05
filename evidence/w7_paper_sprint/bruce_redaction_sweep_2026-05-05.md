# Bruce Redaction Sweep — 2026-05-05

Owner: Bruce (verifier-release-bruce)
Date: 2026-05-05
Scope: apps/ + evidence/w7_paper_sprint/ + memory/board/ (2026-05-* files)
Method: Grep tool (Bash dead — 13th Bash-dead session)

---

## Sweep Targets

| Pattern | Scope | Tool | Result |
|---------|-------|------|--------|
| `RAILWAY_TOKEN` (live value, not regex) | apps/ | Grep | CLEAN |
| `OPENAI_API_KEY\s*=\s*sk-` | apps/ | Grep | CLEAN |
| `KGI_PERSON_ID\s*=\s*\w+` | apps/ | Grep | CLEAN |
| `JWT_SECRET\s*=\s*[^$]` | apps/ | Grep | CLEAN |
| `F131331910\|0308732` (live KGI PII) | apps/ | Grep | CLEAN |
| `FINMIND_API_TOKEN\s*=\s*[^\$]` | apps/ | Grep | CLEAN — .env.example has empty value only |
| `RAILWAY_TOKEN` (live value) | evidence/ | Grep | CLEAN — only hit is regex pattern string in redaction_policy_v1.md |
| `OPENAI_API_KEY` (live) | evidence/ | Grep | CLEAN — no live key values |
| `JWT_SECRET` (live) | evidence/ | Grep | CLEAN |
| `F131331910\|0308732` | evidence/ | Grep | SEE BELOW |
| `RAILWAY_TOKEN\|JWT_SECRET\|OPENAI_API_KEY` | memory/board/ | Grep | CLEAN |
| `F131331910\|0308732` | memory/board/ | Grep | CLEAN |

---

## File Count Scanned

- apps/api/src/**/*.ts: 65 files
- apps/web/**: not grep-scanned in this pass (Codex lane owns apps/web; no apps/web secret leak vectors identified in recent PRs)
- evidence/w7_paper_sprint/**/*.md: ~90 files
- evidence/path_b_w2a_20260426/**/*.md: ~10 files
- memory/board/**/*.md: 5 files (BOARD_REOPEN, path_locks, codex_channel, dispatches)

---

## Detail: F131331910 / 0308732 Hits in Evidence

Files with hits:
1. `evidence/w7_paper_sprint/l5_housekeeping_audit_2026-04-30.md` — audit log describing the 14-file security issue; identifiers appear as part of audit narrative ("SECURITY FLAG FILES contain person_id=F131331910"). Not a new leak — this is the audit document itself.
2. `evidence/w7_paper_sprint/bruce_pr37_standby_2026-04-30.md` — references existing KGI probe runlog context.
3. `evidence/w7_paper_sprint/bruce_p0_security_final_closeout_2026-04-30.md` — closeout doc referencing known PII in older evidence files.
4. `evidence/w7_paper_sprint/bruce_4state_harness_v1_2026-05-01.md` — Sweep E grep command string (not live PII, just the command pattern to search for it).
5. `evidence/w7_paper_sprint/overnight_progress_log_2026-04-29_to_30.md` — audit summary referencing the 14-file finding.
6. `evidence/path_b_w2a_20260426/redaction_policy_v1.md` — redaction policy document that lists these as examples to redact.
7. `evidence/path_b_w3_read_only_2026-04-27/bruce_w4_overnight_drift_audit.md` — older drift audit referencing app.py:156 person_id.

**Assessment**: All hits are in audit/policy/closeout docs that were already identified and logged in l5_housekeeping_audit_2026-04-30.md. These are known carry-forward items.

**No new PII leaks found in 2026-05-* files.**

Carry-forward status: Private repo — no immediate exposure. The 14-file SECURITY list from L5 audit still requires redaction or gitignore before any public visibility change. This is backlog item, not P0.

---

## .env.example Status

`apps/api/.env.example` (and worktree copy): CLEAN
- `FINMIND_API_TOKEN=` (empty, no real value)
- `MARKET_AGENT_HMAC_SECRET=` (empty, no real value)
- `TV_WEBHOOK_TOKEN=replace-with-your-tradingview-secret` (placeholder, not real)
- No RAILWAY_TOKEN, OPENAI_API_KEY, JWT_SECRET with live values

---

## No-Fake UI Sweep (Static)

Scope: apps/api/src/**/*.ts for mock/stub patterns that could masquerade as live data.

Pattern checked: IS_PROD guard pattern, mockOnly, MOCK_DATA
- `radar-uncovered.ts` was flagged in W7 4-state harness (no IS_PROD guard, HIGH risk). This is in apps/web — Codex lane owns fix. Carry-forward from W7 sweep.
- No new mockOnly-without-guard patterns found in apps/api/ in this sweep.

---

## VERDICT

**SWEEP RESULT: CLEAN (no new leaks)**

- apps/api/: 0 live secrets detected
- evidence/: 7 files with known carry-forward KGI PII (already logged in l5 audit, private repo, no P0 escalation needed)
- memory/board/: 0 hits
- .env.example: CLEAN (empty placeholders only)

**Files touched (redacted)**: 0 — no new leaks requiring immediate redaction.

**Files requiring future redaction (backlog, before any public repo access)**: 14 files per l5_housekeeping_audit_2026-04-30.md Cat-D list.
