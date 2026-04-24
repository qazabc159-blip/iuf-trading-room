# OpenAlice Runner — Deploy bundle (P0.6)

One-shot Windows NSSM install for the OpenAlice runner.

## What you run

```powershell
# In an **Administrator** PowerShell window:
powershell -ExecutionPolicy Bypass -File "C:\Users\User\Desktop\小楊機密\交易\IUF_TRADING_ROOM_APP\tools\openalice-runner\deploy\install_openalice_service.ps1"
```

One command. Takes ~60s on a fresh host (NSSM download + venv + register + service install).

## What it does — in order

1. Pre-check: admin / Python 3.11 / repo runner / owner creds (`C:\tmp\iuf_owner_creds.env`).
2. Create `C:\iuf\openalice-runner\`, `C:\iuf\secrets\`, `C:\iuf\nssm\`, `C:\iuf\openalice-runner\logs\`.
3. Copy `openalice_runner.py` + `requirements.txt` into the deploy folder (pinned copy, not repo symlink).
4. Create `.venv` + `pip install -r requirements.txt`.
5. Run `openalice_runner.py register` → writes device token to `C:\iuf\secrets\openalice_runner_creds.env`.
6. Copy `openalice_llm.env.template` → `C:\iuf\secrets\openalice_llm.env` (empty values).
7. `icacls` lock both secret files to owner + SYSTEM only.
8. Download NSSM 2.24 → `C:\iuf\nssm\nssm.exe`.
9. Remove any existing `openalice-runner` service (idempotent).
10. Install service with `--llm rule-template --poll-seconds 10 --max-jobs 5`, rotating 10 MB logs, 5 s crash-restart.
11. Start service (Phase 1: `SERVICE_DEMAND_START`; you flip to auto-start after 2 min healthy window).

## Phase 1 vs Phase 2

| Phase | LLM backend | Requires | When |
|---|---|---|---|
| **1 (this script)** | `rule-template` (built-in stub, zero cost) | nothing | Run now. Prove daemon stays alive + polls + survives restart. |
| **2 (switch_to_anthropic.ps1)** | `anthropic` (live API) | `ANTHROPIC_API_KEY` filled in `C:\iuf\secrets\openalice_llm.env` + Elva ships adapter code | After Elva commits adapter + CI green. |

## Where to fill ANTHROPIC_API_KEY (Phase 2 only)

**Do not fill now.** Wait until Elva confirms adapter is on main.

When that time comes:

```powershell
# Open the protected env file with notepad (admin PS):
notepad C:\iuf\secrets\openalice_llm.env
```

Fill exactly one line:
```
ANTHROPIC_API_KEY=<paste key here, never paste into chat or repo>
```

Then run `switch_to_anthropic.ps1` (Elva will hand over).

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
  .venv\                       # python 3.11 virtualenv
  logs\
    stdout.log                 # [runner] polling ... claim ... submit ...
    stderr.log                 # tracebacks only
C:\iuf\secrets\
  openalice_runner_creds.env   # OPENALICE_DEVICE_TOKEN=<server-issued>
  openalice_llm.env            # ANTHROPIC_API_KEY=<empty until Phase 2>
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
# (run as owner, from any shell with the API cookie)
```

## Hard-lines enforced

- 0 broker execution / 0 real order / 0 signal_cluster / 0 trade_plan_draft
- API keys never pass through chat, commit, log, screenshot, or shell history
- `.env` files NTFS-ACL'd to owner + SYSTEM only
- Phase 1 backend is `rule-template` — no external network calls to LLM providers
- Service args are pinned in NSSM; no dynamic backend swap until Phase 2 script runs
