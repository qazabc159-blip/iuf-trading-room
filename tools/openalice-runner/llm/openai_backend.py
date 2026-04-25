"""OpenAI backend — /v1/chat/completions adapter with 10 防呆 items.

Hard contract with the registry:
- On ANY failure that should still produce a draft (timeout, HTTP error, JSON
  decode, schema violation, empty output), raise LlmError(code, message). The
  registry catches it and falls back to rule_template, annotating
  llm_meta.fallback_reason so reviewers see exactly why.
- On success, return GenerateResult(structured=..., meta=...) where meta carries
  provider / model / prompt_id / prompt_version / usage / attempt, so the draft
  row payload.llm_meta is reviewer-legible without opening raw JSON.

No secret is ever logged. Stdout/stderr messages include provider + model +
attempt + code only, never api key, never full response body."""
from __future__ import annotations

import json
import os
import random
import time
import urllib.error
import urllib.request
from typing import Any

from .base import GenerateResult, LlmError

OPENAI_CHAT_ENDPOINT_DEFAULT = "https://api.openai.com/v1/chat/completions"

# Per 10k tokens — rough ceiling for Phase 2 sanity cost tracking, not billing truth.
# If the API returns usage, we use that; these constants only translate tokens→USD estimate.
_COST_USD_PER_1K_IN = {
    "gpt-5.4-mini": 0.00015,
    "gpt-4o-mini": 0.00015,
}
_COST_USD_PER_1K_OUT = {
    "gpt-5.4-mini": 0.0006,
    "gpt-4o-mini": 0.0006,
}


def _system_prompt_theme_summary() -> str:
    return (
        "You are the IUF Trading Room research assistant. Produce a concise theme brief "
        "in Traditional Chinese (繁體中文) for internal review. Plain text only, no "
        "markdown headers, no emojis. Never suggest trades, prices, targets, or order "
        "actions — this is a research note, not an execution signal."
    )


def _system_prompt_company_note() -> str:
    return (
        "You are the IUF Trading Room research assistant. Produce a short factual "
        "company note in Traditional Chinese (繁體中文) for internal review. Plain text "
        "only, no markdown headers, no emojis. Never suggest trades, prices, targets, "
        "or order actions — this is a research note, not an execution signal."
    )


def _user_prompt_theme_summary(params: dict[str, Any], context: dict[str, Any]) -> str:
    theme_name = str(params.get("themeName", "Unknown theme"))
    company_count = int(params.get("companyCount", 0))
    members = context.get("memberCompanies") or []
    members_line = ""
    if isinstance(members, list) and members:
        joined = ", ".join(str(m) for m in members[:20])
        members_line = f"\nSample linked companies: {joined}"
    return (
        f"Theme: {theme_name}\n"
        f"Linked company count: {company_count}"
        f"{members_line}\n\n"
        "Write 3–5 sentences summarising what this theme is and why it matters. "
        "Return ONLY a JSON object with keys {\"summary\": string}. No other text."
    )


def _user_prompt_company_note(params: dict[str, Any], context: dict[str, Any]) -> str:
    company_name = str(params.get("companyName", "Unknown company"))
    ticker = str(params.get("ticker", ""))
    industry = str(params.get("industry", ""))
    return (
        f"Company: {company_name}"
        + (f" ({ticker})" if ticker else "")
        + (f"\nIndustry: {industry}" if industry else "")
        + "\n\nWrite 3–5 sentences on what the company does and any notable recent angle. "
        "Return ONLY a JSON object with keys {\"note\": string}. No other text."
    )


def _validate_theme_summary(obj: Any) -> str:
    if not isinstance(obj, dict):
        raise LlmError("schema_invalid", "model output is not a JSON object")
    summary = obj.get("summary")
    if not isinstance(summary, str) or not summary.strip():
        raise LlmError("schema_invalid", "missing or empty summary string")
    if len(summary) > 4000:
        raise LlmError("schema_invalid", f"summary too long: {len(summary)} chars")
    return summary.strip()


def _validate_company_note(obj: Any) -> str:
    if not isinstance(obj, dict):
        raise LlmError("schema_invalid", "model output is not a JSON object")
    note = obj.get("note")
    if not isinstance(note, str) or not note.strip():
        raise LlmError("schema_invalid", "missing or empty note string")
    if len(note) > 4000:
        raise LlmError("schema_invalid", f"note too long: {len(note)} chars")
    return note.strip()


