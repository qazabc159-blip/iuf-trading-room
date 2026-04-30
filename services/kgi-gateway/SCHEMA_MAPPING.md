# KGI Gateway — Schema Mapping

TS side: `apps/api/src/broker/broker-port.ts`  
Python side: `services/kgi-gateway/schemas.py`  
KGI raw: `brokerport_golden_2026-04-23.md`

---

## GET /health

| Field | TS type | Pydantic | KGI raw | Note |
|---|---|---|---|---|
| status | `"ok"` | `Literal["ok"]` | — | static |
| kgi_logged_in | `boolean` | `bool` | `api is not None` | derived |
| account_set | `boolean` | `bool` | `active_account is not None` | derived |

---

## POST /session/login

### Request

| Field | TS (`KgiBrokerCredentials`) | Pydantic (`LoginRequest`) | KGI raw | Note |
|---|---|---|---|---|
| person_id | `string` | `str` | `kgisuperpy.login(person_id=...)` | **MUST uppercase** |
| person_pwd | `string` | `str` | `kgisuperpy.login(person_pwd=...)` | — |
| simulation | `boolean?` | `bool = False` | `kgisuperpy.login(simulation=...)` | default false |

### Response

| Field | TS (informal) | Pydantic (`LoginResponse`) | KGI raw | Note |
|---|---|---|---|---|
| ok | `boolean` | `bool` | — | |
| accounts | `KgiAccount[]` | `list[Account]` | `api.show_account()` result | see Account table |

### Account object

| Field | TS (`KgiAccount`) | Pydantic (`Account`) | KGI raw key | Sample |
|---|---|---|---|---|
| account | `string` | `str` | `account` | `"YOUR_ACCOUNT"` |
| accountFlag | `string` | `account_flag` | `account_flag` | `"證券"` |
| brokerId | `string` | `broker_id` | `broker_id` | `"YOUR_BROKER_ID"` |

Note: TS uses camelCase; Python/REST uses snake_case. TS client converts on receipt.

---

## GET /session/show-account

### Response

| Field | Pydantic (`ShowAccountResponse`) | Note |
|---|---|---|
| accounts | `list[Account]` | same Account shape as login |

---

## POST /session/set-account

### Request

| Field | TS (inline) | Pydantic (`SetAccountRequest`) | KGI raw | Note |
|---|---|---|---|---|
| account | `string` | `str` (enforced) | `api.set_Account(account)` | **string only — dict = 422** |

### Response

| Field | TS (informal) | Pydantic (`SetAccountResponse`) | KGI raw | Note |
|---|---|---|---|---|
| ok | `boolean` | `bool` | — | |
| account_flag | `string?` | `Optional[str]` | `account_flag` from accounts cache | `"證券"` |
| broker_id | `string?` | `Optional[str]` | `broker_id` from accounts cache | `"YOUR_BROKER_ID"` |

---

## POST /quote/subscribe/tick

### Request

| Field | TS (inline) | Pydantic (`SubscribeTickRequest`) | KGI raw | Note |
|---|---|---|---|---|
| symbol | `string` | `str` | `api.Quote.subscribe_tick(symbol, ...)` | e.g. `"2330"` |
| odd_lot | `boolean?` | `bool = False` | `odd_lot=False` | default regular lot |

### Response

| Field | Pydantic (`SubscribeTickResponse`) | Note |
|---|---|---|
| ok | `bool` | |
| label | `str` | subscription label for unsubscribe |

---

## WS /events/order/attach

### Message envelope (server → client)

```json
{
  "type": "order_event",
  "data": {
    "type": "NewOrder | Deal | UpdatePrice | UpdateQty | CancelOrder | Unknown",
    "code": 4010,
    "data": { "...raw KGI event attrs..." }
  }
}
```

