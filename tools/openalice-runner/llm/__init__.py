"""LLM backend registry for OpenAlice runner.

Each backend implements generate_theme_summary / generate_company_note.
On any failure (network / auth / quota / schema validation), the caller
falls back to rule_template. The kill-switch env var OPENALICE_LLM_DISABLED=1
also forces rule_template regardless of configured backend.
"""
from __future__ import annotations

import os
from typing import Any

from . import openai_backend, rule_template
from .base import GenerateResult, LlmBackend, LlmError

RULE_TEMPLATE = rule_template.RuleTemplateBackend()

_BACKENDS: dict[str, LlmBackend] = {
    "rule-template": RULE_TEMPLATE,
    "openai": openai_backend.OpenAiBackend(),
}


def kill_switch_on() -> bool:
    return os.environ.get("OPENALICE_LLM_DISABLED", "0").strip() in {"1", "true", "True", "yes"}


def resolve_backend(name: str) -> LlmBackend:
    if kill_switch_on():
        return RULE_TEMPLATE
    if name not in _BACKENDS:
        raise SystemExit(f"Unknown --llm backend: {name}")
    return _BACKENDS[name]


def generate(
    backend_name: str,
    task_type: str,
    params: dict[str, Any],
    context: dict[str, Any],
) -> GenerateResult:
    """Run the configured backend; on any LlmError, fall back to rule_template
    and annotate llm_meta.fallback_reason so the draft is explicit about the route it took."""
    primary = resolve_backend(backend_name)
    effective_primary = primary.provider_name

    def _call(b: LlmBackend) -> GenerateResult:
        if task_type == "theme_summary":
            return b.generate_theme_summary(params, context)
        if task_type == "company_note":
            return b.generate_company_note(params, context)
        raise SystemExit(f"Unsupported task type: {task_type}")

    if primary.provider_name == "rule-template":
        return _call(primary)

    try:
        result = _call(primary)
        return result
    except LlmError as err:
        fb = _call(RULE_TEMPLATE)
        fb.meta["fallback_reason"] = f"{effective_primary}:{err.code}:{err.message[:200]}"
        fb.meta["fallback_from"] = effective_primary
        return fb


__all__ = [
    "GenerateResult",
    "LlmBackend",
    "LlmError",
    "RULE_TEMPLATE",
    "generate",
    "kill_switch_on",
    "resolve_backend",
]
