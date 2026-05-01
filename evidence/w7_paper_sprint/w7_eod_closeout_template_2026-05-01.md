# W7 Paper Sprint — Daily EOD Closeout Template (P1-12)

**Author:** Elva (orchestrator)
**Date:** 2026-05-01 18:43 TST
**Sprint:** W7 paper sprint (2026-04-30 → 2026-05-09)
**Purpose:** Standardize the EOD closeout document so 楊董 can read 5 days of progress in **3 minutes flat** without ambiguity. Replaces the ad-hoc closeout style we've been using.
**Cadence:** Filed every day at 21:00 TST (or sooner if all 4 lanes wrap before market close + admin window).

---

## §1 Why this template exists

W7 has 10 days, 4 active lanes (Codex / Jason / Bruce / Elva), 2 reviewers (Mike / Pete), 1 demo target. Without a standardized EOD format:
- 楊董 has to read 4 different agent diaries to understand the day
- Yellow events get buried in walls of text
- "Where are we vs the demo?" requires re-reading all the contract specs
- Postpone vs proceed decisions get fuzzy

This template forces every EOD into an **8-section structure** that maps 1:1 to the demo readiness questions.

---

## §2 Filename convention

`evidence/w7_paper_sprint/eod/w7_eod_YYYY-MM-DD.md`

Always **today's date** in TST. Example: `evidence/w7_paper_sprint/eod/w7_eod_2026-05-01.md`.

If we miss a day (no progress, idle), still file the doc — write `IDLE` in §3 and explain why in §6.

---

## §3 The 8-section template

Copy this exact skeleton each day. Replace bracketed values.

```markdown
# W7 EOD Closeout — [YYYY-MM-DD]

**Author:** Elva
**Sprint day:** [N of 10]
**Time filed:** [HH:MM TST]
**Demo countdown:** [X days Y hours to 5/4 09:00]
**Sprint countdown:** [X days to 5/9 EOD]
**Posture:** GREEN | YELLOW | RED

---

## 1. One-line headline
[≤ 25 字, 一句說今天最重要的事 — 是 demo readiness 翻紅還是 Codex 又落地一個 contract？]

## 2. What shipped today (committed to main)
| Time | Commit | What | Owner |
|---|---|---|---|
| [HH:MM] | `abc1234` | feat(web): X | Codex |
| [HH:MM] | `def5678` | docs(w7): Y design | Elva |
| ... | ... | ... | ... |

If 0 commits: write `(no commits today — idle / blocked / weekend pause)` and explain in §6.

## 3. Demo readiness vs 5/4 09:00
4 columns (D-3 / D-2 / D-1 / D-day) per item:

| Item | D-3 (5/1) | D-2 (5/2) | D-1 (5/3) | D-day (5/4) |
|---|---|---|---|---|
| Contract 1 paper submit (W6 done) | ✓ | ✓ | ✓ | ✓ |
| Contract 2 portfolio risk read | ✓ impl `13ca56a` | | | |
| Contract 3 watchlist | ✓ scaffold `cbadbb9` | | | |
| Contract 4 promote flow | △ in progress `1d9f50f` | | | |
| Idempotency 12/12 verify gate | ✗ design only | | | gate at 5/3 22:00 |
| Pre-open monitor probe | ✗ | needs Bruce 5/3 author | | runs 06:00–09:00 |
| Demo runbook | ✓ | ✓ | dry-run rehearsal | execute |
| Contingency plan | ✓ | ✓ | ✓ | reference |

(✓ = done / △ = in-progress / ✗ = not started; **all rows must be ✓ by D-day or Mode A/B/C contingency triggers**.)

## 4. Lane-by-lane status
### Codex (apps/web)
- Active commits today: [N]
- Surface coverage: [Risk / Watchlist / Idea promote / K-line / Portfolio]
- Stop-line grep: [0 hits / N hits — STOP if N>0]
- Outstanding: [list contracts not yet implemented]

### Jason (apps/api + migrations)
- Active commits today: [N]
- Migrations opened: [list]
- 4 routes done: [list]
- Outstanding: [list]
- Status: [ACTIVE / OFFLINE / BLOCKED]

### Bruce (verify + release)
- Verify runs today: [list]
- Hard-line audits: [N completed]
- Bash environment status: [GREEN / DEAD]
- Outstanding: [list]

### Mike + Pete (reviewers, on-call)
- Mike migration audits filed: [list]
- Pete desk reviews filed: [list]

### Elva (orchestrator)
- Designs filed today: [N]
- 20min cycles run: [N]
- Cross-cutting decisions: [list]

## 5. Yellow & Red events (chronological)
| Time | Severity | Event | Resolved? |
|---|---|---|---|
| [HH:MM] | Y/R | [what happened] | Y/N |

If empty: write `No yellow/red events today.`

## 6. Blockers carried into tomorrow
| # | Blocker | Owner | ETA |
|---|---|---|---|
| 1 | [e.g. Jason offline → Contract 4 backend stalled] | [who] | [when] |

## 7. Tomorrow's plan (top 5)
1. [most important thing]
2. ...
3. ...
4. ...
5. ...

## 8. Decisions 楊董 needs to make tomorrow
| # | Question | My recommended default | Override? |
|---|---|---|---|
| 1 | [decision needed] | [default I'm proceeding on] | (yes/no) |

If empty: write `No decisions needed — autonomous push continues.`

---

**Status:** [draft / final]
**Next EOD due:** [YYYY-MM-DD 21:00 TST]
```