def _system_prompt_daily_brief() -> str:
    return (
        "You are the IUF Trading Room investment research assistant. "
        "Produce a structured daily research brief in Traditional Chinese (繁體中文) "
        "for internal review. Research-note tone, professional and neutral. "
        "You MAY write watchlist observations, risk notes, theme overviews, and company observations. "
        "You MUST NOT output any trade execution instructions, order suggestions, buy/sell calls, "
        "price targets, stop-loss/take-profit levels, or any sentence resembling '立即買進', "
        "'立即賣出', '下單', or similar execution language. "
        "This output is a draft for internal review only — it MUST NOT bypass human review. "
        "Return a JSON object with exactly two keys: "
        "\"marketState\" (one of: \"Risk-On\", \"Balanced\", \"Risk-Off\") and "
        "\"sections\" (array of {\"heading\": string, \"body\": string}). "
        "Between 3 and 6 sections. Each body must be ≤1500 characters. "
        "Total body character count must be ≤6000. No other keys or text outside the JSON."
    )


def _user_prompt_daily_brief(params: dict[str, Any], context: dict[str, Any]) -> str:
    date = str(params.get("date", "unknown"))
    top_themes = params.get("topThemes") or []
    recent_summaries = params.get("recentSummaries") or []
    recent_notes = params.get("recentNotes") or []

    themes_lines = ""
    if isinstance(top_themes, list) and top_themes:
        parts = []
        for t in top_themes[:5]:
            if isinstance(t, dict):
                name = t.get("name", "")
                ms = t.get("marketState", "")
                pri = t.get("priority", "")
                parts.append(f"  - {name} [市場狀態={ms}, 優先={pri}]")
        themes_lines = "\n".join(parts)

    summaries_lines = ""
    if isinstance(recent_summaries, list) and recent_summaries:
        parts = [f"  [{i+1}] {str(s)[:400]}" for i, s in enumerate(recent_summaries[:5])]
        summaries_lines = "\n".join(parts)

    notes_lines = ""
    if isinstance(recent_notes, list) and recent_notes:
        parts = [f"  [{i+1}] {str(n)[:400]}" for i, n in enumerate(recent_notes[:3])]
        notes_lines = "\n".join(parts)

    return (
        f"Date: {date}\n\n"
        + (f"Top Themes:\n{themes_lines}\n\n" if themes_lines else "Top Themes: (none)\n\n")
        + (f"Recent Theme Summaries:\n{summaries_lines}\n\n" if summaries_lines else "Recent Theme Summaries: (none)\n\n")
        + (f"Recent Company Notes:\n{notes_lines}\n\n" if notes_lines else "Recent Company Notes: (none)\n\n")
        + "Produce a daily research brief in Traditional Chinese with 3–6 sections. "
        "Return ONLY a JSON object: "
        "{\"marketState\": \"Risk-On\"|\"Balanced\"|\"Risk-Off\", "
        "\"sections\": [{\"heading\": string, \"body\": string}, ...]}"
        ". Each body ≤1500 chars, total body ≤6000 chars. No other text."
    )


_DAILY_BRIEF_VALID_MARKET_STATES = {"Risk-On", "Balanced", "Risk-Off"}


def _validate_daily_brief(obj: Any) -> dict[str, Any]:
    if not isinstance(obj, dict):
        raise LlmError("schema_invalid", "model output is not a JSON object")
    market_state = obj.get("marketState")
    if market_state not in _DAILY_BRIEF_VALID_MARKET_STATES:
        raise LlmError(
            "schema_invalid",
            f"marketState must be one of Risk-On/Balanced/Risk-Off, got: {market_state!r}"
        )
    sections = obj.get("sections")
    if not isinstance(sections, list):
        raise LlmError("schema_invalid", "sections must be an array")
    if len(sections) < 3:
        raise LlmError("schema_invalid", f"sections too few: {len(sections)} (min 3)")
    if len(sections) > 6:
        raise LlmError("schema_invalid", f"sections too many: {len(sections)} (max 6)")
    total_body = 0
    for i, sec in enumerate(sections):
        if not isinstance(sec, dict):
            raise LlmError("schema_invalid", f"sections[{i}] is not an object")
        heading = sec.get("heading")
        body = sec.get("body")
        if not isinstance(heading, str) or not heading.strip():
            raise LlmError("schema_invalid", f"sections[{i}].heading missing or empty")
        if not isinstance(body, str) or not body.strip():
            raise LlmError("schema_invalid", f"sections[{i}].body missing or empty")
        if len(body) > 1500:
            raise LlmError("schema_invalid", f"sections[{i}].body too long: {len(body)} chars (max 1500)")
        total_body += len(body)
    if total_body > 6000:
        raise LlmError("schema_invalid", f"total body chars {total_body} exceeds 6000")
    return {
        "marketState": market_state,
        "sections": [{"heading": s["heading"].strip(), "body": s["body"].strip()} for s in sections],
    }


