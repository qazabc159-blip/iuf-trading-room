"""Backlog 1+2 verify (live-only, no DB role flip).

Railway pg service has no public TCP proxy → cannot flip Viewer→Analyst/Admin
from local. Analyst/Admin coverage documented via code-review of:
  apps/api/src/server.ts:2052
    const READ_DRAFT_ROLES = new Set(["Owner", "Admin", "Analyst"]);
  app.get("/api/v1/content-drafts", c => {
    if (!READ_DRAFT_ROLES.has(role)) return 403 forbidden_role;
    return 200 + drafts;
  });

Set-membership is structurally identical for all 3 roles — Owner-PASS proves
the success path; Viewer-403 proves the deny path. Adding/removing roles is
the only knob.

Live checks (6):
  1. anon GET /content-drafts             → 401
  2. Viewer GET /content-drafts           → 403 forbidden_role
  3. Owner GET /content-drafts            → 200
  4. Owner POST .../approve               → not 401/403 (P0.6 preserved)
  5. Viewer POST .../approve              → 403 forbidden_role (P0 hotfix preserved)
  6. NSSM single-device claim still works (E2E enqueue+draft) → race-safe claim
"""
from __future__ import annotations

import json
import os
import random
import string
import sys
import time
from pathlib import Path

import requests

API = os.environ.get("IUF_API_URL", "https://api.eycvector.com")
OWNER_CREDS = os.environ.get("IUF_OWNER_CREDS", r"C:\tmp\iuf_owner_creds.env")


