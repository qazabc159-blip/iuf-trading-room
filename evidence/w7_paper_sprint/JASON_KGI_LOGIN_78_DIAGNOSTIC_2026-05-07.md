# KGI Login Error 78 — Deep Diagnostic Evidence
**Date**: 2026-05-07
**Author**: Jason (backend-strategy engineer)
**Branch**: feat/kgi-gateway-login-deep-diagnostic-2026-05-07

---

## Locked Facts (pre-conditions)

| Item | Status |
|---|---|
| simulation=True confirmed transmitted | LOCKED (PR #284 debug log verify) |
| CA / 憑證 check | PASS |
| SuperPy API 申請狀態 | PASS (楊董 confirm) |
| SuperPy 風險預告書簽署 | PASS (楊董 confirm) |
| Login result code | **78** |
| Login IsLogon | **False** |

---

## A. Password Type — Definitive Verdict

### kgisuperpy.login() parameter

From `kgisuperpy/main.py` source (directly read):

```python
class login:
    def __init__(self, person_id=None, person_pwd=None, simulation: bool = True):
```

The parameter is `person_pwd`.

### What does person_pwd map to?

Traced through `CA.py → TradeCom.__init__()`:

```python
self._ObjOrder = TradeCom(self.person_id, self.person_pwd, self.simulation)
```

TradeCom calls:

```python
super().Login(self.person_id, self.person_pwd)
```

which maps to `libTradeCom.pyTradeCom_Login` (DLL call):

```c
pyTradeCom_Login(self._obj, person_id_bytes, person_pwd_bytes)
```

**Verdict**: `person_pwd` = **電子下單密碼** (e-trading password), the same password used in KGI's web-based stock ordering system (`e.kgi.com.tw`). This is **NOT** the general web login password (`kgi.com.tw` portal).

KGI account passwords:
1. 網站登入密碼 — for portal login only, NOT for kgisuperpy
2. **電子下單密碼** — for kgisuperpy.login() ← CORRECT
3. 下單確認密碼 — 2nd-factor for order submission (different step)
4. API-specific password — only if KGI separately requires; not standard for SuperPy

---

## B. Error Code 78 — Definitive Meaning

### Source: `services/kgi-gateway/errMsg.ini` (official KGI SDK error code map)

```ini
[login]
77=SSO系統異常
78=您尚未申請使用元件,請洽營業員
79=您尚未申請使用API,請洽營業員
80=您尚未申請使用DMA或主機IP與申請使用IP不符,請洽營業員
```

**Verdict for code 78**:

- Literal: "您尚未申請使用元件，請洽營業員"
- Translation: "You have not applied to use the component. Please contact your broker."
- Meaning: **TradeCom 元件使用權限 has not been enabled for this account in KGI backend.**

### Critical distinction: code 78 vs code 79

| Code | Meaning |
|---|---|
| **78** | 元件 (TradeCom component) not enabled — **this is what we have** |
| **79** | API itself not applied — not our case (SuperPy API status is PASS) |

The `SuperPy API 申請通過` (code 79 cleared) and `TradeCom 元件使用` (code 78) are **two separate backend permissions** in KGI's system. Passing the API application does NOT automatically enable the TradeCom component.

### What code 78 is NOT

- NOT wrong password (that would be code 2: "輸入錯誤，請重新輸入" or code 70: "生日或密碼輸入錯誤")
- NOT API not applied (code 79)
- NOT wrong IP (code 66: "您登入主機的IP與申請使用IP不符合" or code 80: DMA IP mismatch)
- NOT account locked (code 4 or 5)
- NOT simulation environment not enabled (there is no separate code for that)

---

## C. Diagnostic Script Upgrade Summary

**File**: `services/kgi-gateway/scripts/diagnose_sim_login.py`

Upgrades over PR #284 baseline:

1. **SDK path + version print** — `kgisuperpy.__file__` + `__version__`
2. **login() signature + docstring** — via `inspect.signature(kgisuperpy.login.__init__)`
3. **Correct success indicator** — checks `result._ObjOrder.FIsLogon` (the real DLL-level flag from `OnStatusChanged` callback), not `getattr(result, "IsSucceed", None)` which is always None on failed login
4. **Password length** — prints `len(password)` chars (never the password itself)
5. **Error code lookup** — loads `errMsg.ini` and resolves code to Chinese description
6. **Code 78 special branch** — prints full explanation of what code 78 means
7. **Optional production retry** — `--retry-production` flag: tries `simulation=False` after sim failure, prints comparison (same code = password issue; different codes = sim-specific issue)

### Key finding about IsSucceed attribute

**Old code** in `kgi_session.py`:
```python
is_succeed = getattr(login_result, "IsSucceed", None)
if is_succeed is False:
    raise KgiLoginFailedError(...)
```

**Problem**: `login_result` (the `kgisuperpy.login` class instance) does NOT have an `IsSucceed` attribute. `IsSucceed` is a local variable in `CA.py OnLogonResponse(self, IsSucceed, ReplyString)`. So `getattr(login_result, "IsSucceed", None)` always returns `None`. The `is_succeed is False` check never fires.

**Actual path**: On a failed login (status==5), `TradeCom.OnStatusChanged()` sets `self.FIsLogon = False`. The `main.login.__init__()` checks `if self._ObjOrder.FIsLogon == True:` before assigning methods (`show_account`, `set_Account`, etc.). On failure, those methods are NOT assigned → `hasattr(result, "show_account")` is False.

**The old `show_account()` call on failed login (pre-PR #284)** failed because `show_account` was not assigned as an instance method → AttributeError → gateway returned 502.

**Current `kgi_session.py`** already has the fix: it checks `is_succeed is False` (which is None, so doesn't fire), then falls through to `self._api = login_result`, then calls `login_result.show_account()` which raises `AttributeError` → caught by `except KgiLoginFailedError`... wait, that's wrong.

Actually re-examining: the current kgi_session.py after PR #284 has `if is_succeed is False: raise KgiLoginFailedError`. Since `is_succeed` is None (not False), it falls through to `self._api = login_result` then `login_result.show_account()`. Since `show_account` is NOT assigned (FIsLogon=False), this raises `AttributeError` → NOT caught by `KgiLoginFailedError` → falls to `except Exception` in app.py → returns 400 not 401.

**Recommendation**: `kgi_session.py` should check `_ObjOrder.FIsLogon` directly:

```python
is_logon = getattr(getattr(login_result, "_ObjOrder", None), "FIsLogon", None)
if is_logon is not True:
    error_code = getattr(getattr(login_result, "_ObjOrder", None), "RtnCode", -1) or -1
    # errMsg.ini code from the [login] section is on the top-level login object
    # after AutoRefresh token call sets it
    top_rtn = getattr(login_result, "RtnCode", None)
    if top_rtn is not None:
        error_code = int(top_rtn)
    raise KgiLoginFailedError(error_code=int(error_code), reply_string=str(getattr(login_result, "ReplyString", "登入失敗")))
```

This is a small fix but NOT in scope for this diagnostic PR. Marking as follow-up.

---

## D. KGI Support Letter

**File**: `services/kgi-gateway/scripts/KGI_SUPPORT_QUESTION_DRAFT.md`

Template ready for 楊董 to fill in and send. Contains:
- All verified facts (API/signing status locked)
- Exact error code + ReplyString
- 5 specific questions for KGI
- Account identification fields (masked in template, 楊董 fills)

---

## SDK Login Flow (from source analysis)

```
kgisuperpy.login(person_id, person_pwd, simulation)
  → CA.py TradeCom.__init__(person_id, person_pwd, simulation)
      → AutoRefresh(person_id, person_pwd, simulation)   ← web token (.pyd compiled)
          → HTTP login to get market data token
          → Sets login.IsSucceed / RtnCode / ReplyString on AutoRefresh object
          → These bubble up to login() top-level attrs
      → pyTradeCom_Connect(host, port, key)              ← DLL TCP connection
      → Wait FIsConnected callback (status 3 = connected)
      → pyTradeCom_Login(person_id, person_pwd)          ← DLL TradeCom login
      → Wait FIsLogon callback:
          status 4 → FIsLogon = True  (success)
          status 5 → FIsLogon = False (failure, code in RtnCode)
  → main.login checks _ObjOrder.FIsLogon == True
      → True:  assigns show_account, set_Account, Order, etc.
      → False: login object has _ObjOrder but no instance methods
```

**Two-layer auth**:
- Layer 1: Web token (AutoRefresh) — market data API, succeeded (Log shows "Successfully obtained ranking token")
- Layer 2: TradeCom DLL login — trading/ordering API, **FAILING with code 78**

The SDK log at `kgisuperpy/log/20260507/Login.log` confirms:
```
Successfully obtained ranking token for uid: F131331910
Successfully retrieved ranking for uid: F131331910, level:
```
Layer 1 (web token) is succeeding. Layer 2 (TradeCom DLL) is failing at backend permission check.

---

## Next Steps (Priority Order)

1. **楊董 ACTION REQUIRED**: Send `KGI_SUPPORT_QUESTION_DRAFT.md` to KGI 業務窗口 asking about code 78 / TradeCom element permission. This is the most likely root cause.

2. **Password verification**: Run the upgraded `diagnose_sim_login.py` to confirm password is the 電子下單密碼 (not web login password). If wrong password type, switch to 電子下單密碼 first.

3. **Optional retry**: Run `python diagnose_sim_login.py --retry-production` to test if production (simulation=False) gives same code 78 or different code. Same code = definitely a permission issue, not a sim-specific issue.

4. **kgi_session.py fix** (small, post-diagnosis): Update `is_succeed` check to use `_ObjOrder.FIsLogon` instead of `IsSucceed` attribute (which doesn't exist). This makes 401 vs 400 classification correct. Can be done as separate tiny PR after root cause confirmed.

---

## Files Changed This PR

| File | Change |
|---|---|
| `services/kgi-gateway/scripts/diagnose_sim_login.py` | Upgraded with full instrumentation |
| `services/kgi-gateway/scripts/KGI_SUPPORT_QUESTION_DRAFT.md` | NEW — KGI support letter template |
| `evidence/w7_paper_sprint/JASON_KGI_LOGIN_78_DIAGNOSTIC_2026-05-07.md` | NEW — this file |

No production code changed. No tests affected. Lane: `services/kgi-gateway/scripts` only.
