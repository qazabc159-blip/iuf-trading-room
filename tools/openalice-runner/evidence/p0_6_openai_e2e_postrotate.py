"""P0.6 close — post-key-rotation OpenAI E2E (NSSM-driven).

Enqueues 1 theme_summary job, waits for the NSSM-managed runner to claim
and submit, then asserts:
  - draft.payload.llm_meta.provider == "openai"
  - draft.payload.llm_meta.fallback_from is None
  - draft.payload.llm_meta.fallback_reason is None

Then approves the draft (full chain to formal table) and re-asserts the
final approved row preserves provider=openai metadata.

No secrets logged. No fallback acceptable.
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import requests

API = "https://api.eycvector.com"
OWNER_CREDS = r"C:\tmp\iuf_owner_creds.env"


def load_env(p: str) -> dict[str, str]:
    e: dict[str, str] = {}
    with open(p, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                e[k.strip()] = v.strip().strip('"').strip("'")
    return e


def main() -> int:
    ev: dict = {
        "ts_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "phase": "P0.6 close — post-rotate OpenAI E2E",
    }

    o = load_env(OWNER_CREDS)
    s = requests.Session()
    lr = s.post(
        f"{API}/auth/login",
        json={"email": o["OWNER_EMAIL"], "password": o.get("OWNER_PASSWORD") or o.get("OWNER_PW")},
        timeout=15,
    )
    if lr.status_code != 200:
        ev["error"] = f"login_failed status={lr.status_code}"
        Path(__file__).parent.joinpath(
            f"p0_6_openai_e2e_postrotate_FAIL_{time.strftime('%Y%m%d_%H%M%S', time.gmtime())}.json"
        ).write_text(json.dumps(ev, ensure_ascii=False, indent=2), encoding="utf-8")
        return 1

    themes = (s.get(f"{API}/api/v1/themes", timeout=15).json().get("data") or [])
    recent = (s.get(f"{API}/api/v1/content-drafts?limit=200", timeout=15).json().get("data") or [])
    busy = {d["targetEntityId"] for d in recent if d.get("targetTable") == "theme_summaries" and d.get("status") != "rejected"}
    theme = next((t for t in themes if t.get("id") not in busy), None) or (themes[0] if themes else None)
    if not theme:
        ev["error"] = "no_theme_available"
        Path(__file__).parent.joinpath(
            f"p0_6_openai_e2e_postrotate_FAIL_{time.strftime('%Y%m%d_%H%M%S', time.gmtime())}.json"
        ).write_text(json.dumps(ev, ensure_ascii=False, indent=2), encoding="utf-8")
        return 1

    ev["theme_id"] = theme["id"]
    ev["theme_name"] = theme.get("name")

    enq = s.post(
        f"{API}/api/v1/openalice/jobs",
        json={
            "taskType": "theme_summary",
            "schemaName": "theme_summary_v1",
            "instructions": "P0.6 close — post-rotate OpenAI live verify (provider=openai required, no fallback)",
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
    ev["enqueued_job_id"] = job_id
    ev["enqueue_status"] = enq.status_code
    print(f"[enq] jobId={job_id} status={enq.status_code} theme={theme.get('name')}")

    # Poll drafts directly (no GET /openalice/jobs/:id endpoint exists).
    draft = None
    for i in range(45):
        time.sleep(1)
        drafts = (s.get(f"{API}/api/v1/content-drafts?limit=30", timeout=10).json().get("data") or [])
        for d in drafts:
            if d.get("sourceJobId") == job_id:
                draft = d
                break
        if draft:
            print(f"[draft] tick={i}s draftId={draft.get('id')}")
            break

    if not draft:
        ev["error"] = "draft_not_found_within_45s"
        Path(__file__).parent.joinpath(
            f"p0_6_openai_e2e_postrotate_FAIL_{time.strftime('%Y%m%d_%H%M%S', time.gmtime())}.json"
        ).write_text(json.dumps(ev, ensure_ascii=False, indent=2), encoding="utf-8")
        return 2

    payload = draft.get("payload") or {}
    meta = (payload if isinstance(payload, dict) else {}).get("llm_meta") or {}
    ev["draft_id"] = draft["id"]
    ev["draft_status"] = draft.get("status")
    ev["llm_meta"] = {
        "provider": meta.get("provider"),
        "model": meta.get("model"),
        "fallback_from": meta.get("fallback_from"),
        "fallback_reason": (meta.get("fallback_reason") or "")[:80] if meta.get("fallback_reason") else None,
        "openai_status": meta.get("openai_status"),
    }
    print(f"[meta] {ev['llm_meta']}")

    is_openai = meta.get("provider") == "openai"
    fb_reason = meta.get("fallback_reason")
    no_fallback = (
        meta.get("fallback_from") is None
        and (fb_reason is None or fb_reason == "")
    )
    ev["check_provider_openai"] = {"pass": is_openai}
    ev["check_no_fallback"] = {"pass": no_fallback}

    if is_openai and no_fallback:
        ar = s.post(f"{API}/api/v1/content-drafts/{draft['id']}/approve", timeout=15)
        ev["approve_status"] = ar.status_code
        ar_body = ar.json() if ar.headers.get("content-type", "").startswith("application/json") else None
        ev["approve_body"] = ar_body
        ev["check_approve_chain"] = {"pass": ar.status_code == 200}
        print(f"[approve] status={ar.status_code}")

        post = s.get(f"{API}/api/v1/content-drafts/{draft['id']}", timeout=10)
        if post.status_code == 200:
            pd = (post.json().get("data") or {})
            pmeta = ((pd.get("payload") or {}) if isinstance(pd.get("payload"), dict) else {}).get("llm_meta") or {}
            ev["approved_meta"] = {
                "provider": pmeta.get("provider"),
                "model": pmeta.get("model"),
                "fallback_from": pmeta.get("fallback_from"),
            }
            ev["check_approved_meta_preserved"] = {
                "pass": pmeta.get("provider") == "openai" and pmeta.get("fallback_from") is None
            }
    else:
        ev["check_approve_chain"] = {"pass": None, "skip": "provider/fallback assertion failed"}

    all_pass = all(
        v.get("pass") is True
        for k, v in ev.items()
        if k.startswith("check_") and isinstance(v, dict) and v.get("pass") is not None
    )
    ev["pass"] = all_pass
    suffix = "PASS" if all_pass else "FAIL"
    out = Path(__file__).parent / f"p0_6_openai_e2e_postrotate_{suffix}_{time.strftime('%Y%m%d_%H%M%S', time.gmtime())}.json"
    out.write_text(json.dumps(ev, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(ev, ensure_ascii=False, indent=2))
    print(f"\n[evi] {out}")
    return 0 if all_pass else 2


if __name__ == "__main__":
    sys.exit(main())
