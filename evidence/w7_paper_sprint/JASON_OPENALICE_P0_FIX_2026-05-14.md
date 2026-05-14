# Jason OpenAlice P0 Fix — 2026-05-14

**Owner:** Jason (Backend Strategy)
**Trigger:** Bruce OPENALICE_CONTENT_AUDIT_2026-05-14_1630TST — F1 mojibake, F4 internal-draft wording
**PR:** #468 `fix/openalice-encoding-template-scrub-2026-05-14`
**Commit:** f65987c

---

## P0-1 — Encoding fix

**Root cause confirmed:** Theme thesis for 低軌衛星 stored/retrieved with CP950/Big5 encoding mismatch. Text piped into LLM prompt as-is → LLM echoes U+FFFD replacement chars into published brief body.

**Fix:** `scrubReplacementChars(text: string): string` — exported from `openalice-pipeline.ts`.
- Strips all U+FFFD `�` chars (runs too)
- Collapses double-spaces left behind
- Applied via `sanitizeBriefBody()` wrapper

**Application points:**
- `parseDirectBriefPayload()` — pipeline daily brief path (section body)
- `openalice-strategy-brief.ts` section body `.map()` — strategy brief path

---

## P0-2 — Template residue scrub

**Root cause confirmed:** LLM prompt template contains internal research language. LLM echoes it verbatim without recognizing it as instruction vs. output content.

**Fix:** `scrubForbiddenPhrases(text: string): string` — exported from `openalice-pipeline.ts`.

**Forbidden phrase list (`FORBIDDEN_BRIEF_PHRASES`):**
- `"此版本僅作內部研究草稿，供人員審閱後再決定後續分析方向。"` (and partial forms)
- `"內部研究草稿"`, `"供人員審閱"`, `"後續分析方向"`
- `/Generated:\s*\d{4}-\d{2}-\d{2}\s*\(rule-template fallback\)/`
- `"internal research draft"`, `"for internal review"`, `"TODO:"`, `"FIXME:"`, `"placeholder"`

**Application points:** Same two as P0-1 via `sanitizeBriefBody()`.

---

## Files changed

| File | Change |
|------|--------|
| `apps/api/src/openalice-pipeline.ts` | +`scrubReplacementChars`, `scrubForbiddenPhrases`, `FORBIDDEN_BRIEF_PHRASES`, `sanitizeBriefBody` (exported); apply in `parseDirectBriefPayload` |
| `apps/api/src/openalice-strategy-brief.ts` | Import + apply `sanitizeBriefBody` in section map |
| `apps/api/src/openalice-pipeline.test.ts` | 8 new tests (P0-1 x4, P0-2 x4) |

---

## Test results

- `openalice-pipeline.test.ts`: 39/39 PASS
- `ci.test.ts`: 255/255 subtests PASS (file-level wrapper pre-existing fail unchanged)
- `api build`: clean

---

## Hardlines

- No prod runtime changes
- No reviewer threshold lowered
- No PAPER_LIVE promotion
- No token leak
- Lane boundary maintained (only openalice files)

---

*Generated: 2026-05-14T09:00 TST*
