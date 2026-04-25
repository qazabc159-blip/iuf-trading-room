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

    def generate_daily_brief(
        self, params: dict[str, Any], context: dict[str, Any]
    ) -> GenerateResult:
        date = str(params.get("date", time.strftime("%Y-%m-%d")))
        top_themes = params.get("topThemes") or []
        recent_summaries = params.get("recentSummaries") or []
        recent_notes = params.get("recentNotes") or []

        # Derive marketState from first theme (mirrors daily-brief-producer.ts logic).
        market_state = "Balanced"
        if isinstance(top_themes, list) and top_themes:
            first = top_themes[0]
            if isinstance(first, dict) and first.get("marketState"):
                market_state = str(first["marketState"])
        if market_state not in {"Risk-On", "Balanced", "Risk-Off"}:
            market_state = "Balanced"

        sections: list[dict[str, str]] = []

        # Section 1: market overview from top themes
        if isinstance(top_themes, list) and top_themes:
            lines = []
            for t in top_themes[:5]:
                if isinstance(t, dict):
                    lines.append(
                        f"• {t.get('name', '')} "
                        f"[{t.get('marketState', '')} / 優先={t.get('priority', '')}]"
                    )
            sections.append({
                "heading": "Market Overview",
                "body": f"Market State: {market_state}\n\n" + "\n".join(lines),
            })

        # Section 2: recent theme summaries
        if isinstance(recent_summaries, list) and recent_summaries:
            body = "\n\n---\n\n".join(str(s)[:300] for s in recent_summaries[:5])
            sections.append({"heading": "Theme Summaries", "body": body})

        # Section 3: recent company notes
        if isinstance(recent_notes, list) and recent_notes:
            body = "\n\n---\n\n".join(str(n)[:400] for n in recent_notes[:3])
            sections.append({"heading": "Company Notes", "body": body})

        # Fallback section if no data
        if not sections:
            sections.append({
                "heading": "Status",
                "body": (
                    f"Daily brief generated {date} (rule-template). "
                    "No theme or company data available. "
                    "Run theme-summary and company-note producers first."
                ),
            })

        structured = {
            "date": date,
            "marketState": market_state,
            "sections": sections,
        }
        return GenerateResult(
            structured=structured,
            meta={
                "provider": self.provider_name,
                "model": None,
                "prompt_id": "rule_template_daily_brief",
                "prompt_version": "1",
            },
        )
