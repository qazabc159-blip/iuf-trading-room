# /health account_set=false Discrepancy Diagnosis
**Date:** 2026-04-27
**Author:** Jason (backend-strategy lane)
**Trigger:** 楊董 11:30 observed /health showed account_set=false after set_account API confirmed True

---

## 1. Root Cause

**State-source mismatch caused by gateway restart without re-calling set_account.**

### Trace

#### `/health` reads from:
`app.py` lines 109-114:
```python
@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        kgi_logged_in=session.is_logged_in,
        account_set=session.is_account_set,    # <-- reads session._active_account is not None
    )
```

#### `session.is_account_set` resolves to:
`kgi_session.py` lines 37-39:
```python
@property
def is_account_set(self) -> bool:
    return self._active_account is not None
```

#### `set_account()` mutates:
`kgi_session.py` lines 113-114:
```python
self._api.set_Account(account)
self._active_account = account    # <-- sets the field /health reads
```

#### On re-login (or restart):
`kgi_session.py` line 76:
```python
self._active_account = None  # reset on re-login
```

### What happened (reconstruction)

1. Original session: login + set_account → `_active_account = "<REDACTED:KGI_ACCOUNT>"` → /health: account_set=true
2. Gateway restarted (W2b or operator restart) → new uvicorn process → `KgiSession.__init__` sets `_active_account = None`
3. Operator called `POST /session/login` (re-login) → `_active_account = None` again (explicit reset at line 76)
4. Operator did NOT call `POST /session/set-account` after restart
5. `/health` reports `account_set=false` → correct per current runtime state, but confusing because the account was previously set

**Key insight:** `set_account` state is NOT persisted across process restarts. Every restart requires re-login + re-set-account. This is by design (ephemeral session state), not a bug.

The passive observation at 09:43-10:28 TST showed `account_set=true` — this means the operator DID call set_account at some point during that observation window. The 11:30 observation showing `false` almost certainly reflects a process restart (the W2b gateway restart) where login was called but set_account was not re-called.

---

## 2. Severity

**Cosmetic / Operational — NOT functional.**

- `account_set=false` in /health does NOT block /trades or /deals endpoints
- `/trades` and `/deals` use `hasattr(session.api, "Order")` as their guard, not `is_account_set`
- Real trading orders would fail if `_active_account is None`, but those are gated separately
- The passive observation at 09:43 already showed `/trades 200` and `/deals 200` even with account_set=false states present

**Risk level:** Low. It's a misleading health indicator, not a broken function.

---

## 3. Suggested Fix

Two approaches:

### Approach A — Documentation only (zero code, recommended for now)
Add to `README.md` operator section:

> After every gateway restart, the full startup sequence is:
> 1. POST /session/login
> 2. POST /session/set-account (REQUIRED — state does not persist across restart)
>
> /health `account_set=false` after restart is expected until step 2 is completed.

This is zero-risk and correctly documents the intended ephemeral behaviour.

### Approach B — Health endpoint note field (optional, ≤5 LoC)
Add a `note` field to `/health` response when account is not set post-login:

```python
@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    note = None
    if session.is_logged_in and not session.is_account_set:
        note = "logged_in but account_not_set: call POST /session/set-account"
    return HealthResponse(
        status="ok",
        kgi_logged_in=session.is_logged_in,
        account_set=session.is_account_set,
        note=note,
    )
```

This requires adding `note: str | None = None` to `HealthResponse` in `schemas.py` — +2 lines. Total: ~5 LoC.

**Recommendation:** Approach A first (zero risk, no code). Approach B only if 楊董 or Elva wants the /health response to be self-explanatory.

---

## 4. Is a Draft PR Safe?

Yes — Approach B is safe to put on its own branch. Changes are:
- `services/kgi-gateway/schemas.py`: +`note: str | None = None` to `HealthResponse`
- `services/kgi-gateway/app.py`: +4 lines in `/health` handler (login-but-no-account note)

Both are additive, non-breaking changes. Existing callers that don't read `note` are unaffected.

No risk to: /position, /order/create, /trades, /deals, /events, /quote routes.

---

## 5. Unit Test for the Fix

```python
def test_health_logged_in_but_account_not_set_shows_note():
    """After login but before set_account, /health note should guide operator."""
    with patch.object(session, "_api", object()):  # non-None = logged_in=True
        with patch.object(session, "_active_account", None):  # account not set
            response = client.get("/health")
            assert response.status_code == 200
            body = response.json()
            assert body["kgi_logged_in"] is True
            assert body["account_set"] is False
            assert body["note"] is not None
            assert "set-account" in body["note"]
```

---

## 6. Files Affected (Approach B)

| File | Change | LoC delta |
|---|---|---|
| `services/kgi-gateway/schemas.py` | `note: str | None = None` in `HealthResponse` | +1 |
| `services/kgi-gateway/app.py` | note logic in `/health` handler | +4 |
| `services/kgi-gateway/tests/test_health_account_set.py` | NEW — 1 unit test | ~25 |
| Total | | ~30 LoC |

---

## 7. Branch Name (if implementing)

`fix/health-account-set-sync`

Hard lines:
- 0 changes to /position, /order/create, /quote, /trades, /deals, /session
- 0 merge by Jason — branch only
- 0 functional change (additive note field only)
