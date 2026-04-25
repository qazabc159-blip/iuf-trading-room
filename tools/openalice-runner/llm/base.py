"""Pluggable LLM backend protocol."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol


class LlmError(Exception):
    """Any recoverable-but-unrecoverable-this-call failure from a provider.

    The registry catches this and falls back to rule-template so the job still
    produces a draft (annotated with fallback_reason)."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message


@dataclass
class GenerateResult:
    """What a backend returns for a single job.

    `structured` is what gets submitted as the OpenAlice result. `meta` is
    merged into payload.llm_meta in the eventual content_drafts row so reviewers
    can see provider / model / tokens / fallback_reason without opening raw JSON."""

    structured: dict[str, Any]
    meta: dict[str, Any] = field(default_factory=dict)


class LlmBackend(Protocol):
    provider_name: str

    def generate_theme_summary(
        self, params: dict[str, Any], context: dict[str, Any]
    ) -> GenerateResult: ...

    def generate_company_note(
        self, params: dict[str, Any], context: dict[str, Any]
    ) -> GenerateResult: ...

    def generate_daily_brief(
        self, params: dict[str, Any], context: dict[str, Any]
    ) -> GenerateResult: ...
