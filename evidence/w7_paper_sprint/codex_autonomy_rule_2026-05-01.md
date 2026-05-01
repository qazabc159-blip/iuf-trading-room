# Codex Autonomy Rule - 2026-05-01

Owner direction:

- Codex has standing approval to execute safe, non-destructive project work without asking operator yes/no.
- Codex should not stop the lane for routine sandbox/tool confirmations. Use available permissions and proceed.
- For frontend real-data / no-fake UI work, Codex should decide, edit, test, update the board, commit, and push when checks pass.
- If blocked, Codex should document the blocker and immediately move to the next safe task instead of waiting idle.

## Lane Scope

Default autonomous write lane:

- `apps/web/**`
- frontend evidence under `evidence/w7_paper_sprint/**`

Codex must not use "non-destructive" as a reason to directly edit these paths unless the operator or Elva explicitly opens that lane:

- `packages/db/**`
- `apps/api/**`
- `services/kgi-gateway/**`
- `scripts/**`
- `.github/**`

Hard stop-lines remain:

- No live order submit enablement.
- No migration 0020 promotion or destructive DB action.
- No Railway secret changes or secret disclosure.
- No broker/KGI SDK write-side changes.
- No force-push or destructive git cleanup.

Operational rule:

- Every active cycle must produce one of: pushed commit, board update, or explicit blocker plus next-task pivot.
- Lack of operator confirmation is not a blocker for in-scope non-destructive work.
- A board update must include: timestamp, current action in one sentence, and next step in one sentence.
- A blocker note must include: owner, exact blocker, and a safe bypass/next task. "Blocked" alone is not a valid heartbeat.
- B-series blocker numbering must follow Bruce's 4-state harness when that harness is the cited verification source. Codex-local labels must be marked as local until reconciled.
