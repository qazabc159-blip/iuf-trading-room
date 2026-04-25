#!/usr/bin/env python3
"""
OpenAlice Windows Runner — MVP (P0-A)

Polls the IUF Trading Room API for content-generation jobs, produces text via
a pluggable LLM backend (default: rule-template), and submits results back.

Scope-locked (P0-B): only theme_summary and company_note task types are
processed. Other task types are released back to queue without action.

Secrets:
  - device token (--token): loaded from --creds file or OPENALICE_DEVICE_TOKEN env
  - LLM API keys: ANTHROPIC_API_KEY / OPENAI_API_KEY / OLLAMA_BASE_URL env only
  - Never logged or written to evidence files by this runner.

Usage:
  python openalice_runner.py register --api https://api.eycvector.com \\
      --device-id oa-win-mvp-01 --device-name "Desk-Windows" \\
      --workspace primary-desk --owner-creds C:/tmp/iuf_owner_creds.env \\
      --out-creds C:/tmp/iuf_oa_runner_creds.env

  python openalice_runner.py run --api https://api.eycvector.com \\
      --device-id oa-win-mvp-01 --creds C:/tmp/iuf_oa_runner_creds.env \\
      --llm rule-template --poll-seconds 10 --max-jobs 5
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from typing import Any

import requests

# Ensure `llm` package is importable regardless of cwd when launched under NSSM.
_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
if _THIS_DIR not in sys.path:
    sys.path.insert(0, _THIS_DIR)

from llm import generate as llm_generate, kill_switch_on  # noqa: E402


# ──────────────────────────────────────────────────────────────────────────────
# Scope-lock (P0-B)
SUPPORTED_TASK_TYPES = {"theme_summary", "company_note", "daily_brief"}


# ──────────────────────────────────────────────────────────────────────────────
# Credentials I/O


def _load_env_file(path: str) -> dict[str, str]:
    env: dict[str, str] = {}
    if not path or not os.path.exists(path):
        return env
    with open(path, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            env[key.strip()] = value.strip().strip('"').strip("'")
    return env


def _write_creds_file(path: str, data: dict[str, str]) -> None:
    with open(path, "w", encoding="utf-8") as fh:
        for key, value in data.items():
            fh.write(f"{key}={value}\n")
    try:
        os.chmod(path, 0o600)
    except Exception:
        # Windows doesn't honour POSIX mode fully — rely on user's ACLs.
        pass


# ──────────────────────────────────────────────────────────────────────────────
# LLM backend bridge — delegates to the `llm` package registry.
# Registry handles: primary/fallback chain, kill-switch, provider validation,
# retry+backoff+timeout, and llm_meta annotation. This runner only forwards.


def run_llm(
    backend: str, task_type: str, params: dict[str, Any], context: dict[str, Any]
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Returns (structured_output, llm_meta). Never raises for provider-side
    errors — those become rule-template fallback results with fallback_reason
    in llm_meta, so we still produce a draft row (transparent about route)."""
    result = llm_generate(backend, task_type, params, context)
    return result.structured, dict(result.meta)


# ──────────────────────────────────────────────────────────────────────────────
# API client


