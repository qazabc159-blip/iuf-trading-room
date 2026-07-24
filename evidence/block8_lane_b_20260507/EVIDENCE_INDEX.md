# BLOCK #8 Lane B — /briefs/[id] detail page evidence

date: 2026-05-07
branch: feat/web-brief-detail-page-block8-lane-b-2026-05-07
TCS: +3

## Files

- `apps/web/app/briefs/[id]/page.tsx` — new SSR detail page (Next.js dynamic route)
- `apps/web/lib/api.ts` — added `getBriefDetail()` + `BriefDetail` / `BriefDetailAuditChain` types

## Endpoint consumed

- `GET /api/v1/briefs/{id}` — PR #275 ship, Owner/Admin/Analyst auth, cookie forwarded by `request()`
- shape verified live against `https://api.eycvector.com/api/v1/briefs/2026-05-07`

## Display contract

- date / title / heading / status badge (PUBLISHED / AWAITING_REVIEW / REJECTED / ERROR)
- sections[]: heading + body + sourceTrail (sourceTrail explicitly marked when null)
- auditChain visualization, three sub-panels:
  - hardReject: rules: string[] / rejected: bool
  - adversarialReview: verdict / severityScore / flags / reviewerModel / auditedAt
    - null → "未審核" empty state
  - hallucinationCheck: verdict / confidence / flags / ragUsed / modelChain / auditedAt
    - null → "未審核" empty state

## Hard rules enforced

- **no secret leak** — `no_secret_grep_proof.txt` shows zero matches of OPENAI_API_KEY / FINMIND_TOKEN / sk-* / api_secret / client_secret
- **buy/sell/target/guarantee mask** — `maskUnsafeAdviceText()` replaces 買進 / 賣出 / 目標價 / 必賺 / 保證 / 勝率 → `[投資建議字詞已遮蔽]`
- **no fake guarantee / strategy approved wording** — verified via grep (no rendered text matches)
- **fallback_template flagged, never rendered as live brief** — non-published status shows "非 published 狀態，請勿視為正式可用內容"
- **404 graceful** — when GET /api/v1/briefs/{id} returns `not_found`, page renders "Brief 不存在" + link back to /briefs (no fake content)

## Files in this evidence dir

- `desktop_1365_brief_detail.png` — 1365×768 desktop screenshot of /briefs/2026-05-07 (PUBLISHED, today's brief, full audit chain showing "未審核" for adversarial + hallucination because audit_log has no entries for 2026-05-07 yet)
- `desktop_1365_404_missing_brief.png` — 1365×768 desktop screenshot of /briefs/2099-01-01 (404 / not_found)
- `mobile_390_brief_detail.png` — 390×844 mobile screenshot, no overflow, sections + audit chain stack vertically
- `no_secret_grep_proof.txt` — grep evidence of no secret leak + only allowed occurrences of forbidden words (in mask regexes / docstring)
- `typecheck_pass.txt` — `npx tsc --noEmit` exit 0

## Verify steps reproducible

```bash
# 1. login + cookie capture
curl -c /tmp/cookies.txt -X POST -H "Content-Type: application/json" -H "x-workspace-slug: primary-desk" -d '{"email":"qazabc159@gmail.com","password":"[REDACTED-OWNER-PW]"}' "https://api.eycvector.com/auth/login"

# 2. confirm endpoint live
curl -b /tmp/cookies.txt -H "x-workspace-slug: primary-desk" "https://api.eycvector.com/api/v1/briefs/2026-05-07"

# 3. confirm 404
curl -b /tmp/cookies.txt -H "x-workspace-slug: primary-desk" "https://api.eycvector.com/api/v1/briefs/2099-01-01"
# → {"error":"not_found"} HTTP 404

# 4. typecheck
cd apps/web && npx tsc --noEmit  # exit 0
```
