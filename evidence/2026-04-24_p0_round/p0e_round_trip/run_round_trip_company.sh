#!/usr/bin/env bash
# P0-E live round-trip proof (company_note variant) — 2026-04-24
set -euo pipefail

API="https://api.eycvector.com"
COOKIE_FILE="$(mktemp)"
trap 'rm -f "$COOKIE_FILE"' EXIT

source /c/tmp/iuf_owner_creds.env
OWNER_PASSWORD="${OWNER_PASSWORD:-${OWNER_PW:-}}"

curl -sS -c "$COOKIE_FILE" -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$OWNER_EMAIL\",\"password\":\"$OWNER_PASSWORD\"}" >/dev/null

COMPANY=$(curl -sS -b "$COOKIE_FILE" "$API/api/v1/companies?limit=1" | python -c "import sys,json; d=json.load(sys.stdin); c=d['data'][0]; print(c['id']+'|'+c['name']+'|'+c['ticker'])")
COMPANY_ID="${COMPANY%%|*}"
rest="${COMPANY#*|}"
COMPANY_NAME="${rest%%|*}"
COMPANY_TICKER="${rest##*|}"
echo "[p0e-company] picked companyId=$COMPANY_ID name=$COMPANY_NAME ticker=$COMPANY_TICKER"

REG=$(curl -sS -b "$COOKIE_FILE" -X POST "$API/api/v1/openalice/register" \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"oa-p0e-company-'"$(date +%s)"'","deviceName":"P0E-Company-RT","capabilities":["company_note"]}')
DEVICE_ID=$(echo "$REG" | python -c "import sys,json; print(json.load(sys.stdin)['data']['deviceId'])")
DEVICE_TOKEN=$(echo "$REG" | python -c "import sys,json; print(json.load(sys.stdin)['data']['deviceToken'])")
echo "[p0e-company] device registered id=$DEVICE_ID tokenLen=${#DEVICE_TOKEN}"

JOB=$(curl -sS -b "$COOKIE_FILE" -X POST "$API/api/v1/openalice/jobs" \
  -H "Content-Type: application/json" \
  -d '{"taskType":"company_note","schemaName":"company_note@v1","instructions":"Produce company note (p0e test)","contextRefs":[{"type":"company","id":"'"$COMPANY_ID"'"}],"parameters":{"companyId":"'"$COMPANY_ID"'","companyName":"'"$COMPANY_NAME"'","ticker":"'"$COMPANY_TICKER"'","targetTable":"company_notes","targetEntityId":"'"$COMPANY_ID"'","producerVersion":"v1"}}')
JOB_ID=$(echo "$JOB" | python -c "import sys,json; print(json.load(sys.stdin)['data']['jobId'])")
echo "[p0e-company] jobId=$JOB_ID"

curl -sS -X POST "$API/api/v1/openalice/jobs/claim" \
  -H "Authorization: Bearer $DEVICE_TOKEN" -H "x-device-id: $DEVICE_ID" -H "Content-Type: application/json" \
  -d "{\"deviceId\":\"$DEVICE_ID\"}" >/dev/null
echo "[p0e-company] claimed"

curl -sS -X POST "$API/api/v1/openalice/jobs/$JOB_ID/result" \
  -H "Authorization: Bearer $DEVICE_TOKEN" -H "x-device-id: $DEVICE_ID" -H "Content-Type: application/json" \
  -d '{"jobId":"'"$JOB_ID"'","status":"draft_ready","schemaName":"company_note@v1","structured":{"companyId":"'"$COMPANY_ID"'","note":"[P0E round-trip] Company note for '"$COMPANY_NAME"' ('"$COMPANY_TICKER"'). Submitted via OpenAlice runner, flows through content_drafts awaiting_review."},"warnings":[],"artifacts":[]}' >/dev/null
echo "[p0e-company] submit ok"

DRAFT_ID=$(curl -sS -b "$COOKIE_FILE" "$API/api/v1/content-drafts?status=awaiting_review" | python -c "import sys,json; d=json.load(sys.stdin)['data']; m=[x for x in d if x.get('sourceJobId')=='$JOB_ID']; print(m[0]['id'] if m else 'NOT_FOUND')")
echo "[p0e-company] draftId=$DRAFT_ID"
[ "$DRAFT_ID" = "NOT_FOUND" ] && { echo "[p0e-company] FAIL: content_draft not created"; exit 1; }

APPROVE=$(curl -sS -b "$COOKIE_FILE" -X POST "$API/api/v1/content-drafts/$DRAFT_ID/approve" \
  -H "Content-Type: application/json")
APPROVED_REF=$(echo "$APPROVE" | python -c "import sys,json; print(json.load(sys.stdin)['data']['approvedRefId'])")
echo "[p0e-company] approvedRefId=$APPROVED_REF"

curl -sS -b "$COOKIE_FILE" "$API/api/v1/content-drafts?status=approved" | python -c "
import sys,json
d = json.load(sys.stdin)['data']
m = [x for x in d if x['id']=='$DRAFT_ID']
if m:
    r = m[0]
    print(f'[p0e-company] verified: status={r[\"status\"]} approvedRefId={r[\"approvedRefId\"]} reviewedAt={r[\"reviewedAt\"]}')
else:
    print('[p0e-company] FAIL: draft not in approved list'); sys.exit(1)
"

echo
echo "[p0e-company] PASS"
echo "  jobId=$JOB_ID"
echo "  draftId=$DRAFT_ID"
echo "  company_notes row id=$APPROVED_REF"
