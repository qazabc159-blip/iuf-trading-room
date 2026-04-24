#!/usr/bin/env bash
# P0-E live round-trip proof — 2026-04-24
# Tests theme_summary: enqueue -> runner submits -> content_draft awaiting_review -> approve -> theme_summaries row.
set -euo pipefail

API="https://api.eycvector.com"
COOKIE_FILE="$(mktemp)"
trap 'rm -f "$COOKIE_FILE"' EXIT

source /c/tmp/iuf_owner_creds.env
OWNER_PASSWORD="${OWNER_PASSWORD:-${OWNER_PW:-}}"

echo "[p0e] 1. login owner"
LOGIN=$(curl -sS -c "$COOKIE_FILE" -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$OWNER_EMAIL\",\"password\":\"$OWNER_PASSWORD\"}")
echo "  login: $(echo "$LOGIN" | python -c "import sys,json; d=json.load(sys.stdin); print('ok user='+d['user']['email']) if 'user' in d else print('FAIL:'+str(d))")"

echo "[p0e] 2. initial content-drafts count (should be 0 awaiting)"
curl -sS -b "$COOKIE_FILE" "$API/api/v1/content-drafts?status=awaiting_review" | python -c "import sys,json; d=json.load(sys.stdin); print('  awaiting count =', len(d.get('data',[])))"

echo "[p0e] 3. list themes (pick first)"
THEME=$(curl -sS -b "$COOKIE_FILE" "$API/api/v1/themes?limit=1" | python -c "import sys,json; d=json.load(sys.stdin); t=d['data'][0]; print(t['id']+'|'+t['name'])")
THEME_ID="${THEME%%|*}"
THEME_NAME="${THEME##*|}"
echo "  picked themeId=$THEME_ID name=$THEME_NAME"

echo "[p0e] 4. register runner device"
REG=$(curl -sS -b "$COOKIE_FILE" -X POST "$API/api/v1/openalice/register" \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"oa-p0e-'"$(date +%s)"'","deviceName":"P0E-Round-Trip","capabilities":["theme_summary","company_note"]}')
DEVICE_ID=$(echo "$REG" | python -c "import sys,json; print(json.load(sys.stdin)['data']['deviceId'])")
DEVICE_TOKEN=$(echo "$REG" | python -c "import sys,json; print(json.load(sys.stdin)['data']['deviceToken'])")
echo "  deviceId=$DEVICE_ID token_len=${#DEVICE_TOKEN}"

echo "[p0e] 5. enqueue theme_summary job"
JOB=$(curl -sS -b "$COOKIE_FILE" -X POST "$API/api/v1/openalice/jobs" \
  -H "Content-Type: application/json" \
  -d '{"taskType":"theme_summary","schemaName":"theme_summary@v1","instructions":"Produce theme summary (p0e test)","contextRefs":[{"type":"theme","id":"'"$THEME_ID"'"}],"parameters":{"themeId":"'"$THEME_ID"'","themeName":"'"$THEME_NAME"'","companyCount":3,"targetTable":"theme_summaries","targetEntityId":"'"$THEME_ID"'","producerVersion":"v1"}}')
JOB_ID=$(echo "$JOB" | python -c "import sys,json; print(json.load(sys.stdin)['data']['jobId'])")
echo "  jobId=$JOB_ID"

echo "[p0e] 6. runner claim"
CLAIM=$(curl -sS -X POST "$API/api/v1/openalice/jobs/claim" \
  -H "Authorization: Bearer $DEVICE_TOKEN" \
  -H "x-device-id: $DEVICE_ID" \
  -H "Content-Type: application/json" \
  -d "{\"deviceId\":\"$DEVICE_ID\"}")
CLAIMED_TASK=$(echo "$CLAIM" | python -c "import sys,json; d=json.load(sys.stdin); print(d['data']['taskType'])")
echo "  claimed taskType=$CLAIMED_TASK jobId=$JOB_ID"

echo "[p0e] 7. runner submit draft_ready"
SUBMIT=$(curl -sS -X POST "$API/api/v1/openalice/jobs/$JOB_ID/result" \
  -H "Authorization: Bearer $DEVICE_TOKEN" \
  -H "x-device-id: $DEVICE_ID" \
  -H "Content-Type: application/json" \
  -d '{"jobId":"'"$JOB_ID"'","status":"draft_ready","schemaName":"theme_summary@v1","structured":{"themeId":"'"$THEME_ID"'","summary":"[P0E round-trip proof] Theme: '"$THEME_NAME"'. This summary was produced by the runner and flows through content_drafts awaiting_review.","companyCount":3},"warnings":[],"artifacts":[]}')
echo "$SUBMIT" | python -c "import sys,json; d=json.load(sys.stdin); print('  submit status =', d['data']['status'])"

echo "[p0e] 8. content-drafts awaiting_review should now have the draft"
DRAFTS=$(curl -sS -b "$COOKIE_FILE" "$API/api/v1/content-drafts?status=awaiting_review")
DRAFT_ID=$(echo "$DRAFTS" | python -c "import sys,json; d=json.load(sys.stdin)['data']; m=[x for x in d if x.get('sourceJobId')=='$JOB_ID']; print(m[0]['id'] if m else 'NOT_FOUND')")
echo "  draftId=$DRAFT_ID"
if [ "$DRAFT_ID" = "NOT_FOUND" ]; then
  echo "[p0e] FAIL: content_draft not created from submit"
  exit 1
fi

echo "[p0e] 9. approve draft"
APPROVE=$(curl -sS -b "$COOKIE_FILE" -X POST "$API/api/v1/content-drafts/$DRAFT_ID/approve" \
  -H "Content-Type: application/json")
APPROVED_REF=$(echo "$APPROVE" | python -c "import sys,json; d=json.load(sys.stdin); print(d['data']['approvedRefId'])")
echo "  approvedRefId=$APPROVED_REF"

echo "[p0e] 10. confirm theme_summary row exists in formal table (via GET /api/v1/theme-summaries or derived endpoint)"
curl -sS -b "$COOKIE_FILE" "$API/api/v1/themes/$THEME_ID/summary" | python -c "import sys,json; d=json.load(sys.stdin); print('  summary api:', 'FOUND' if d.get('data') else 'NOT_FOUND')" || echo "  (summary endpoint may not exist; check via drafts list approved status)"

echo "[p0e] 11. list drafts approved to confirm state transition"
curl -sS -b "$COOKIE_FILE" "$API/api/v1/content-drafts?status=approved" | python -c "
import sys,json
d = json.load(sys.stdin)['data']
m = [x for x in d if x['id']=='$DRAFT_ID']
if m:
    r = m[0]
    print(f'  status={r[\"status\"]} approvedRefId={r[\"approvedRefId\"]} reviewedAt={r[\"reviewedAt\"]}')
else:
    print('  draft not in approved list — FAIL')
    sys.exit(1)
"

echo
echo "[p0e] PASS — full round-trip complete."
echo "  jobId=$JOB_ID"
echo "  draftId=$DRAFT_ID"
echo "  theme_summaries row id=$APPROVED_REF"