def load_env(p: str) -> dict[str, str]:
    e: dict[str, str] = {}
    with open(p, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            e[k.strip()] = v.strip().strip('"').strip("'")
    return e


def rand_suffix(n: int = 8) -> str:
    return "".join(random.choices(string.ascii_lowercase + string.digits, k=n))


def main() -> int:
    ev: dict = {
        "ts_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "phase": "Backlog 1+2 verify (live-only)",
        "api": API,
        "code_review": {
            "READ_DRAFT_ROLES": ["Owner", "Admin", "Analyst"],
            "source": "apps/api/src/server.ts:2052",
            "rationale": (
                "set-membership identical for all 3 roles; Owner-PASS proves success path, "
                "Viewer-403 proves deny path; Analyst/Admin live flip blocked by no public DB proxy"
            ),
        },
        "checks": {},
    }

    owner = load_env(OWNER_CREDS)
    osess = requests.Session()
    olr = osess.post(
        f"{API}/auth/login",
        json={"email": owner["OWNER_EMAIL"], "password": owner.get("OWNER_PASSWORD") or owner.get("OWNER_PW")},
        timeout=15,
    )
    if olr.status_code != 200:
        ev["error"] = f"owner_login_status={olr.status_code}"
        Path(__file__).parent.joinpath(
            f"p0_backlog_1_2_FAIL_{time.strftime('%Y%m%d_%H%M%S', time.gmtime())}.json"
        ).write_text(json.dumps(ev, ensure_ascii=False, indent=2), encoding="utf-8")
        return 1
    print("[o.login] OK")

    iv = osess.post(f"{API}/auth/issue-invite", json={"ttlMinutes": 30}, timeout=15)
    code = iv.json().get("data", {}).get("code")
    vsess = requests.Session()
    vemail = f"v-bk12-{rand_suffix()}@iuf.local"
    vsess.post(
        f"{API}/auth/register-with-invite",
        json={"email": vemail, "password": "P!" + rand_suffix(10), "inviteCode": code},
        timeout=15,
    )
    ev["viewer_email"] = vemail
    print(f"[v.reg] {vemail}")

    drafts = osess.get(f"{API}/api/v1/content-drafts?limit=5", timeout=10)
    draft_id = "00000000-0000-4000-8000-000000000000"
    if drafts.status_code == 200:
        data = drafts.json().get("data") or []
        if data:
            draft_id = data[0]["id"]
    ev["draft_under_test"] = draft_id

    # 1. anon GET → 401
    r = requests.get(f"{API}/api/v1/content-drafts", timeout=10)
    ev["checks"]["1_anon_get_401"] = {"pass": r.status_code == 401, "status": r.status_code}
    print(f"[1] anon = {r.status_code}")

    # 2. Viewer GET → 403 forbidden_role
    r = vsess.get(f"{API}/api/v1/content-drafts", timeout=10)
    body = r.json() if r.status_code == 403 else None
    ev["checks"]["2_viewer_get_403"] = {
        "pass": r.status_code == 403 and (body or {}).get("error") == "forbidden_role",
        "status": r.status_code, "body": body,
    }
    print(f"[2] viewer = {r.status_code} {body}")

    # 3. Owner GET → 200
    r = osess.get(f"{API}/api/v1/content-drafts?limit=1", timeout=10)
    ev["checks"]["3_owner_get_200"] = {"pass": r.status_code == 200, "status": r.status_code}
    print(f"[3] owner = {r.status_code}")

    # 4. Owner POST approve → not 401/403 (P0.6 admin guard preserved)
    r = osess.post(f"{API}/api/v1/content-drafts/{draft_id}/approve", timeout=10)
    ev["checks"]["4_owner_approve_not_401_403"] = {
        "pass": r.status_code not in (401, 403),
        "status": r.status_code,
    }
    print(f"[4] owner approve = {r.status_code}")

    # 5. Viewer POST approve → 403 forbidden_role (P0 hotfix preserved)
    r = vsess.post(f"{API}/api/v1/content-drafts/{draft_id}/approve", timeout=10)
    body = r.json() if r.status_code == 403 else None
    ev["checks"]["5_viewer_approve_403"] = {
        "pass": r.status_code == 403 and (body or {}).get("error") == "forbidden_role",
        "status": r.status_code, "body": body,
    }
    print(f"[5] viewer approve = {r.status_code}")

    # 6. NSSM single-device claim still works — enqueue 1 theme_summary, expect draft
    themes = osess.get(f"{API}/api/v1/themes", timeout=15).json().get("data") or []
    recent = osess.get(f"{API}/api/v1/content-drafts?limit=200", timeout=15).json().get("data") or []
    busy = {d["targetEntityId"] for d in recent if d.get("targetTable") == "theme_summaries" and d.get("status") != "rejected"}
    theme = next((t for t in themes if t.get("id") not in busy), None) or (themes[0] if themes else None)
    if theme:
        enq = osess.post(
            f"{API}/api/v1/openalice/jobs",
            json={
                "taskType": "theme_summary",
                "schemaName": "theme_summary_v1",
                "instructions": "backlog 1+2 verify — race-safe claim still works",
                "contextRefs": [],
                "parameters": {
                    "themeId": theme["id"],
                    "themeName": theme.get("name") or "theme",
                    "companyCount": int(theme.get("companyCount") or 0),
                },
            },
            timeout=15,
        )
        job_id = ((enq.json().get("data") or {}).get("id")
                  or (enq.json().get("data") or {}).get("jobId"))
        draft = None
        for _ in range(60):
            time.sleep(1)
            ds = osess.get(f"{API}/api/v1/content-drafts?limit=20", timeout=10).json().get("data") or []
            for d in ds:
                if d.get("sourceJobId") == job_id:
                    draft = d
                    break
            if draft:
                break
        ev["checks"]["6_nssm_claim_still_works"] = {
            "pass": bool(draft),
            "job_id": job_id,
            "draft_id": (draft or {}).get("id"),
        }
        print(f"[6] runner E2E = {bool(draft)} draftId={(draft or {}).get('id')}")
    else:
        ev["checks"]["6_nssm_claim_still_works"] = {"pass": False, "reason": "no_theme"}

    all_pass = all(c.get("pass") for c in ev["checks"].values())
    ev["pass"] = all_pass
    suffix = "PASS" if all_pass else "FAIL"
    out = Path(__file__).parent / f"p0_backlog_1_2_{suffix}_{time.strftime('%Y%m%d_%H%M%S', time.gmtime())}.json"
    out.write_text(json.dumps(ev, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n[evi] {out}")
    print(f"[ALL] {suffix}")
    return 0 if all_pass else 2


if __name__ == "__main__":
    sys.exit(main())
