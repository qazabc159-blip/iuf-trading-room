"""P0.6 live E2E — enqueue 2 jobs, run runner (rule-template), approve 1, reject 1.

Reads owner creds from C:\\tmp\\iuf_owner_creds.env (never prints them).
Writes a timestamped evidence JSON to evidence/p0_6_evidence_<ts>.json.
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
DEPLOY_ROOT = Path(r"C:\iuf\openalice-runner")
RUNNER_PY = DEPLOY_ROOT / ".venv" / "Scripts" / "python.exe"
RUNNER_APP = DEPLOY_ROOT / "openalice_runner.py"
DEVICE_CREDS = r"C:\iuf\secrets\openalice_runner_creds.env"
DEVICE_ID = "oa-win-mvp-01"


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


def main() -> int:
    evidence: dict[str, object] = {
        "ts_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "phase": "P0.6 review-flow E2E",
        "backend": "rule-template (OpenAI billing not active)",
    }

    owner = load_env(OWNER_CREDS)
    email = owner.get("OWNER_EMAIL")
    password = owner.get("OWNER_PASSWORD") or owner.get("OWNER_PW")
    if not email or not password:
        print("[evi] owner creds missing", file=sys.stderr)
        return 2

    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    if r.status_code >= 400:
        print(f"[evi] owner login failed {r.status_code}: {r.text[:160]}", file=sys.stderr)
        return 3
    sess = s.get(f"{API}/api/v1/session", timeout=15).json().get("data") or {}
    evidence["session_role"] = (sess.get("user") or {}).get("role")
    evidence["session_workspace"] = (sess.get("workspace") or {}).get("slug")

    # Pick a real theme + company so approve's FK-bound insert can land.
    themes = s.get(f"{API}/api/v1/themes", timeout=30).json().get("data") or []
    companies = s.get(f"{API}/api/v1/companies?limit=20", timeout=30).json().get("data") or []
    if not themes or not companies:
        print("[evi] no themes/companies", file=sys.stderr)
        return 4
    # Skip target entities that already have a recent awaiting/approved draft
    # (P0-C 24h dedupe window would short-circuit and starve this test).
    recent = s.get(f"{API}/api/v1/content-drafts?limit=200", timeout=30).json().get("data") or []
    busy_theme_ids = {d["targetEntityId"] for d in recent if d.get("targetTable") == "theme_summaries" and d.get("status") != "rejected"}
    busy_company_ids = {d["targetEntityId"] for d in recent if d.get("targetTable") == "company_notes" and d.get("status") != "rejected"}
    theme = next((t for t in themes if t.get("id") not in busy_theme_ids), themes[0])
    company = next((c for c in companies if c.get("id") not in busy_company_ids), companies[0])
    theme_id = theme.get("id")
    company_id = company.get("id")
    evidence["chosen_theme"] = {"id": theme_id, "name": theme.get("name")}
    evidence["chosen_company"] = {"id": company_id, "ticker": company.get("ticker"), "name": company.get("nameZh") or company.get("name")}

    # Enqueue 2 jobs.
    def enqueue(task_type: str, params: dict, instructions: str) -> dict:
        r = s.post(
            f"{API}/api/v1/openalice/jobs",
            json={
                "taskType": task_type,
                "schemaName": f"{task_type}_v1",
                "instructions": instructions,
                "contextRefs": [],
                "parameters": params,
            },
            timeout=30,
        )
        if r.status_code >= 400:
            raise RuntimeError(f"enqueue {task_type}: {r.status_code} {r.text[:160]}")
        return r.json()["data"]

    job_theme = enqueue(
        "theme_summary",
        {"themeId": theme_id, "themeName": theme.get("name") or "theme", "companyCount": int(theme.get("companyCount") or 0)},
        "P0.6 live E2E — theme_summary seed",
    )
    job_co = enqueue(
        "company_note",
        {"companyId": company_id, "companyName": company.get("nameZh") or company.get("name") or "company", "ticker": company.get("ticker") or ""},
        "P0.6 live E2E — company_note seed",
    )
    evidence["enqueued_jobs"] = {"theme_summary": job_theme.get("id") or job_theme.get("jobId"), "company_note": job_co.get("id") or job_co.get("jobId")}

    # Drive runner one-shot: drain queue, exit on idle.
    print("[evi] driving runner one-shot ...")
    proc = subprocess.run(
        [
            str(RUNNER_PY), str(RUNNER_APP), "run",
            "--api", API,
            "--device-id", DEVICE_ID,
            "--creds", DEVICE_CREDS,
            "--llm", "rule-template",
            "--poll-seconds", "3",
            "--max-jobs", "10",
            "--exit-when-idle",
            "--idle-ticks-before-exit", "3",
        ],
        capture_output=True, text=True, timeout=180,
    )
    evidence["runner_stdout"] = proc.stdout
    evidence["runner_stderr"] = proc.stderr
    if proc.returncode != 0:
        print(f"[evi] runner nonzero exit {proc.returncode}; stderr={proc.stderr[:200]}", file=sys.stderr)

    # List ALL drafts (any status) — awaiting filter may miss drafts we've since
    # approved; we need the full view to match sourceJobId → our jobs.
    our_job_ids = set(evidence["enqueued_jobs"].values())
    r = s.get(f"{API}/api/v1/content-drafts?limit=100", timeout=30)
    drafts = (r.json().get("data") or []) if r.status_code < 400 else []
    evidence["drafts_after_run"] = [
        {
            "id": d.get("id"),
            "status": d.get("status"),
            "targetTable": d.get("targetTable"),
            "targetEntityId": d.get("targetEntityId"),
            "sourceJobId": d.get("sourceJobId"),
            "payload_keys": sorted(list((d.get("payload") or {}).keys())),
            "has_llm_meta": isinstance((d.get("payload") or {}).get("llm_meta"), dict),
            "llm_meta_provider": ((d.get("payload") or {}).get("llm_meta") or {}).get("provider"),
        }
        for d in drafts
        if d.get("sourceJobId") in our_job_ids
    ]

    # Pick the drafts that correspond to our freshly-enqueued jobs.
    target_drafts = [d for d in drafts if d.get("sourceJobId") in our_job_ids and d.get("status") == "awaiting_review"]
    if len(target_drafts) < 2:
        evidence["_warn"] = f"only {len(target_drafts)} of our 2 drafts landed in awaiting_review"
    theme_draft = next((d for d in target_drafts if d.get("targetTable") == "theme_summaries"), None)
    co_draft = next((d for d in target_drafts if d.get("targetTable") == "company_notes"), None)

    # Approve the theme draft; reject the company draft.
    if theme_draft:
        r = s.post(f"{API}/api/v1/content-drafts/{theme_draft['id']}/approve", timeout=30)
        evidence["approve"] = {
            "http": r.status_code,
            "body": r.json() if r.headers.get("content-type", "").startswith("application/json") else r.text[:200],
            "draft_id": theme_draft["id"],
        }
    if co_draft:
        r = s.post(
            f"{API}/api/v1/content-drafts/{co_draft['id']}/reject",
            json={"reason": "P0.6 live E2E — reviewer rejects placeholder company note"},
            timeout=30,
        )
        evidence["reject"] = {
            "http": r.status_code,
            "body": r.json() if r.headers.get("content-type", "").startswith("application/json") else r.text[:200],
            "draft_id": co_draft["id"],
        }

    # Re-list drafts to confirm status transitions.
    r = s.get(f"{API}/api/v1/content-drafts?limit=50", timeout=30)
    final = (r.json().get("data") or []) if r.status_code < 400 else []
    evidence["final_status_of_our_drafts"] = [
        {"id": d.get("id"), "status": d.get("status"), "rejectReason": d.get("rejectReason"), "approvedRefId": d.get("approvedRefId")}
        for d in final if d.get("id") in {theme_draft and theme_draft["id"], co_draft and co_draft["id"]}
    ]

    out_dir = Path(__file__).parent
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"p0_6_evidence_{time.strftime('%Y%m%d_%H%M%S', time.gmtime())}.json"
    out_path.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[evi] wrote {out_path}")
    print(json.dumps({k: v for k, v in evidence.items() if k not in {"runner_stdout", "runner_stderr"}}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
