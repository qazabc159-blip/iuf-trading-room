# OpenAlice Runner — Windows Daemonization Design (P0.5-5)

Status: proposal / ready-to-execute.
Author: Elva (team-lead).
Scope: turn the existing `python openalice_runner.py run ...` loop into a
persistent, crash-restarting, boot-surviving background process on Windows.
Hard-line: no runner code changes — this is a packaging concern only.

---

## Goals

1. Survive machine reboots (start automatically on boot).
2. Survive runner-process crashes (auto-restart within seconds).
3. Run without a logged-in interactive session (so the trader does not need
   to leave a console window open during the trading day).
4. Capture stdout/stderr to rolling log files for incident post-mortem.
5. Read secrets from environment / credentials file — never pass them as
   CLI args or log them.
6. Be removable with one command if something goes wrong.

Out of scope: HA across machines, remote control, containerization
(Docker-Windows is unnecessary complexity for a personal desktop runner).

---

## Options compared

| Option | Auto-start boot | Auto-restart crash | No interactive session | Log capture | Install effort | Code changes |
|---|---|---|---|---|---|---|
| A. Task Scheduler (`schtasks`) | yes (At startup trigger) | partial (retry rules) | yes (Run whether user logged on) | redirect stdout/err manually | built-in, ~1 cmd | none |
| B. **NSSM** (Non-Sucking SM) | yes (service auto) | **yes** (built-in throttled) | yes (Local System / service user) | **built-in** rotating logs | single install + 2 cmds | none |
| C. pm2 + pm2-windows-startup | yes | yes | depends on user | built-in | Node.js dep already; pm2 install | none (pm2 wraps python) |
| D. node-windows / python win32 service | yes | yes | yes | custom code | moderate + boilerplate | yes (not acceptable) |

---

## Recommendation: **NSSM**

Rationale:
  - Purpose-built for exactly this problem (wrap arbitrary binary as service).
  - Zero runner-code change. Pure packaging.
  - Restart policy and rotating log files ship built-in.
  - Runs as a real Windows Service → no interactive session required,
    survives user logout.
  - Trivial to remove (`nssm remove openalice-runner confirm`).
  - Maintained, widely used in Windows sysadmin circles, permissive license.

Fallback (only if NSSM install is blocked on this machine): **Task Scheduler**
via `schtasks` — less robust restart semantics but built-in, no extra install.

---

## NSSM install + service plan

### 1. Prerequisites on the Windows host

```
# one-time
choco install nssm          # or download nssm from https://nssm.cc
```

Assume:
  - Runner lives at `C:\iuf\openalice-runner\`
  - Python venv at `C:\iuf\openalice-runner\.venv\`
  - Creds file at `C:\tmp\iuf_oa_runner_creds.env` (NTFS-ACL-restricted)
  - Log dir `C:\iuf\openalice-runner\logs\` (pre-created, ACL to service user)

### 2. Service registration (PowerShell, as admin)

```powershell
$SVC = "openalice-runner"
$PY  = "C:\iuf\openalice-runner\.venv\Scripts\python.exe"
$APP = "C:\iuf\openalice-runner\openalice_runner.py"
$ARGS = "run --api https://api.eycvector.com " +
        "--device-id oa-win-mvp-01 " +
        "--creds C:\tmp\iuf_oa_runner_creds.env " +
        "--llm rule-template " +
        "--poll-seconds 10 " +
        "--max-jobs 4"
$LOG = "C:\iuf\openalice-runner\logs"

nssm install $SVC $PY $APP $ARGS
nssm set $SVC AppDirectory "C:\iuf\openalice-runner"
nssm set $SVC AppStdout "$LOG\stdout.log"
nssm set $SVC AppStderr "$LOG\stderr.log"
nssm set $SVC AppRotateFiles 1
nssm set $SVC AppRotateOnline 1
nssm set $SVC AppRotateBytes 10485760          # 10 MB
nssm set $SVC AppRotateSeconds 0
nssm set $SVC AppEnvironmentExtra "PYTHONUNBUFFERED=1"
nssm set $SVC Start SERVICE_AUTO_START
nssm set $SVC AppExit Default Restart
nssm set $SVC AppRestartDelay 5000             # 5 s before restart after exit
nssm set $SVC AppThrottle 10000                # 10 s minimum uptime before restart counted
nssm start $SVC
```

### 3. LLM secrets (never on the CLI)

The runner reads `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `OLLAMA_BASE_URL`
from `os.environ` only. NSSM supports a per-service environment via
`AppEnvironmentExtra`:

