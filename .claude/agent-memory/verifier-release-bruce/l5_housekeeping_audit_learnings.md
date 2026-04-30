---
name: L5 Housekeeping Audit Learnings
description: Read-only sweep patterns, SECURITY findings (KGI person_id in evidence JSON), .gitignore proposals, artifact categorization heuristics
type: feedback
---

# L5 Housekeeping Audit Learnings

## SECURITY Finding Pattern
When auditing evidence/ JSON files from live gateway sessions, always grep for:
`person_id.*[A-Z][0-9]{9}|account=\d{7}|broker_id=\d{4}`
The W2a evidence files contain real KGI broker identifiers (person_id=F131331910, account=0308732, broker_id=9204) captured in forensic log lines.
These are in a private repo currently. Risk is low but must be flagged and redacted before any public visibility change.
14 affected files: mostly in evidence/path_b_w2a_20260426/ and evidence/path_b_w3_read_only_2026-04-27/.

## Artifact Categorization Heuristics
- `.tmp_pr*` in repo root = one-shot PR body drafts; DELETE after PR merged
- `scripts/commit_*.txt` = one-shot commit message files; DELETE after merge
- `scripts/pr_body_*.md` = one-shot PR body; DELETE after merge
- `scripts/do_*.bat` and `scripts/w*_git_ops_run.bat` = one-shot Windows ops scripts; DELETE after use
- `apps/web/.codex-web-dev.*` = Codex local dev process state (pid/out/err/log); GITIGNORE never commit
- `tmp_*.html` in repo root = visual inspection snapshots; DELETE
- `*_typecheck_files.txt` in repo root = tsc --listFiles output; one-shot; DELETE
- `secret_inventory.md` = governance doc; KEEP (no live credentials)
- `.claude/agent-memory/` snapshots committed inside evidence/ = stale copies of live memory; DELETE (live copy at .claude/agent-memory/ is authoritative)

## .gitignore Patterns to Propose
```
.tmp_pr*
scripts/commit_*.txt
scripts/pr_body_*.md
scripts/do_*.bat
tmp_*.html
apps/web/.codex-web-dev.*
apps/web/.codex-web-dev-*.log
*_typecheck_files.txt
main_typecheck_files.txt
```

## Glob vs Bash Note
- Glob tool works on Windows Chinese paths correctly
- Bash `ls` on Chinese paths often returns empty (shell encoding issue)
- For file enumeration on this machine: always use Glob, not Bash ls/find

## Audit File Location
`evidence/w7_paper_sprint/l5_housekeeping_audit_2026-04-30.md`

## Reconciliation Findings (2026-04-30 follow-up)

Full reconciliation at: `evidence/w7_paper_sprint/l5_secret_inventory_reconciliation_2026-04-30.md`

Key additions beyond L5 Cat-D:
1. `evidence_content_sprint_2026-04-23/bruce_b1_w1_runtime_verify.md` — NOT in L5 Cat-D but contains <REDACTED:KGI_PERSON_ID> + <REDACTED:KGI_ACCOUNT> + <REDACTED:KGI_BROKER_ID> + plaintext password <REDACTED:KGI_PASSWORD_OLD_ROTATED> in an NSSM command on line 235. P0 redaction priority. [A1+A2 COMPLETE 2026-04-30]
2. `services/kgi-gateway/README.md` — source tree file with live person_id in curl examples. P1.
3. `services/kgi-gateway/schemas.py`, `SCHEMA_MAPPING.md`, `tests/test_health_account_set.py` — account/broker_id as docstring/fixture values. P2.
4. `apps/api/src/broker/broker-port.ts`, `kgi-broker.ts` — JSDoc/comment illustrations. P2.

`secret_inventory.md` is stale (generated 2026-04-24) — tracks 0 of 21 affected files.
KGI broker credential pattern not tracked at all. Update deferred to Cycle 9.

grep patterns for future audits:
- person_id: `F[A-Z0-9]{9}`
- account: `\b0308732\b`  (or generalized: `\b030\d{4}\b`)
- password: `KGI_PERSON_PWD=` or `person_pwd` in non-test files
- broker_id: `\b9204\b`
