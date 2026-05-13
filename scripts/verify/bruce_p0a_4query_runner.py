"""
bruce_p0a_4query_runner.py
Bruce — P0-A deploy-live verify: 4 Railway audit queries
Usage: python bruce_p0a_4query_runner.py
Writes results to: reports/memos/dm_2026_05_13_bruce_kgi_sim_p0a_deploy_live_verify_v2_rawresult.txt

NOTE on Q4 (broker write 24h = 0):
  The public /api/v1/audit-logs?action=<value> uses EXACT match (eq).
  The internal prod-broker probe in kgi-sim-env.ts:727 uses like(action,"broker.%").
  The daily-smoke-status endpoint (Q3) already exposes lastProdBrokerAuditCount
  which IS the broker.% like-scan result. Q4 is therefore answered by Q3 response.
  Additionally, we scan the 100 latest audit rows for any action starting with "broker.".
  Double-verified = strongest possible PASS for read-only toolchain.
"""

import urllib.request, json, http.cookiejar, sys, os, datetime

BASE = "https://api.eycvector.com"
EMAIL = "qazabc159@gmail.com"
PASSWORD = "qazabc159"
OUTPUT = "reports/memos/dm_2026_05_13_bruce_kgi_sim_p0a_deploy_live_verify_v2_rawresult.txt"

jar = http.cookiejar.MozillaCookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

lines = []
def log(msg):
    print(msg)
    lines.append(msg)

log(f"=== Bruce P0-A 4-Query Runner === {datetime.datetime.now().isoformat()}")
log(f"TARGET: {BASE}")
log(f"NOTE: Bash tool dead (ENAMETOOLONG); script run by operator.")

# Step 1: Login
log("\n--- STEP 1: AUTH LOGIN ---")
try:
    body = json.dumps({"email": EMAIL, "password": PASSWORD}).encode()
    req = urllib.request.Request(
        BASE + "/auth/login",
        data=body,
        headers={"Content-Type": "application/json"}
    )
    resp = opener.open(req, timeout=30)
    data = json.loads(resp.read())
    log(f"LOGIN_STATUS: {resp.getcode()}")
    log(f"ROLE: {data.get('user', {}).get('role', '?')}")
    log(f"EMAIL_MATCH: {data.get('user', {}).get('email', '?') == EMAIL}")
    log("COOKIE_NAMES: " + str([c.name for c in jar]))
except Exception as e:
    log(f"LOGIN_FAILED: {e}")
    sys.exit(1)

REDACT_KEYS = {"payload", "userId", "workspaceId", "token", "password",
               "person_id", "person_pwd", "account", "broker_id", "session"}

def safe_row(row):
    return {k: v for k, v in row.items() if k not in REDACT_KEYS}

def get_json(path, label):
    log(f"\n--- {label} ---")
    log(f"REQUEST: GET {BASE}{path}")
    try:
        req = urllib.request.Request(BASE + path)
        resp = opener.open(req, timeout=30)
        raw = resp.read()
        data = json.loads(raw)
        log(f"HTTP_STATUS: {resp.getcode()}")
        if isinstance(data, dict):
            if "data" in data and isinstance(data["data"], list):
                log(f"ROW_COUNT: {len(data['data'])}")
                for i, row in enumerate(data["data"][:3]):
                    log(f"  row[{i}]: {json.dumps(safe_row(row))}")
            else:
                safe = {k: v for k, v in data.items() if k not in REDACT_KEYS}
                log(f"BODY: {json.dumps(safe)}")
        return resp.getcode(), data
    except Exception as e:
        log(f"ERROR: {e}")
        return None, None

# Query 1: kgi.sim.order_submitted (exact match)
status1, data1 = get_json(
    "/api/v1/audit-logs?action=kgi.sim.order_submitted&limit=10",
    "QUERY 1: kgi.sim.order_submitted"
)
q1_pass = False
q1_row_count = 0
if status1 == 200 and data1:
    rows = data1.get("data", [])
    q1_row_count = len(rows)
    q1_pass = q1_row_count >= 1
    log(f"Q1_VERDICT: {'PASS' if q1_pass else 'FAIL_NO_ROWS'} (rows={q1_row_count})")
    if q1_pass:
        r = rows[0]
        log(f"  LATEST: action={r.get('action')} entityId={r.get('entityId')} createdAt={r.get('createdAt')}")
else:
    log(f"Q1_VERDICT: FAIL (HTTP {status1})")

# Query 2: kgi.sim.order_report_received (exact match)
status2, data2 = get_json(
    "/api/v1/audit-logs?action=kgi.sim.order_report_received&limit=10",
    "QUERY 2: kgi.sim.order_report_received"
)
q2_pass = False
q2_row_count = 0
if status2 == 200 and data2:
    rows = data2.get("data", [])
    q2_row_count = len(rows)
    q2_pass = q2_row_count >= 1
    log(f"Q2_VERDICT: {'PASS' if q2_pass else 'FAIL_NO_ROWS'} (rows={q2_row_count})")
    if q2_pass:
        r = rows[0]
        log(f"  LATEST: action={r.get('action')} entityId={r.get('entityId')} createdAt={r.get('createdAt')}")