class OpenAliceClient:
    def __init__(self, api: str, device_id: str, device_token: str | None = None, owner_cookie: str | None = None) -> None:
        self.api = api.rstrip("/")
        self.device_id = device_id
        self.device_token = device_token
        self.owner_cookie = owner_cookie
        self.session = requests.Session()

    def _auth_headers(self) -> dict[str, str]:
        if not self.device_token:
            raise SystemExit("device_token missing — register first or load creds.")
        return {
            "Authorization": f"Bearer {self.device_token}",
            "x-device-id": self.device_id,
            "Content-Type": "application/json",
        }

    def _owner_headers(self) -> dict[str, str]:
        if not self.owner_cookie:
            raise SystemExit("owner_cookie missing — register requires an authenticated owner session cookie.")
        return {
            "Cookie": self.owner_cookie,
            "Content-Type": "application/json",
        }

    def register(self, device_name: str, capabilities: list[str]) -> dict[str, Any]:
        url = f"{self.api}/api/v1/openalice/register"
        body = {"deviceId": self.device_id, "deviceName": device_name, "capabilities": capabilities}
        resp = self.session.post(url, headers=self._owner_headers(), json=body, timeout=30)
        if resp.status_code >= 400:
            raise SystemExit(f"register failed: {resp.status_code} {resp.text[:200]}")
        return resp.json()["data"]

    def claim(self) -> dict[str, Any] | None:
        url = f"{self.api}/api/v1/openalice/jobs/claim"
        resp = self.session.post(url, headers=self._auth_headers(), json={"deviceId": self.device_id}, timeout=30)
        if resp.status_code == 204:
            return None
        if resp.status_code >= 400:
            raise SystemExit(f"claim failed: {resp.status_code} {resp.text[:200]}")
        payload = resp.json()
        return payload.get("data")

    def heartbeat(self, job_id: str) -> None:
        url = f"{self.api}/api/v1/openalice/jobs/{job_id}/heartbeat"
        resp = self.session.post(url, headers=self._auth_headers(), json={}, timeout=15)
        if resp.status_code >= 400:
            print(f"[runner] heartbeat warn: {resp.status_code} {resp.text[:120]}")

    def submit(
        self,
        job_id: str,
        status: str,
        schema_name: str,
        structured: dict[str, Any] | None,
        warnings: list[str],
        llm_meta: dict[str, Any] | None = None,
    ) -> None:
        url = f"{self.api}/api/v1/openalice/jobs/{job_id}/result"
        body: dict[str, Any] = {
            "jobId": job_id,
            "status": status,
            "schemaName": schema_name,
            "warnings": warnings,
            "artifacts": [],
        }
        if structured is not None:
            body["structured"] = structured
        if llm_meta:
            body["llmMeta"] = llm_meta
        resp = self.session.post(url, headers=self._auth_headers(), json=body, timeout=30)
        if resp.status_code >= 400:
            raise SystemExit(f"submit failed: {resp.status_code} {resp.text[:200]}")


# ──────────────────────────────────────────────────────────────────────────────
# Register flow — needs an owner-session cookie once; token returned is saved.


def _owner_login(api: str, owner_creds_path: str) -> str:
    env = _load_env_file(owner_creds_path)
    email = env.get("OWNER_EMAIL") or os.environ.get("OWNER_EMAIL")
    # accept both OWNER_PASSWORD (canonical) and OWNER_PW (legacy key in existing creds file).
    password = (
        env.get("OWNER_PASSWORD")
        or env.get("OWNER_PW")
        or os.environ.get("OWNER_PASSWORD")
        or os.environ.get("OWNER_PW")
    )
    if not email or not password:
        raise SystemExit("OWNER_EMAIL/OWNER_PASSWORD missing in creds file/env.")

    resp = requests.post(
        f"{api.rstrip('/')}/auth/login",
        json={"email": email, "password": password},
        timeout=30,
    )
    if resp.status_code >= 400:
        raise SystemExit(f"owner login failed: {resp.status_code} {resp.text[:160]}")
    # requests.Session would parse cookies; use resp.cookies jar to extract.
    session_cookie = resp.cookies.get("iuf_session")
    if not session_cookie:
        # fallback: parse raw header
        raw = resp.headers.get("set-cookie") or ""
        for part in raw.split(","):
            part = part.strip()
            if part.startswith("iuf_session="):
                return part.split(";", 1)[0]
        raise SystemExit("owner login returned no iuf_session cookie.")
    return f"iuf_session={session_cookie}"


def cmd_register(args: argparse.Namespace) -> int:
    cookie = _owner_login(args.api, args.owner_creds)
    client = OpenAliceClient(args.api, args.device_id, owner_cookie=cookie)
    data = client.register(args.device_name, args.capabilities)
    token = data.get("deviceToken")
    if not token:
        raise SystemExit("register succeeded but deviceToken missing from response.")
    _write_creds_file(args.out_creds, {"OPENALICE_DEVICE_TOKEN": token, "OPENALICE_DEVICE_ID": args.device_id})
    print(f"[runner] registered deviceId={args.device_id} workspace={data.get('workspaceSlug')} tokenFile={args.out_creds}")
    print("[runner] token length (not value):", len(token))
    return 0