class OpenAiBackend:
    provider_name = "openai"

    def _cfg(self) -> dict[str, Any]:
        env = os.environ
        api_key = env.get("OPENAI_API_KEY", "").strip()
        if not api_key:
            # Do NOT log the key. Only its presence.
            raise LlmError("missing_api_key", "OPENAI_API_KEY not set")
        return {
            "api_key": api_key,
            "model": env.get("OPENAI_MODEL", "gpt-4o-mini").strip() or "gpt-4o-mini",
            "fallback_model": env.get("OPENAI_MODEL_FALLBACK", "gpt-4o-mini").strip() or "gpt-4o-mini",
            "max_tokens": int(env.get("OPENAI_MAX_TOKENS", "1024") or "1024"),
            "timeout_s": max(1.0, float(env.get("OPENAI_TIMEOUT_MS", "30000") or "30000") / 1000.0),
            "base_url": (env.get("OPENAI_BASE_URL", "").strip() or OPENAI_CHAT_ENDPOINT_DEFAULT),
        }

    def _chat(
        self,
        cfg: dict[str, Any],
        model: str,
        system_prompt: str,
        user_prompt: str,
    ) -> tuple[dict[str, Any], dict[str, Any], int]:
        """Single HTTPS call — returns (parsed_output_json, usage_meta, attempt_count).
        Retries once on 429 / 500 / 502 / 503 / timeout with jittered backoff.
        Raises LlmError on any non-recoverable failure."""
        # Reasoning models (gpt-5*, o1*, o3*) reject `max_tokens` and `temperature`;
        # they require `max_completion_tokens` and run at fixed temperature.
        # Classic chat models (gpt-4o*, gpt-4*, gpt-3.5*) accept both fields, but
        # `max_completion_tokens` is the modern, forward-compatible spelling.
        is_reasoning = any(model.lower().startswith(p) for p in ("gpt-5", "o1", "o3", "o4"))
        payload: dict[str, Any] = {
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "max_completion_tokens": cfg["max_tokens"],
            "response_format": {"type": "json_object"},
        }
        if not is_reasoning:
            payload["temperature"] = 0.3
        body = json.dumps(payload).encode("utf-8")
        headers = {
            "Authorization": f"Bearer {cfg['api_key']}",
            "Content-Type": "application/json",
        }

        last_err: tuple[str, str] | None = None
        for attempt in (1, 2):
            req = urllib.request.Request(cfg["base_url"], data=body, headers=headers, method="POST")
            try:
                with urllib.request.urlopen(req, timeout=cfg["timeout_s"]) as resp:
                    raw = resp.read()
            except urllib.error.HTTPError as e:
                status = e.code
                try:
                    err_body = e.read().decode("utf-8", errors="replace")
                except Exception:
                    err_body = ""
                # Trim body to avoid log explosion / secret echo (api key never comes back in body, but be safe).
                snippet = err_body[:300].replace("\n", " ")
                if status in (429, 500, 502, 503) and attempt == 1:
                    sleep_s = 1.5 * attempt + random.random() * 0.5
                    print(f"[llm.openai] http {status} attempt={attempt} backoff={sleep_s:.2f}s model={model}")
                    time.sleep(sleep_s)
                    last_err = (f"http_{status}", snippet)
                    continue
                code = {
                    401: "auth_error",
                    403: "forbidden",
                    429: "rate_limited",
                    400: "bad_request",
                }.get(status, f"http_{status}")
                raise LlmError(code, f"HTTP {status}: {snippet}")
            except urllib.error.URLError as e:
                if attempt == 1:
                    sleep_s = 1.0 + random.random() * 0.5
                    print(f"[llm.openai] network err attempt={attempt} backoff={sleep_s:.2f}s model={model} reason={e.reason!r}")
                    time.sleep(sleep_s)
                    last_err = ("network_error", str(e.reason))
                    continue
                raise LlmError("network_error", str(e.reason))
            except TimeoutError:
                if attempt == 1:
                    print(f"[llm.openai] timeout attempt={attempt} model={model}")
                    time.sleep(1.0)
                    last_err = ("timeout", f"timeout after {cfg['timeout_s']}s")
                    continue
                raise LlmError("timeout", f"timeout after {cfg['timeout_s']}s")

            try:
                envelope = json.loads(raw)
            except json.JSONDecodeError as e:
                raise LlmError("response_decode", f"invalid JSON envelope: {e}")

            choices = envelope.get("choices") or []
            if not choices:
                raise LlmError("empty_choices", "no choices in response")
            content = (choices[0].get("message") or {}).get("content")
            if not isinstance(content, str) or not content.strip():
                raise LlmError("empty_content", "empty content in first choice")
            try:
                parsed = json.loads(content)
            except json.JSONDecodeError as e:
                raise LlmError("output_not_json", f"model did not return JSON: {e}")

            usage = envelope.get("usage") or {}
            tokens_in = int(usage.get("prompt_tokens") or 0)
            tokens_out = int(usage.get("completion_tokens") or 0)
            cost_in = _COST_USD_PER_1K_IN.get(model, 0.0) * (tokens_in / 1000.0)
            cost_out = _COST_USD_PER_1K_OUT.get(model, 0.0) * (tokens_out / 1000.0)
            meta_usage = {
                "tokens_in": tokens_in,
                "tokens_out": tokens_out,
                "est_cost_usd": round(cost_in + cost_out, 6),
                "finish_reason": choices[0].get("finish_reason"),
            }
            return parsed, meta_usage, attempt

        # Should not reach here — the loop either returns or raises.
        code, msg = last_err or ("unknown", "exhausted retries")
        raise LlmError(code, msg)

    def _with_model_fallback(
        self,
        cfg: dict[str, Any],
        system_prompt: str,
        user_prompt: str,
    ) -> tuple[dict[str, Any], dict[str, Any], str, int]:
        """Try primary model; on LlmError with retryable class, try fallback model once."""
        primary = cfg["model"]
        fallback = cfg["fallback_model"]
        try:
            parsed, usage, attempts = self._chat(cfg, primary, system_prompt, user_prompt)
            return parsed, usage, primary, attempts
        except LlmError as e:
            if fallback and fallback != primary and e.code in {
                "rate_limited", "http_500", "http_502", "http_503", "timeout", "network_error"
            }:
                print(f"[llm.openai] primary={primary} failed code={e.code}, trying fallback={fallback}")
                parsed, usage, attempts = self._chat(cfg, fallback, system_prompt, user_prompt)
                usage["model_fallback_from"] = primary
                return parsed, usage, fallback, attempts
            raise

    def generate_theme_summary(
        self, params: dict[str, Any], context: dict[str, Any]
    ) -> GenerateResult:
        cfg = self._cfg()
        sys_p = _system_prompt_theme_summary()
        usr_p = _user_prompt_theme_summary(params, context)
        parsed, usage, model_used, attempts = self._with_model_fallback(cfg, sys_p, usr_p)
        summary_text = _validate_theme_summary(parsed)
        theme_id = params.get("themeId") or params.get("targetEntityId")
        company_count = int(params.get("companyCount", 0))
        structured = {
            "themeId": theme_id,
            "summary": summary_text,
            "companyCount": company_count,
        }
        meta = {
            "provider": self.provider_name,
            "model": model_used,
            "prompt_id": "openai_theme_summary",
            "prompt_version": "1",
            "attempts": attempts,
            **usage,
        }
        return GenerateResult(structured=structured, meta=meta)

    def generate_company_note(
        self, params: dict[str, Any], context: dict[str, Any]
    ) -> GenerateResult:
        cfg = self._cfg()
        sys_p = _system_prompt_company_note()
        usr_p = _user_prompt_company_note(params, context)
        parsed, usage, model_used, attempts = self._with_model_fallback(cfg, sys_p, usr_p)
        note_text = _validate_company_note(parsed)
        company_id = params.get("companyId") or params.get("targetEntityId")
        structured = {
            "companyId": company_id,
            "note": note_text,
        }
        meta = {
            "provider": self.provider_name,
            "model": model_used,
            "prompt_id": "openai_company_note",
            "prompt_version": "1",
            "attempts": attempts,
            **usage,
        }
        return GenerateResult(structured=structured, meta=meta)

    def generate_daily_brief(
        self, params: dict[str, Any], context: dict[str, Any]
    ) -> GenerateResult:
        cfg = self._cfg()
        sys_p = _system_prompt_daily_brief()
        usr_p = _user_prompt_daily_brief(params, context)
        parsed, usage, model_used, attempts = self._with_model_fallback(cfg, sys_p, usr_p)
        validated = _validate_daily_brief(parsed)
        date = str(params.get("date", ""))
        structured = {
            "date": date,
            "marketState": validated["marketState"],
            "sections": validated["sections"],
        }
        meta = {
            "provider": self.provider_name,
            "model": model_used,
            "prompt_id": "openai_daily_brief",
            "prompt_version": "1",
            "attempts": attempts,
            **usage,
        }
        return GenerateResult(structured=structured, meta=meta)