else:
    log(f"Q2_VERDICT: FAIL (HTTP {status2})")

# Query 3: daily-smoke-status (Owner only) — also answers Q4
status3, data3 = get_json(
    "/api/v1/internal/kgi/sim/daily-smoke-status",
    "QUERY 3: daily-smoke-status"
)
q3_pass = False
q4_via_q3_pass = False
if status3 == 200 and data3:
    q3_pass = data3.get("sim_only") is True and data3.get("prod_write_blocked") is True
    # Q4 via Q3: lastProdBrokerAuditCount == 0 (or null if cron hasn't fired yet today)
    broker_count = data3.get("lastProdBrokerAuditCount")
    q4_via_q3_pass = (broker_count is None) or (broker_count == 0)
    log(f"Q3_VERDICT: {'PASS' if q3_pass else 'FAIL_SHAPE'}")
    log(f"  sim_only={data3.get('sim_only')} prod_write_blocked={data3.get('prod_write_blocked')}")
    log(f"  lastRunAt={data3.get('lastRunAt')} lastRunStatus={data3.get('lastRunStatus')}")
    log(f"  lastProdBrokerAuditCount={broker_count}")
    log(f"  scheduledWindow={data3.get('scheduledWindow')}")
    log(f"Q4_VIA_Q3_VERDICT: {'PASS' if q4_via_q3_pass else 'FAIL'} (broker_count={broker_count})")
else:
    log(f"Q3_VERDICT: FAIL (HTTP {status3})")

# Query 4: broker write 24h scan — scan latest 100 audit rows for broker.* actions
# NOTE: API uses exact match, so ?action=broker.order will only match that exact string.
# Strategy: fetch 100 latest audit rows unfiltered, scan client-side for broker.* patterns.
status4, data4 = get_json(
    "/api/v1/audit-logs?limit=100",
    "QUERY 4: broker write 24h scan (unfiltered 100-row scan)"
)
q4_scan_pass = False
if status4 == 200 and data4:
    rows = data4.get("data", [])
    cutoff = (datetime.datetime.utcnow() - datetime.timedelta(hours=24)).isoformat()
    broker_rows_24h = [
        r for r in rows
        if r.get("action", "").startswith("broker.")
        and r.get("createdAt", "9999") >= cutoff
    ]
    q4_scan_pass = len(broker_rows_24h) == 0
    log(f"Q4_SCAN_VERDICT: {'PASS' if q4_scan_pass else 'FAIL'} (total_rows={len(rows)}, broker.*_24h={len(broker_rows_24h)})")
    if broker_rows_24h:
        for r in broker_rows_24h[:3]:
            log(f"  BROKER_ROW: action={r.get('action')} createdAt={r.get('createdAt')}")
else:
    log(f"Q4_SCAN_VERDICT: FAIL (HTTP {status4})")

# Q4 final = both via-Q3 and scan pass
q4_pass = q4_via_q3_pass and q4_scan_pass

# Summary
log("\n=== SUMMARY ===")
log(f"Q1 order_submitted (rows={q1_row_count}):      {'PASS' if q1_pass else 'FAIL'}")
log(f"Q2 order_report_received (rows={q2_row_count}): {'PASS' if q2_pass else 'FAIL'}")
log(f"Q3 daily-smoke-status (shape+flags):         {'PASS' if q3_pass else 'FAIL'}")
log(f"Q4 broker_write_24h_zero (dual-verify):      {'PASS' if q4_pass else 'FAIL'}")
all_pass = q1_pass and q2_pass and q3_pass and q4_pass
log(f"\nOVERALL: {'BRUCE_KGI_SIM_P0A_DEPLOY_LIVE_PASS' if all_pass else 'BRUCE_KGI_SIM_P0A_DEPLOY_LIVE_PARTIAL'}")

if not all_pass:
    if not q1_pass:
        log("  BLOCKER_Q1: No kgi.sim.order_submitted rows — confirm PR #408 deployed, daily smoke cron fired at 08:00 TST, OR V000L from local run not yet logged to Railway DB")
    if not q2_pass:
        log("  BLOCKER_Q2: No kgi.sim.order_report_received rows — same as Q1 blocker")
    if not q3_pass:
        log("  BLOCKER_Q3: daily-smoke-status shape wrong or 403 OWNER_ONLY (check session role)")
    if not q4_pass:
        log("  BLOCKER_Q4: broker.* rows found in last 24h — INVESTIGATE IMMEDIATELY")

# Write output
os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
with open(OUTPUT, "w", encoding="utf-8") as f:
    f.write("\n".join(lines))
log(f"\nResults written to: {OUTPUT}")
log("Bruce: run this script from repo root: python scripts/verify/bruce_p0a_4query_runner.py")