```powershell
# load from a protected .env file at service boot — do NOT check this in
$envFile = "C:\tmp\iuf_oa_runner_llm.env"
$envLines = Get-Content $envFile | Where-Object { $_ -match "^\s*[A-Z_]+=" }
$flat = ($envLines -join "`0") + "`0PYTHONUNBUFFERED=1"
nssm set $SVC AppEnvironmentExtra "$flat"
```

`AppEnvironmentExtra` entries are null-separated (`nul` in NSSM docs). Keep
the .env file at `chmod`-equivalent restricted NTFS ACL (owner-only-read).

### 4. Uninstall

```powershell
nssm stop openalice-runner
nssm remove openalice-runner confirm
```

### 5. Health check from outside

Service state:
```
sc query openalice-runner
# STATE ... RUNNING
```

Liveness from the IUF side:
```bash
# Runner registers lastSeenAt on every poll; device active threshold is 5 min
curl -s "$API/api/v1/openalice/devices" -H "Cookie: $COOKIE" | jq '.data[] | {id, status, lastSeenAt}'
```

If `lastSeenAt` is older than 5 min while NSSM says RUNNING → runner is
alive but poll path is broken (network/auth). Check stderr.log.

---

## Task Scheduler fallback (option A — only if NSSM unavailable)

```powershell
$ACTION  = New-ScheduledTaskAction -Execute $PY -Argument "$APP $ARGS" `
            -WorkingDirectory "C:\iuf\openalice-runner"
$TRIGGER = New-ScheduledTaskTrigger -AtStartup
$PRINCIPAL = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$SETTINGS = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit (New-TimeSpan -Days 0) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName "openalice-runner" -Action $ACTION -Trigger $TRIGGER `
  -Principal $PRINCIPAL -Settings $SETTINGS
Start-ScheduledTask -TaskName "openalice-runner"
```

Downsides:
  - Log capture requires the runner to redirect inside the command itself.
  - Restart semantics are coarser (minute-level, not second-level).

---

## Log hygiene

NSSM rotates `stdout.log` / `stderr.log` at 10 MB online. Before P1 we keep
the last 5 rotated copies. Zero logging of secrets is enforced by the
runner code itself (see `openalice_runner.py` P0-A security rules).

If later we want structured JSON logs shipped to a central sink, add a
`stdout → logrotate → ship` sidecar; for P0.5 the local rotating file is
sufficient.

---

## Rollout plan

1. Stage: install NSSM on the Windows host, register service with a **stopped**
   state (`nssm set openalice-runner Start SERVICE_DEMAND_START`), then start
   manually once, watch `stdout.log` for 2 minutes, confirm a claim-submit
   cycle.
2. Promote: flip to `SERVICE_AUTO_START`, reboot host, verify service comes
   up and runner registers `lastSeenAt` within 2 min.
3. Capture evidence: 10-minute uptime window showing green
   `sc query` + API `status=active` + non-zero claim count in stdout.log.
4. Writeback: file evidence to
   `evidence/2026-04-24_p0_round/p0_5_runner_daemon/` and update
   `session_handoff.md`.

---

## Non-goals / deferred

- Multi-device HA: single desk runner is sufficient for P0.5.
- GPU-bound LLM backends: not in P0 scope (still `rule-template` default).
- Remote kill-switch: OpenAlice bridge already lets the API put the device
  into `disabled` — the runner honours that and idles. A separate OS-level
  kill-switch is unnecessary.

---

## Summary (one paragraph)

Use NSSM to wrap the existing `openalice_runner.py run` command as a Windows
Service with auto-start, 5 s crash-restart, rotating log files, and environ
-only secret passing. Zero code changes. Fallback to Task Scheduler if
NSSM install is blocked. Rollout in stage → auto-start → evidence-capture
order; remove with one command if anything goes wrong.
