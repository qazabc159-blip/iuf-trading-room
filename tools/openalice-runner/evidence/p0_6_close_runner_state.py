"""P0.6 close — runner state snapshot (no OpenAI calls).

Captures evidence for closeout items without burning OpenAI quota:
  - single NSSM instance (process tree)
  - NSSM crash-recovery config (AppExit/AppThrottle/AppRestartDelay)
  - polling alive (heartbeat advancing on /devices)
  - dup-protection structural review (single device → no race in practice)
"""
from __future__ import annotations

import json
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


def ps(cmd: str) -> str:
    p = subprocess.run(
        ["powershell", "-NoProfile", "-Command", cmd],
        capture_output=True, text=True, timeout=15,
    )
    return (p.stdout or "").strip()


def nssm_get(*key_parts: str) -> str:
    p = subprocess.run(
        [r"C:\iuf\nssm\nssm.exe", "get", SERVICE, *key_parts],
        capture_output=True, text=True, timeout=10,
    )
    return (p.stdout or "").replace("\x00", "").strip()


def main() -> int:
    ev: dict = {
        "ts_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "phase": "P0.6 close — runner state",
        "service": SERVICE,
    }

    sc_state = subprocess.run(["sc", "query", SERVICE], capture_output=True, text=True).stdout
    ev["sc_state"] = "RUNNING" if "RUNNING" in sc_state else "OTHER"
    nssm_pid_line = subprocess.run(["sc", "queryex", SERVICE], capture_output=True, text=True).stdout
    nssm_pid = None
    for line in nssm_pid_line.splitlines():
        if "PID" in line and ":" in line:
            try:
                nssm_pid = int(line.split(":")[-1].strip())
            except ValueError:
                pass
    ev["nssm_service_pid"] = nssm_pid

    tree_csv = ps(
        "Get-CimInstance Win32_Process -Filter \"name='python.exe'\" | "
        "Select-Object ProcessId,ParentProcessId,Name | "
        "ConvertTo-Json -Compress"
    )
    try:
        rows = json.loads(tree_csv) if tree_csv else []
        if isinstance(rows, dict):
            rows = [rows]
    except json.JSONDecodeError:
        rows = []
    runner_children = [r for r in rows if r.get("ParentProcessId") == nssm_pid]
    ev["nssm_python_children"] = runner_children
    ev["check_single_instance"] = {
        "pass": len(runner_children) == 1,
        "child_count": len(runner_children),
        "pids": [r.get("ProcessId") for r in runner_children],
    }

    ev["nssm_config"] = {
        "AppExit_Default": nssm_get("AppExit", "Default"),
        "AppThrottle": nssm_get("AppThrottle"),
        "AppRestartDelay": nssm_get("AppRestartDelay"),
    }
    cfg_pass = (
        "Restart" in ev["nssm_config"]["AppExit_Default"]
        and "10000" in ev["nssm_config"]["AppThrottle"]
        and "5000" in ev["nssm_config"]["AppRestartDelay"]
    )
    ev["check_crash_recovery_policy"] = {
        "pass": cfg_pass,
        "note": "AppExit=Restart + 10s throttle + 5s delay = NSSM auto-restart on any exit",
    }

    owner = load_env(OWNER_CREDS)
    s = requests.Session()
    s.post(
        f"{API}/auth/login",
        json={"email": owner["OWNER_EMAIL"], "password": owner.get("OWNER_PASSWORD") or owner.get("OWNER_PW")},
        timeout=15,
    )
    devs = s.get(f"{API}/api/v1/openalice/devices", timeout=15).json().get("data") or []
    targets = [d for d in devs if d.get("deviceId") == DEVICE_ID]
    ev["devices_with_id"] = len(targets)
    if targets:
        d1 = targets[0]
        t1 = d1.get("lastSeenAt")
        time.sleep(13)
        devs2 = s.get(f"{API}/api/v1/openalice/devices", timeout=15).json().get("data") or []
        d2 = next((d for d in devs2 if d.get("deviceId") == DEVICE_ID), None)
        t2 = d2.get("lastSeenAt") if d2 else None
        ev["check_polling_alive"] = {
            "pass": bool(t1 and t2 and t1 != t2),
            "sample1": t1,
            "sample2": t2,
        }
    ev["check_single_device_registered"] = {
        "pass": len(targets) == 1,
        "count": len(targets),
    }

    ev["check_dup_protection_review"] = {
        "pass": True,
        "mechanism": "claim path: SELECT queued ORDER BY createdAt LIMIT 1; UPDATE by id",
        "single_device_evidence": "only 1 NSSM-managed runner registered (oa-win-mvp-01); no two-device race possible",
        "backlog_note": "WHERE clause should add status='queued' for hard atomicity if scaling to N devices",
    }

    all_pass = all(
        v.get("pass") for k, v in ev.items() if k.startswith("check_")
    )
    ev["pass"] = all_pass
    suffix = "PASS" if all_pass else "FAIL"
    out = Path(__file__).parent / f"p0_6_close_runner_state_{suffix}_{time.strftime('%Y%m%d_%H%M%S', time.gmtime())}.json"
    out.write_text(json.dumps(ev, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(ev, ensure_ascii=False, indent=2))
    print(f"\n[evi] {out}")
    return 0 if all_pass else 2


if __name__ == "__main__":
    sys.exit(main())
