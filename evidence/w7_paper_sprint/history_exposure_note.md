---
title: Git History Exposure Note — A2 Credential Redaction
date: 2026-04-30
author: Bruce (verifier-release)
---

# Git History Exposure Note

## Status

`history_exposure_remains: yes`
`recommendation: rotate-only (current state — A1 complete)`

## What happened

The old KGI password (`<REDACTED:KGI_PASSWORD_OLD_ROTATED>`, rotated 2026-04-30 via A1) appeared in plaintext
at `evidence_content_sprint_2026-04-23/bruce_b1_w1_runtime_verify.md` line 235 in
an NSSM startup command example. This file was committed to the git repository.

A2 redaction has replaced the value with `<REDACTED:KGI_PASSWORD_OLD_ROTATED>` in
the working tree and on the PR branch. However, the original value remains accessible
in past git commits on `origin`.

## Two options

### Option A: Rotate-only (RECOMMENDED — current state)

- Old password was rotated by 楊董 on 2026-04-30 (A1 complete).
- The password in git history is therefore stale and provides no access.
- A2 redaction removes it from the working tree HEAD.
- No history rewrite is needed as long as:
  1. New password never enters the repo
  2. Old password is not used anywhere
  3. Repo remains private

Risk level with option A: LOW (private repo + rotated credential).

### Option B: History rewrite via BFG / git-filter-repo (NOT auto-executed)

BFG Repo Cleaner or `git-filter-repo` can permanently remove the old password from
all git commits, rewriting history. This would require:

1. All collaborators to re-clone or force-reset their local copies
2. A force push to `origin/main` (protected branch — requires explicit 楊董 auth)
3. GitHub Actions cache invalidation (runner caches may hold old refs)
4. Coordination with Railway if Railway has its own git integration

Steps for Option B (for operator execution only — not auto-run by Bruce):

```bash
# Using git-filter-repo (pip install git-filter-repo)
git filter-repo --replace-text <(echo "<KGI_PASSWORD_OLD_ROTATED>==>REDACTED_KGI_PASSWORD_OLD_ROTATED")

# Or using BFG:
# bfg --replace-text passwords.txt
# where passwords.txt contains the old password (local only — do NOT commit passwords.txt)

# After rewrite:
git push origin main --force  # requires protected branch override
```

## Current decision

楊董 ACK A1 (rotate) + A2 (redact working tree). History rewrite is NOT authorized
in the A1/A2 scope. Option A (rotate-only) is in effect.

If 楊董 later decides to execute Option B, the command sequence above is the correct
approach. Bruce will not auto-execute force push or history rewrite without explicit
directive.
