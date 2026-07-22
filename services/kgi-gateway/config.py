"""
config.py — environment-based configuration for KGI gateway.

All values are read from environment variables.
No defaults are hard-coded for credentials — startup fails if missing.
"""

import os


class Settings:
    # KGI credentials — loaded from env, MUST be set before starting
    KGI_PERSON_ID: str = os.environ.get("KGI_PERSON_ID", "")
    KGI_PERSON_PWD: str = os.environ.get("KGI_PERSON_PWD", "")
    KGI_CA_PATH: str = os.environ.get("KGI_CA_PATH", "").strip()
    KGI_CA_PWD: str = (
        os.environ.get("KGI_CA_PWD", "") or os.environ.get("KGI_CA_PW", "")
    ).strip()

    # Server bind
    HOST: str = os.environ.get("GATEWAY_HOST", "127.0.0.1")
    PORT: int = int(os.environ.get("GATEWAY_PORT", "8787"))

    # Optional: pre-warm login on startup (default False — wait for POST /session/login)
    AUTO_LOGIN: bool = os.environ.get("AUTO_LOGIN", "false").lower() == "true"
    SIMULATION: bool = os.environ.get("KGI_SIMULATION", "true").lower() in ("true", "1", "yes")
    KGI_ACCOUNT: str = os.environ.get("KGI_ACCOUNT", "").strip()

    # W2a Candidate F circuit breaker — when true, /position returns 503 immediately
    # without calling any KGI SDK / pandas / serialization. Mechanism-agnostic containment.
    # Set in env: KGI_GATEWAY_POSITION_DISABLED=true. Default false (preserves current behaviour).
    POSITION_DISABLED: bool = os.environ.get("KGI_GATEWAY_POSITION_DISABLED", "false").lower() == "true"

    # W2b circuit breaker — when true, /quote/ticks and /quote/bidask return 503 immediately.
    # Mirrors Candidate F pattern. Default false (preserves current behaviour).
    QUOTE_DISABLED: bool = os.environ.get("KGI_GATEWAY_QUOTE_DISABLED", "false").lower() == "true"

    # --- Dual-track quote leg (2026-07-10 KGI_DUAL_TRACK_PATCH_PLAN_v1.md) ---
    # SIM account (KGI_PERSON_ID / KGI_SIMULATION above) has no quote-tier membership —
    # confirmed via local bisection 2026-07-10 (member ranking level comes back blank,
    # market-data token never issued). The quote leg logs into a SEPARATE, always-live
    # KGI account whose sole purpose is market-data subscription. It NEVER touches
    # /order/create, /position, /trades, /deals, /session/set-account — those all stay
    # on the trade leg (KGI_PERSON_ID/KGI_SIMULATION above), unchanged.
    KGI_QUOTE_PERSON_ID: str = os.environ.get("KGI_QUOTE_PERSON_ID", "")
    KGI_QUOTE_PERSON_PWD: str = os.environ.get("KGI_QUOTE_PERSON_PWD", "")
    KGI_QUOTE_CA_PATH: str = os.environ.get("KGI_QUOTE_CA_PATH", "").strip()
    KGI_QUOTE_CA_PWD: str = (
        os.environ.get("KGI_QUOTE_CA_PWD", "") or os.environ.get("KGI_QUOTE_CA_PW", "")
    ).strip()
    # Independent from AUTO_LOGIN (trade leg). Default false — operator must opt in
    # explicitly once KGI_QUOTE_PERSON_ID/PWD are provisioned, so a half-configured
    # gateway does not spam failed live-login attempts on every boot.
    QUOTE_AUTO_LOGIN: bool = os.environ.get("KGI_QUOTE_AUTO_LOGIN", "false").lower() == "true"


settings = Settings()