# ──────────────────────────────────────────────────────────────────────────────
# Run loop — claim/execute/submit


def cmd_run(args: argparse.Namespace) -> int:
    creds = _load_env_file(args.creds)
    token = creds.get("OPENALICE_DEVICE_TOKEN") or os.environ.get("OPENALICE_DEVICE_TOKEN")
    if not token:
        raise SystemExit(f"OPENALICE_DEVICE_TOKEN missing — register first ({args.creds}).")
    client = OpenAliceClient(args.api, args.device_id, device_token=token)

    processed = 0
    idle_ticks = 0

    while processed < args.max_jobs:
        job = client.claim()
        if not job:
            idle_ticks += 1
            if args.exit_when_idle and idle_ticks >= args.idle_ticks_before_exit:
                print(f"[runner] idle for {idle_ticks} ticks — exiting.")
                return 0
            time.sleep(max(1, int(args.poll_seconds)))
            continue

        idle_ticks = 0
        job_id = job.get("jobId")
        task_type = job.get("taskType")
        schema_name = job.get("schemaName", "")
        params = job.get("parameters") or {}
        context = {"contextRefs": job.get("contextRefs") or []}

        print(f"[runner] claimed jobId={job_id} taskType={task_type}")

        if task_type not in SUPPORTED_TASK_TYPES:
            print(f"[runner] scope-lock: task_type '{task_type}' not supported — reporting validation_failed.")
            client.submit(
                job_id=job_id,
                status="validation_failed",
                schema_name=schema_name,
                structured=None,
                warnings=[f"runner-scope-lock: {task_type} not handled by P0 runner"],
            )
            processed += 1
            continue

        try:
            client.heartbeat(job_id)
            structured, llm_meta = run_llm(args.llm, task_type, params, context)
            client.submit(
                job_id=job_id,
                status="draft_ready",
                schema_name=schema_name,
                structured=structured,
                warnings=[],
                llm_meta=llm_meta,
            )
            fb = llm_meta.get("fallback_reason") if isinstance(llm_meta, dict) else None
            effective = llm_meta.get("provider") if isinstance(llm_meta, dict) else args.llm
            suffix = f" fallback_from={llm_meta.get('fallback_from')}" if fb else ""
            print(
                f"[runner] submitted jobId={job_id} status=draft_ready provider={effective}{suffix}"
            )
        except SystemExit:
            raise
        except Exception as exc:  # noqa: BLE001
            print(f"[runner] error jobId={job_id}: {exc}")
            client.submit(
                job_id=job_id,
                status="failed",
                schema_name=schema_name,
                structured=None,
                warnings=[str(exc)[:200]],
            )

        processed += 1

    print(f"[runner] processed {processed} jobs — exiting.")
    return 0


# ──────────────────────────────────────────────────────────────────────────────
# CLI


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="openalice_runner")
    sub = p.add_subparsers(dest="cmd", required=True)

    reg = sub.add_parser("register", help="Register device and save token to creds file.")
    reg.add_argument("--api", required=True)
    reg.add_argument("--device-id", required=True)
    reg.add_argument("--device-name", required=True)
    reg.add_argument("--workspace", default="primary-desk")
    reg.add_argument("--capabilities", nargs="*", default=["theme_summary", "company_note", "daily_brief"])
    reg.add_argument("--owner-creds", required=True, help="Path to env file with OWNER_EMAIL/OWNER_PASSWORD.")
    reg.add_argument("--out-creds", required=True, help="Path to write runner token (600).")
    reg.set_defaults(func=cmd_register)

    run = sub.add_parser("run", help="Claim jobs, generate content, submit results.")
    run.add_argument("--api", required=True)
    run.add_argument("--device-id", required=True)
    run.add_argument("--creds", required=True, help="Path to env file with OPENALICE_DEVICE_TOKEN.")
    run.add_argument("--llm", default="rule-template", choices=["rule-template", "openai"])
    run.add_argument("--poll-seconds", type=int, default=10)
    run.add_argument("--max-jobs", type=int, default=1)
    run.add_argument("--exit-when-idle", action="store_true")
    run.add_argument("--idle-ticks-before-exit", type=int, default=6)
    run.set_defaults(func=cmd_run)

    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
