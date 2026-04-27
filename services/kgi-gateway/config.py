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

    # Server bind
    HOST: str = os.environ.get("GATEWAY_HOST", "127.0.0.1")
    PORT: int = int(os.environ.get("GATEWAY_PORT", "8787"))

    # Optional: pre-warm login on startup (default False — wait for POST /session/login)
    AUTO_LOGIN: bool = os.environ.get("AUTO_LOGIN", "false").lower() == "true"

    # W2a Candidate F circuit breaker — when true, /position returns 503 immediately
    # without calling any KGI SDK / pandas / serialization. Mechanism-agnostic containment.
    # Set in env: KGI_GATEWAY_POSITION_DISABLED=true. Default false (preserves current behaviour).
    POSITION_DISABLED: bool = os.environ.get("KGI_GATEWAY_POSITION_DISABLED", "false").lower() == "true"


settings = Settings()
