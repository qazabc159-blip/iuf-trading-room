# OpenAlice Windows Runner (MVP, P0-A)

Polls the IUF Trading Room API for content-generation jobs (`theme_summary` /
`company_note` only, P0-B scope-lock), produces text via a pluggable LLM
backend (default `rule-template`), and submits results. The API mirrors
`draft_ready` results into `content_drafts` (awaiting_review, P0-D).

## Install

```bash
python -m venv .venv
.venv\Scripts\activate    # Windows
pip install -r requirements.txt
```

## Register once

Creates a device record on the server and writes a device-token to a local
credentials file (never committed).

```bash
python openalice_runner.py register \
  --api https://api.eycvector.com \
  --device-id oa-win-mvp-01 \
  --device-name "Desk-Windows" \
  --workspace primary-desk \
  --owner-creds C:/tmp/iuf_owner_creds.env \
  --out-creds C:/tmp/iuf_oa_runner_creds.env
```

`--owner-creds` must contain:

```
OWNER_EMAIL=qazabc159@gmail.com
OWNER_PASSWORD=...
```

## Run claim loop

```bash
python openalice_runner.py run \
  --api https://api.eycvector.com \
  --device-id oa-win-mvp-01 \
  --creds C:/tmp/iuf_oa_runner_creds.env \
  --llm rule-template \
  --poll-seconds 10 \
  --max-jobs 2 \
  --exit-when-idle
```

## LLM backends

Pluggable. Default is `rule-template` (no network, no secret).

| Backend         | Env var required         | Wired in MVP |
|-----------------|--------------------------|--------------|
| `rule-template` | —                        | yes          |
| `anthropic`     | `ANTHROPIC_API_KEY`      | no (stub)    |
| `openai`        | `OPENAI_API_KEY`         | no (stub)    |
| `ollama`        | `OLLAMA_BASE_URL`        | no (stub)    |

Keys are read from `os.environ` only. Never pass them on the CLI; never write
them to a creds file; never log them.

## Security rules (P0 hardline)

- Runner never logs `deviceToken`, cookies, or LLM keys (only the token length).
- `--out-creds` file is `chmod 600` on POSIX; on Windows, rely on NTFS ACL from
  the parent dir (create under `C:/tmp/` owned only by the runner user).
- No broker calls, no order placement. Task types other than `theme_summary` /
  `company_note` are submitted back as `validation_failed` without action.