---

## §4 Filing discipline

| Rule | Reason |
|---|---|
| File EVERY day, even if idle | An "idle" day is itself signal — we don't lose context |
| File before 21:30 TST | 楊董 needs sleep window with closed loop |
| Headline ≤ 25 字 | Forces clarity |
| Demo readiness table mandatory | This is the 楊董 read-fast view |
| Every Yellow/Red **must** have a Resolved? column | We don't lose alarms |
| Decision questions must have **my default** | 楊董 reads default first; only intervenes if override |

---

## §5 Special cases

### Weekend EOD (5/2, 5/3)
Markets closed → mostly impl + verify days. Demo readiness table will move fastest on weekends. File at 21:00 same as weekdays.

### Demo day EOD (5/4)
Special long-form supplement: append `## 9. Demo execution log` capturing every step A-H of the runbook with timestamps + screenshots. This becomes the historical record for "the first paper E2E demo."

If demo postponed: §1 headline = `DEMO POSTPONED to [date]; reason [F#/HS#]` and §9 = postpone rootcause.

### Sprint close EOD (5/9)
Final EOD also writes `evidence/w7_paper_sprint/W7_FINAL_CLOSEOUT.md` separately, summarizing the entire 10-day sprint with §1-§8 condensed + a §10 "lessons learned + W8 carry-over" section.

---

## §6 Cross-references

- Demo runbook (happy path): `paper_e2e_live_demo_runbook_2026-05-04.md`
- Idempotency verify gate: `paper_e2e_idempotency_verify_checklist_2026-05-04.md`
- Contingency plan: `paper_e2e_demo_contingency_plan_2026-05-04.md`
- Status board (real-time): `frontend_realdata_status_board_2026-05-01.md`
- Contract specs: `contract_2_*` / `contract_2b_*` / `contract_3_*` / `contract_4_*`

---

## §7 Today's EOD (5/1) — first one to file using this template

Will be filed by 21:00 TST as `evidence/w7_paper_sprint/eod/w7_eod_2026-05-01.md`. Expected highlights:
- Headline: "10 P1 designs filed in 6h push; Codex executed 3 inside 20min each"
- §3 demo readiness: 4/8 items ✓ at D-3
- §4 Codex active, Jason offline, Bruce static-only, Elva 7-cycle autonomous
- §5 No yellow/red
- §6 Carry over: Jason backend offline, Bruce harness env to fix on 5/2
- §7 Top-5 tomorrow: Codex Contract 4 wiring / Jason migration / Bruce harness / 5/2 dry-run prep / Mike audit
- §8 Q1-Q5 already pending from §8 of progress report 18:53

---

**Status:** Template v1 final. Used starting 5/1 21:00 EOD filing.
