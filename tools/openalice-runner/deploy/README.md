# OpenAlice Runner — Deploy bundle (P0.6)

Two-step Windows NSSM install for the OpenAlice runner. Split so that all
non-elevated work (filesystem, venv, register, key-staging, nssm download)
runs autonomously; only the actual SCM install step needs a UAC prompt.

## What you run

### Step 1 — non-admin (Claude Code can run this itself)

```powershell
powershell -ExecutionPolicy Bypass -File "C:\Users\User\Desktop\小楊機密\交易\IUF_TRADING_ROOM_APP\tools\openalice-runner\deploy\prep_openalice.ps1"
```

### Step 2 — admin (單一 UAC 彈窗 → 一行指令)

```powershell
# 以系統管理員開 PowerShell 後：
powershell -ExecutionPolicy Bypass -File "C:\Users\User\Desktop\小楊機密\交易\IUF_TRADING_ROOM_APP\tools\openalice-runner\deploy\admin_install_service.ps1"
```

(The legacy `install_openalice_service.ps1` still works — it's a shim that
calls prep first, then admin-install if elevated.)

## What each step does — in order

### prep_openalice.ps1 (non-admin)

1. Pre-checks: Python 3.11 / repo runner / owner creds (`C:\tmp\iuf_owner_creds.env`) / env template
2. Creates `C:\iuf\openalice-runner\`, `C:\iuf\secrets\`, `C:\iuf\nssm\`, `logs\`
3. Copies `openalice_runner.py` + `requirements.txt` + `llm\*.py` + `prompts\*.md` into deploy folder (pinned, not symlinked)
4. Creates `.venv` + `pip install -r requirements.txt`
5. Registers device → writes token to `C:\iuf\secrets\openalice_runner_creds.env`
6. Copies `openalice_llm.env.template` → `C:\iuf\secrets\openalice_llm.env` (preserves user edits if file already exists)
7. `icacls` locks both secret files to owner + SYSTEM only
8. Downloads NSSM 2.24 → `C:\iuf\nssm\nssm.exe`

### admin_install_service.ps1 (admin)

9. Verifies prep prereqs exist (venv / runner / nssm / creds / env)
10. Removes any existing `openalice-runner` service (idempotent)
11. Picks backend: `openai` if `OPENAI_API_KEY` set in env file AND kill-switch off, else `rule-template`
12. Installs service with `--poll-seconds 10 --max-jobs 5`, rotating 10 MB logs, 5 s crash-restart, `SERVICE_DEMAND_START`
13. Injects env vars from `openalice_llm.env` via NSSM `AppEnvironmentExtra`
14. Starts service + tails first 20 lines of stdout

## Phase 1 vs Phase 2

| Phase | LLM backend | Requires | When |
|---|---|---|---|
| **1 (default)** | `rule-template` (built-in stub, zero cost) | nothing | Run now. Prove daemon stays alive + polls + survives restart. |
| **2** | `openai` (live API, `gpt-5.4-mini` primary / `gpt-4o-mini` fallback) | `OPENAI_API_KEY` filled in `C:\iuf\secrets\openalice_llm.env` | After billing is active on the OpenAI account. Re-run `admin_install_service.ps1` — it auto-detects the key. |

## Where to fill OPENAI_API_KEY (Phase 2)

```powershell
notepad C:\iuf\secrets\openalice_llm.env
```

Fill exactly one line:
```
OPENAI_API_KEY=<paste key here, never paste into chat or repo>
```

Then re-run `admin_install_service.ps1`. Backend auto-flips to `openai`; on any
provider failure (timeout / HTTP 429 / schema violation) the registry falls
back to `rule-template` and annotates `payload.llm_meta.fallback_reason` so
reviewers see exactly why.

## Rollback

```powershell
& "C:\iuf\nssm\nssm.exe" stop openalice-runner
& "C:\iuf\nssm\nssm.exe" remove openalice-runner confirm
# optional — wipe deploy dir
Remove-Item C:\iuf\openalice-runner -Recurse -Force
Remove-Item C:\iuf\secrets -Recurse -Force
```

## Files on disk after install

```
C:\iuf\openalice-runner\
  openalice_runner.py          # pinned copy
  requirements.txt
  llm\                         # pluggable backend registry (rule_template + openai)
    __init__.py
    base.py
    rule_template.py
    openai_backend.py
  prompts\                     # prompt registry (markdown with YAML frontmatter)
    theme_summary.md
    company_note.md
  .venv\                       # python 3.11 virtualenv
  logs\
    stdout.log                 # [runner] polling ... claim ... submit ...
    stderr.log                 # tracebacks only
C:\iuf\secrets\
  openalice_runner_creds.env   # OPENALICE_DEVICE_TOKEN=<server-issued>
  openalice_llm.env            # OPENAI_API_KEY=<empty until Phase 2>
C:\iuf\nssm\
  nssm.exe
```

## Health checks

```powershell
# Service state
Get-Service openalice-runner

# Live tail
Get-Content -Wait -Tail 20 "C:\iuf\openalice-runner\logs\stdout.log"

# API side — device lastSeenAt should refresh every 10 s
```

## Hard-lines enforced

- 0 broker execution / 0 real order / 0 signal_cluster / 0 trade_plan_draft
- API keys never pass through chat, commit, log, screenshot, or shell history
- `.env` files NTFS-ACL'd to owner + SYSTEM only
- Phase 1 backend is `rule-template` — no external network calls to LLM providers
- On OpenAI failure, registry falls back to `rule-template` + annotates `llm_meta.fallback_reason`; draft still produced, never silently pretends LLM succeeded
- Kill-switch `OPENALICE_LLM_DISABLED=1` in env file forces rule-template regardless of configured backend, without stopping the service
- Admin guard `{Owner, Admin}` on `/api/v1/content-drafts/:id/approve|reject` — any other role → 403 `forbidden_role`
