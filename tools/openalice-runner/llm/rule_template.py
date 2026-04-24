"""Rule-template backend — deterministic stub, no external calls.

Always safe to use. This is the fallback when any external provider fails,
when the kill-switch is on, or when --llm rule-template is explicitly requested."""
from __future__ import annotations

import time
from typing import Any

from .base import GenerateResult


class RuleTemplateBackend:
    provider_name = "rule-template"

    def generate_theme_summary(
        self, params: dict[str, Any], context: dict[str, Any]
    ) -> GenerateResult:
        theme_name = str(params.get("themeName", "Unknown theme"))
        company_count = int(params.get("companyCount", 0))
        summary = (
            f"Theme: {theme_name}\n"
            f"Linked Companies: {company_count}\n"
            f"Generated: {time.strftime('%Y-%m-%d')} (runner=rule-template)"
        )
        structured = {
            "themeId": params.get("themeId") or params.get("targetEntityId"),
            "summary": summary,
            "companyCount": company_count,
        }
        return GenerateResult(
            structured=structured,
            meta={
                "provider": self.provider_name,
                "model": None,
                "prompt_id": "rule_template_theme_summary",
                "prompt_version": "1",
            },
        )

    def generate_company_note(
        self, params: dict[str, Any], context: dict[str, Any]
    ) -> GenerateResult:
        company_name = str(params.get("companyName", "Unknown company"))
        ticker = str(params.get("ticker", ""))
        note = (
            f"Company Note: {company_name}"
            + (f" ({ticker})" if ticker else "")
            + f"\nGenerated: {time.strftime('%Y-%m-%d')} (runner=rule-template)"
        )
        structured = {
            "companyId": params.get("companyId") or params.get("targetEntityId"),
            "note": note,
        }
        return GenerateResult(
            structured=structured,
            meta={
                "provider": self.provider_name,
                "model": None,
                "prompt_id": "rule_template_company_note",
                "prompt_version": "1",
            },
        )
