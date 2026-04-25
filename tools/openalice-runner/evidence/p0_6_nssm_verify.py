"""P0.6 NSSM service verification.

Drives 6 checks against the live `openalice-runner` Windows service:
  1. polling — two lastSeenAt snapshots ~12s apart should differ
  2. heartbeat-via-claim — enqueue job, runner should claim within 20s
  3. duplicate-protection — atomic claim means same job can't be processed twice
  4. service stop — sc stop, lastSeenAt freezes (skipped if not admin)
  5. service start — recovery (skipped if not admin)
  6. crash recovery — kill python.exe, NSSM auto-restart (skipped if not admin)

Writes evidence/p0_6_nssm_verify_<ts>.json. No secrets logged.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

import requests

API = "https://api.eycvector.com"
OWNER_CREDS = r"C:\tmp\iuf_owner_creds.env"
DEVICE_ID = "oa-win-mvp-01"
SERVICE = "openalice-runner"


def load_env(path: str) -> dict[str, str]:
    env: dict[str, str] = {}
    with open(path, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def get_device(s: requests.Session) -> dict | None:
    r = s.get(f"{API}/api/v1/openalice/devices", timeout=15)
    data = r.json().get("data") or []
    for d in data:
        if d.get("deviceId") == DEVICE_ID:
            return d
    return None


def sc_query() -> str:
    p = subprocess.run(["sc", "query", SERVICE], capture_output=True, text=True)
    return p.stdout


def sc_action(action: str) -> tuple[int, str, str]:
    """Returns (rc, stdout, stderr). Non-admin will get rc=5 ACCESS DENIED."""
    p = subprocess.run(["sc", action, SERVICE], capture_output=True, text=True)
    return p.returncode, p.stdout, p.stderr


def get_python_pid() -> int | None:
    """Find PID of python.exe running our runner. Returns None if not found."""
    p = subprocess.run(
        ["powershell", "-NoProfile", "-Command",
         "Get-WmiObject Win32_Process -Filter \"Name='python.exe'\" | "
         "Where-Object { $_.CommandLine -like '*openalice_runner*' } | "
         "Select-Object -ExpandProperty ProcessId"],
        capture_output=True, text=True, timeout=10,
    )
    out = (p.stdout or "").strip().splitlines()
    for line in out:
        try:
            return int(line.strip())
        except ValueError:
            continue
    return None


def main() -> int:
    evidence: dict[str, object] = {
        "ts_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "phase": "P0.6 NSSM verify",
        "service": SERVICE,
        "device_id": DEVICE_ID,
    }

    owner = load_env(OWNER_CREDS)
    email = owner.get("OWNER_EMAIL")
    password = owner.get("OWNER_PASSWORD") or owner.get("OWNER_PW")
    s = requests.Session()
    s.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)

    # 0. Service state.
    initial_state = sc_query()
    evidence["sc_query_initial"] = "RUNNING" if "RUNNING" in initial_state else "OTHER"

    # 1. Polling proof — sample twice, expect lastSeenAt to advance.
    d1 = get_device(s)
    t1 = d1.get("lastSeenAt") if d1 else None
    print(f"[v1.poll] sample1 lastSeenAt={t1}")
    time.sleep(13)
    d2 = get_device(s)
    t2 = d2.get("lastSeenAt") if d2 else None
    print(f"[v1.poll] sample2 lastSeenAt={t2}")
    polling_pass = (t1 is not None and t2 is not None and t1 != t2)
    evidence["check1_polling"] = {
        "pass": polling_pass,
        "sample1": t1,
        "sample2": t2,
    }
    print(f"[v1.poll] PASS={polling_pass}")

    # 2. Heartbeat via claim — enqueue 1 job and watch for status transition.
    themes = s.get(f"{API}/api/v1/themes", timeout=15).json().get("data") or []
    recent = s.get(f"{API}/api/v1/content-drafts?limit=200", timeout=15).json().get("data") or []
    busy = {d["targetEntityId"] for d in recent if d.get("targetTable") == "theme_summaries" and d.get("status") != "rejected"}
    theme = next((t for t in themes if t.get("id") not in busy), themes[0] if themes else None)
    if theme:
        job_resp = s.post(
            f"{API}/api/v1/openalice/jobs",
            json={
                "taskType": "theme_summary",
                "schemaName": "theme_summary_v1",
                "instructions": "P0.6 NSSM verify — heartbeat via claim",
                "contextRefs": [],
                "parameters": {
                    "themeId": theme["id"],
                    "themeName": theme.get("name") or "theme",
                    "companyCount": int(theme.get("companyCount") or 0),
                },
            },
            timeout=15,
        )
        job_id = (job_resp.json().get("data") or {}).get("id") or (job_resp.json().get("data") or {}).get("jobId")
        print(f"[v2.claim] enqueued jobId={job_id} theme={theme.get('name')}")

        # Wait up to 25s for claim.
        claimed = False
        draft_id = None
        for i in range(25):
            time.sleep(1)
            jr = s.get(f"{API}/api/v1/openalice/jobs/{job_id}", timeout=10)
            if jr.status_code < 400:
                jstatus = (jr.json().get("data") or {}).get("status")
                if jstatus in {"running", "completed"} and not claimed:
                    print(f"[v2.claim] tick={i}s status={jstatus}")
                    claimed = True
                if jstatus == "completed":
                    break
        # Look for the draft.
        drafts = s.get(f"{API}/api/v1/content-drafts?limit=20", timeout=10).json().get("data") or []
        for d in drafts:
            if d.get("sourceJobId") == job_id:
                draft_id = d.get("id")
                break
        evidence["check2_heartbeat_via_claim"] = {
            "pass": claimed and bool(draft_id),
            "job_id": job_id,
            "draft_id": draft_id,
            "theme_name": theme.get("name"),
        }
        print(f"[v2.claim] PASS={claimed and bool(draft_id)} jobId={job_id} draftId={draft_id}")
    else:
        evidence["check2_heartbeat_via_claim"] = {"pass": False, "reason": "no theme available"}

    # 3. Duplicate protection — structural (atomic SQL claim). Document, don't break.
    # Verify by checking that the just-claimed job has a single draft row.
    if theme and job_id:
        drafts = s.get(f"{API}/api/v1/content-drafts?limit=200", timeout=10).json().get("data") or []
        ours = [d for d in drafts if d.get("sourceJobId") == job_id]
        evidence["check3_duplicate_protection"] = {
            "pass": len(ours) == 1,
            "draft_count_for_job": len(ours),
            "note": "Atomic SQL claim guarantees one device wins per job",
        }
        print(f"[v3.dup] PASS={len(ours) == 1} draft_count={len(ours)}")
    else:
        evidence["check3_duplicate_protection"] = {"pass": None, "reason": "skipped — no job to test"}

    # 4 & 5. Service stop/start. Try sc stop — if access denied, report BLOCKED.
    print("[v4.stop] attempting sc stop ...")
    rc, out, err = sc_action("stop")
    if rc == 0 or "STOP_PENDING" in out or "STOPPED" in out:
        time.sleep(5)
        d_stopped = get_device(s)
        time.sleep(8)
        d_after_freeze = get_device(s)
        # If service is stopped, lastSeenAt should NOT advance.
        frozen = (d_stopped and d_after_freeze and
                  d_stopped.get("lastSeenAt") == d_after_freeze.get("lastSeenAt"))
        evidence["check4_service_stop"] = {
            "pass": frozen,
            "sc_rc": rc,
            "lastSeenAt_at_stop": d_stopped.get("lastSeenAt") if d_stopped else None,
            "lastSeenAt_after_8s": d_after_freeze.get("lastSeenAt") if d_after_freeze else None,
        }
        print(f"[v4.stop] PASS={frozen} (lastSeenAt frozen)")

        # 5. Restart.
        print("[v5.start] attempting sc start ...")
        rc2, out2, err2 = sc_action("start")
        if rc2 == 0 or "START_PENDING" in out2 or "RUNNING" in out2:
            time.sleep(13)
            d_recovered = get_device(s)
            recovered = (d_recovered and d_after_freeze and
                         d_recovered.get("lastSeenAt") != d_after_freeze.get("lastSeenAt"))
            evidence["check5_service_start"] = {
                "pass": recovered,
                "sc_rc": rc2,
                "lastSeenAt_recovered": d_recovered.get("lastSeenAt") if d_recovered else None,
            }
            print(f"[v5.start] PASS={recovered} (lastSeenAt advanced after restart)")
        else:
            evidence["check5_service_start"] = {"pass": False, "sc_rc": rc2, "out": out2[:200], "err": err2[:200]}
    elif rc == 5 or "Access is denied" in out or "Access is denied" in err:
        evidence["check4_service_stop"] = {"pass": None, "blocked": "needs admin shell", "sc_rc": rc}
        evidence["check5_service_start"] = {"pass": None, "blocked": "needs admin shell"}
        print("[v4.stop] BLOCKED — needs admin shell to test stop/start")
    else:
        evidence["check4_service_stop"] = {"pass": False, "sc_rc": rc, "out": out[:200], "err": err[:200]}

    # 6. Crash recovery — try kill python.exe.
    pid = get_python_pid()
    print(f"[v6.crash] runner python PID={pid}")
    if pid:
        kp = subprocess.run(["taskkill", "/F", "/PID", str(pid)], capture_output=True, text=True)
        if kp.returncode == 0:
            time.sleep(8)  # NSSM throttle restart delay is 5s
            new_pid = get_python_pid()
            recovered = (new_pid is not None and new_pid != pid)
            evidence["check6_crash_recovery"] = {
                "pass": recovered,
                "killed_pid": pid,
                "new_pid": new_pid,
                "note": "NSSM AppExit Default Restart with 5000ms delay",
            }
            print(f"[v6.crash] PASS={recovered} killed={pid} new={new_pid}")
        elif kp.returncode == 1 or "Access is denied" in (kp.stderr or ""):
            evidence["check6_crash_recovery"] = {"pass": None, "blocked": "needs admin shell"}
            print("[v6.crash] BLOCKED — needs admin shell to taskkill")
        else:
            evidence["check6_crash_recovery"] = {"pass": False, "rc": kp.returncode, "err": kp.stderr[:200]}
    else:
        evidence["check6_crash_recovery"] = {"pass": False, "reason": "no python.exe found running runner"}

    out_dir = Path(__file__).parent
    out_path = out_dir / f"p0_6_nssm_verify_{time.strftime('%Y%m%d_%H%M%S', time.gmtime())}.json"
    out_path.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n[evi] wrote {out_path}")
    print(json.dumps(evidence, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
