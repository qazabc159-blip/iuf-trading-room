# Contributing — IUF Trading Room

## CI path filter

The `CI — Validate` workflow only runs when **code files** change:

```
apps/**   packages/**   tests/**   scripts/**
.github/workflows/**   package.json   pnpm-lock.yaml
turbo.json   tsconfig*.json   .npmrc
```

Pure docs / reports / evidence / design memos do **not** trigger the validate job.
The `CI — Security Baseline` workflow (W6 audit + secret regression) runs on **all PRs** regardless.

## [skip ci] convention

For commits that are purely operational notes, status updates, or evidence files and do not change any code path, add `[skip ci]` to the commit message:

```
chore: update reports/evidence/sprint_closeout_2026_05_17.md [skip ci]
```

GHA natively honors `[skip ci]` and `[ci skip]` — the entire workflow run is skipped.

Use `[skip ci]` for:
- `reports/**` evidence bundles
- `reports/memos/**` design notes
- `reports/codex_notes/**` agent notes
- Status / handoff markdown files

Do **not** use `[skip ci]` if the commit includes any change to `apps/`, `packages/`, `tests/`, or `scripts/`.
