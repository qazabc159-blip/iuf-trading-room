"""P0 auth-bypass hotfix verification — 10-point checklist.

Verifies the production deploy of the cookie-based /api/v1/* middleware
(commit f684aa5+) closes the anonymous bypass and preserves legitimate
flows. No secrets logged; cookies redacted to length only.

Checks (must all PASS):
  1.  GET  /api/v1/content-drafts (anon, no cookie)             → 401
  2.  POST /api/v1/content-drafts/<uuid>/approve (anon)         → 401
  3.  Anon + x-user-role: Owner header                          → 401
  4.  /health                                                   → 200 (no auth)
  5.  Owner login + GET /api/v1/content-drafts                  → 200
  6.  Owner POST /api/v1/content-drafts/<uuid>/approve          → 200 or 409 (not 403/401)
  7.  Viewer cookie + POST .../approve                          → 403 forbidden_role
  8.  Viewer cookie + GET .../content-drafts                    → 200 (read allowed)
  9.  Cookie+x-user-role: Viewer (Owner trying to escalate)     → role-honored only as Owner
  10. /auth/me with no cookie                                   → 401
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


def rand_suffix(n: int = 8) -> str:
    return "".join(random.choices(string.ascii_lowercase + string.digits, k=n))


def main() -> int:
    evidence: dict = {
        "ts_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "phase": "P0 auth-bypass hotfix",
        "api": API,
        "checks": {},
    }

    # ── Owner login (used by 5/6/9) ─────────────────────────────────────────
    owner = load_env(OWNER_CREDS)
    osess = requests.Session()
    olr = osess.post(
        f"{API}/auth/login",
        json={
            "email": owner.get("OWNER_EMAIL"),
            "password": owner.get("OWNER_PASSWORD") or owner.get("OWNER_PW"),
        },
        timeout=15,
    )
    if olr.status_code != 200:
        evidence["error"] = "owner_login_failed"
        evidence["owner_login_status"] = olr.status_code
        out = Path(__file__).parent / f"p0_auth_hotfix_FAIL_{time.strftime('%Y%m%d_%H%M%S', time.gmtime())}.json"
        out.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"[err] owner login {olr.status_code}; wrote {out}")
        return 1
    print("[o.login] OK")

    # ── Provision viewer (issue invite + register) ─────────────────────────
    iv = osess.post(f"{API}/auth/issue-invite", json={"ttlMinutes": 30}, timeout=15)
    if iv.status_code != 200:
        evidence["error"] = "issue_invite_failed"
        evidence["issue_invite_status"] = iv.status_code
        out = Path(__file__).parent / f"p0_auth_hotfix_FAIL_{time.strftime('%Y%m%d_%H%M%S', time.gmtime())}.json"
        out.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"[err] invite {iv.status_code}; wrote {out}")
        return 1
    code = iv.json().get("data", {}).get("code")

    vsess = requests.Session()
    vemail = f"viewer-hotfix-{rand_suffix()}@iuf.local"
    vr = vsess.post(
        f"{API}/auth/register-with-invite",
        json={"email": vemail, "password": "Viewer!" + rand_suffix(6), "inviteCode": code},
        timeout=15,
    )
    if vr.status_code != 200:
        evidence["error"] = "viewer_register_failed"
        evidence["viewer_status"] = vr.status_code
        evidence["viewer_body"] = vr.text[:200]
        out = Path(__file__).parent / f"p0_auth_hotfix_FAIL_{time.strftime('%Y%m%d_%H%M%S', time.gmtime())}.json"
        out.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"[err] register {vr.status_code} {vr.text[:120]}; wrote {out}")
        return 1
    evidence["viewer"] = {"email": vemail, "role": vr.json().get("user", {}).get("role")}
    print(f"[v.reg] role={evidence['viewer']['role']}")

    # ── Pick a real draft id (need one for owner positive control) ─────────
    drafts = osess.get(f"{API}/api/v1/content-drafts?limit=5", timeout=10)
    draft_id = "00000000-0000-4000-8000-000000000000"
    awaiting_id = None
    if drafts.status_code == 200:
        data = drafts.json().get("data") or []
        if data:
            draft_id = data[0].get("id") or draft_id
            for d in data:
                if d.get("status") == "awaiting_review":
                    awaiting_id = d.get("id")
                    break
    evidence["draft_under_test"] = draft_id
    evidence["awaiting_id"] = awaiting_id

    # ── Check 1: anon GET /api/v1/content-drafts → 401 ────────────────────
    anon = requests.Session()
    r = anon.get(f"{API}/api/v1/content-drafts", timeout=10)
    evidence["checks"]["1_anon_get_drafts_401"] = {
        "pass": r.status_code == 401,
        "status": r.status_code,
        "body": r.text[:160],
    }
    print(f"[1] anon GET = {r.status_code}")

    # ── Check 2: anon POST /approve → 401 ─────────────────────────────────
    r = anon.post(f"{API}/api/v1/content-drafts/{draft_id}/approve", timeout=10)
    evidence["checks"]["2_anon_post_approve_401"] = {
        "pass": r.status_code == 401,
        "status": r.status_code,
        "body": r.text[:160],
    }
    print(f"[2] anon POST approve = {r.status_code}")

    # ── Check 3: anon + x-user-role: Owner → 401 ──────────────────────────
    r = requests.get(
        f"{API}/api/v1/content-drafts",
        headers={"x-user-role": "Owner"},
        timeout=10,
    )
    evidence["checks"]["3_anon_with_owner_header_401"] = {
        "pass": r.status_code == 401,
        "status": r.status_code,
        "body": r.text[:160],
    }
    print(f"[3] anon+role=Owner = {r.status_code}")

    # ── Check 4: /health → 200 ────────────────────────────────────────────
    r = requests.get(f"{API}/health", timeout=10)
    evidence["checks"]["4_health_200"] = {
        "pass": r.status_code == 200 and "status" in (r.json() or {}),
        "status": r.status_code,
        "build_commit": (r.json() or {}).get("build", {}).get("commit"),
    }
    print(f"[4] /health = {r.status_code}")

    # ── Check 5: Owner GET /api/v1/content-drafts → 200 ───────────────────
    r = osess.get(f"{API}/api/v1/content-drafts?limit=1", timeout=10)
    evidence["checks"]["5_owner_get_drafts_200"] = {
        "pass": r.status_code == 200,
        "status": r.status_code,
    }
    print(f"[5] owner GET = {r.status_code}")

    # ── Check 6: Owner POST /approve → not 401/403 ────────────────────────
    r = osess.post(f"{API}/api/v1/content-drafts/{draft_id}/approve", timeout=10)
    body = r.json() if r.headers.get("content-type", "").startswith("application/json") else None
    evidence["checks"]["6_owner_post_approve_not_401_403"] = {
        "pass": r.status_code not in (401, 403),
        "status": r.status_code,
        "body": body,
        "note": "Owner may legitimately get 200/404/409; only 401/403 = role gate misfire",
    }
    print(f"[6] owner POST approve = {r.status_code}")

    # ── Check 7: Viewer POST /approve → 403 forbidden_role ────────────────
    r = vsess.post(f"{API}/api/v1/content-drafts/{draft_id}/approve", timeout=10)
    body = None
    try:
        body = r.json()
    except Exception:
        body = {"raw": r.text[:200]}
    evidence["checks"]["7_viewer_post_approve_403"] = {
        "pass": r.status_code == 403 and (body or {}).get("error") == "forbidden_role",
        "status": r.status_code,
        "body": body,
    }
    print(f"[7] viewer POST approve = {r.status_code} {body}")

    # ── Check 8: Viewer GET /content-drafts → 200 (reads allowed) ────────
    r = vsess.get(f"{API}/api/v1/content-drafts?limit=1", timeout=10)
    evidence["checks"]["8_viewer_get_drafts_200"] = {
        "pass": r.status_code == 200,
        "status": r.status_code,
    }
    print(f"[8] viewer GET drafts = {r.status_code}")

    # ── Check 9: Owner with x-user-role:Viewer header (no env flag) ──────
    # Without AUTH_ALLOW_ROLE_OVERRIDE=1, header is ignored; Owner stays Owner.
    r = osess.post(
        f"{API}/api/v1/content-drafts/{draft_id}/approve",
        headers={"x-user-role": "Viewer"},
        timeout=10,
    )
    evidence["checks"]["9_owner_role_header_ignored"] = {
        "pass": r.status_code != 403,  # Owner role honored, not downgraded
        "status": r.status_code,
        "note": "AUTH_ALLOW_ROLE_OVERRIDE not set; header must be ignored",
    }
    print(f"[9] owner+role=Viewer header = {r.status_code} (expect not 403)")

    # ── Check 10: /auth/me without cookie → 401 ──────────────────────────
    r = requests.get(f"{API}/auth/me", timeout=10)
    evidence["checks"]["10_auth_me_no_cookie_401"] = {
        "pass": r.status_code == 401,
        "status": r.status_code,
    }
    print(f"[10] /auth/me no cookie = {r.status_code}")

    # ── Summary ───────────────────────────────────────────────────────────
    all_pass = all(c.get("pass") for c in evidence["checks"].values())
    evidence["pass"] = all_pass
    suffix = "PASS" if all_pass else "FAIL"
    out = Path(__file__).parent / f"p0_auth_hotfix_{suffix}_{time.strftime('%Y%m%d_%H%M%S', time.gmtime())}.json"
    out.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n[evi] wrote {out}")
    print(f"[ALL] {suffix}")
    return 0 if all_pass else 2


if __name__ == "__main__":
    sys.exit(main())