| Field | TS (`KgiOrderEventRaw`) | Pydantic (`OrderEventMessage`) | KGI raw | Note |
|---|---|---|---|---|
| type | `KgiOrderEventType` | `Literal[...]` | class name of event object | |
| code | `number?` | `Optional[int]` | event.code attr | 4010 / 4011 |
| data | `unknown` | `Any` | all non-private attrs | open schema until B1 dry-run |

Event codes:
- `6002` — pending
- `4010` — NewOrder
- `4011` — Deal

---

## POST /order/create (W1: 409 always)

### Request (validated but not executed)

| Field | TS (`KgiCreateOrderInput`) | Pydantic (`CreateOrderRequest`) | KGI raw | Note |
|---|---|---|---|---|
| action | `"Buy" \| "Sell"` | `Literal["Buy","Sell"]` | `Action.Buy/Sell` | |
| symbol | `string` | `str` | `symbol` | e.g. `"2330"` |
| qty | `number` | `int` | `qty` | lot count |
| price | `number \| "MKT" \| ...` | `float \| Literal[...]?` | `price` | optional |
| time_in_force | `"ROD"\|"IOC"\|"FOK"` | `Literal[...]="ROD"` | `TimeInForce` | |
| order_cond | `KgiOrderCond` | `Literal[...]="Cash"` | `OrderCond` | |
| odd_lot | `boolean \| KgiOddLot` | `bool \| Literal[...]=False` | `OddLot` | |
| name | `string?` | `str=""` | `name` | |

### Response (W1 always)

```json
{
  "error": {
    "code": "NOT_ENABLED_IN_W1",
    "message": "Order submission is not enabled in W1. ..."
  }
}
```

---

## Tick WS broadcast (via quote_manager pump)

```json
{
  "type": "tick",
  "data": {
    "exchange": "TWSE",
    "symbol": "2330",
    "delay_time": 0.0,
    "odd_lot": false,
    "datetime": "20260423090038",
    "open": 2090.0,
    "high": 2105.0,
    "low": 2090.0,
    "close": 2105.0,
    "volume": 1.0,
    "total_volume": 5735.0,
    "chg_type": 2,
    "price_chg": 55.0,
    "pct_chg": 2.68,
    "simtrade": 0,
    "suspend": 0,
    "amount": 2105.0
  }
}
```

TS mapping: `Tick` (broker-port.ts) — camelCase conversion on TS client receipt.

| Python (snake_case) | TS (camelCase) | KGI raw attr |
|---|---|---|
| delay_time | delayTime | delay_time |
| odd_lot | oddLot | odd_lot |
| total_volume | totalVolume | total_volume |
| chg_type | chgType | chg_type |
| price_chg | priceChg | price_chg |
| pct_chg | pctChg | pct_chg |

---

## Error envelope (all error responses)

```json
{
  "error": {
    "code": "KGI_LOGIN_FAILED",
    "message": "human readable",
    "upstream": "raw KGI exception string (optional)"
  }
}
```

TS: `ErrorEnvelope` type in `kgi-gateway-client.ts`.  
Python: `ErrorEnvelope` / `ErrorDetail` in `schemas.py`.

---

## Adapter-side inference (not from KGI — kgi-contract-rules.ts)

These fields are NOT returned by KGI API. They are computed by the TS adapter layer.

| Field | Rule | Source |
|---|---|---|
| `boardLot` | 1000 for regular; 1 for symbols ending in "A" | `getBoardLot(symbol)` |
| `tickSize` | TWSE tier table by ref_price | `getTickSize(refPrice)` |
| `minQty` | always 1 unit | `getMinQty(symbol)` |
| `netQuantity` | `quantityCashTd + quantityMarginTd` | `enrichPosition()` |
| `market` | `"tse"→"TWSE"`, `"otc"→"TPEx"` | `normaliseMarket()` |

Position type string split:
- KGI returns `type = "odd /cash /margin /short"` (composite)
- Split by ` /` → `[odd, cash, margin, short]`
- Each `quantity_*` array indexed by position: `[0]=odd [1]=cash [2]=margin [3]=short`
- Source: `brokerport_golden_2026-04-23.md §176`
