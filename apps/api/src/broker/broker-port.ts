/**
 * BrokerPort — canonical adapter interface for IUF Trading Room
 *
 * All canonical fields are derived from Phase 0 live verification evidence:
 * - Login / Account: brokerport_golden_2026-04-23.md §1-18
 * - Quote callbacks: brokerport_golden_2026-04-23.md §42-64
 *   + evidence_2026-04-23/step3a_live_opening_0900.log line 80-84 (Tick/BidAsk live schema)
 * - Order write (create_order signature): brokerport_golden_2026-04-23.md §68-98
 * - Order read (get_trades/get_deals/get_position shapes): brokerport_golden_2026-04-23.md §169-199
 *   + evidence_2026-04-23/step7_order_state_probe.log (get_position DataFrame shape, 9 columns)
 * - Contract meta: brokerport_golden_2026-04-23.md §201-226
 *   + evidence_2026-04-23/step8_contract_probe.log (2,653 symbols, 10 Contract attrs)
 * - Order event callback: brokerport_golden_2026-04-23.md §117-124 (single-param data)
 *
 * Adapter-side inference (board_lot / tick_size / position type split) lives in
 * kgi-contract-rules.ts. This interface exposes normalised TS types only.
 *
 * B0 scope: interface + TS types only. No gateway calls are wired.
 */

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

/**
 * Credentials passed to login().
 * KGI uses person_id (uppercase — see phase0 uppercase rule feedback) + password.
 * simulation flag controls tradeapi.kgi.com.tw vs itradetest.kgi.com.tw.
 *
 * Source: brokerport_golden_2026-04-23.md §7
 */
export interface KgiBrokerCredentials {
  personId: string;        // e.g. "YOUR_PERSON_ID" — MUST be uppercase
  personPwd: string;
  simulation?: boolean;    // default false; sim env currently blocked by KGI error 78
}

/**
 * Returned by showAccounts().
 * Source: brokerport_golden_2026-04-23.md §12-13
 *   ["{'account': 'YOUR_ACCOUNT', 'account_flag': '證券', 'broker_id': 'YOUR_BROKER_ID'}"]
 */
export interface KgiAccount {
  account: string;         // e.g. "YOUR_ACCOUNT"
  accountFlag: string;     // e.g. "證券"
  brokerId: string;        // e.g. "YOUR_BROKER_ID"
}

/** Opaque session token returned after successful login. */
export interface BrokerSession {
  accountId: string;       // the account string passed to setAccount()
  connectedAt: string;     // ISO-8601
}

// ---------------------------------------------------------------------------
// Quote data shapes
// ---------------------------------------------------------------------------

/**
 * Canonical Tick shape — flattened from KGI Tick_Stock_v1.
 * Source: evidence_2026-04-23/step3a_live_opening_0900.log line 80
 *   Tick_Stock_v1(exchange='TWSE', symbol='2330', delay_time=0.0, odd_lot=False,
 *     datetime='20260423090038', open=2090.0, high=2105.0, low=2090.0, close=2105.0,
 *     volume=1, total_volume=5735.0, chg_type=2, price_chg=55.0, pct_chg=2.68,
 *     simtrade=0, suspend=0, amount=2105.0)
 */
export interface Tick {
  exchange: string;        // "TWSE" | "TPEx"
  symbol: string;
  delayTime: number;       // ms
  oddLot: boolean;
  datetime: string;        // "20260423090038" — KGI format YYYYMMDDHHMMSS
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  totalVolume: number;
  chgType: number;
  priceChg: number;
  pctChg: number;
  simtrade: number;
  suspend: number;
  amount: number;
}

/**
 * Canonical BidAsk shape — flattened from KGI BidAsk_Stock_v1.
 * Source: evidence_2026-04-23/step3a_live_opening_0900.log line 81
 *   BidAsk_Stock_v1(exchange='TWSE', symbol='2330', delay_time=0.0, odd_lot=False,
 *     datetime='20260423090038',
 *     bid_prices=[2100.0,2095.0,2090.0,2085.0,2080.0], bid_volumes=[251,266,442,440,553],
 *     ask_prices=[2105.0,2110.0,2115.0,2120.0,2125.0], ask_volumes=[445,529,282,314,409],
 *     diff_ask_vol=[...], diff_bid_vol=[...], simtrade=0, suspend=0)
 */
export interface BidAsk {
  exchange: string;
  symbol: string;
  delayTime: number;
  oddLot: boolean;
  datetime: string;
  bidPrices: [number, number, number, number, number];   // 5-level
  bidVolumes: [number, number, number, number, number];
  askPrices: [number, number, number, number, number];
  askVolumes: [number, number, number, number, number];
  diffAskVol: [number, number, number, number, number];
  diffBidVol: [number, number, number, number, number];
  simtrade: number;
  suspend: number;
}

// ---------------------------------------------------------------------------
// Order write — input types
// ---------------------------------------------------------------------------

/**
 * Source: brokerport_golden_2026-04-23.md §72-85 (create_order signature)
 * Enum origins: kgisuperpy.trading._trade_base.*
 *   Action / PriceType / TimeInForce / OrderCond / OddLot
 */
export type KgiAction = "Buy" | "Sell";

/** PriceType — pass a number for limit price, or one of these strings for special types. */
export type KgiPriceType = number | "MKT" | "Reference" | "LimitUp" | "LimitDown";

/** TimeInForce — KGI ROD is "rest of day", equivalent to contracts timeInForce "rod". */
export type KgiTimeInForce = "ROD" | "IOC" | "FOK";

/**
 * OrderCond — maps to margin/short/lending classification.
 * Source: brokerport_golden_2026-04-23.md §78-82
 */
export type KgiOrderCond =
  | "Cash"
  | "CashSelling"
  | "Margin"
  | "MarginDayTrade"
  | "ShortSelling"
  | "LendSelling";

/**
 * OddLot — bool false = regular lot; enum values for specific odd-lot session routing.
 * Source: brokerport_golden_2026-04-23.md §83-84
 */
export type KgiOddLot = boolean | "Common" | "Fixing" | "Odd" | "OddAfterMarket";

/** Full input shape for createOrder(). */
export interface KgiCreateOrderInput {
  action: KgiAction;
  symbol: string;
  qty: number;
  price?: KgiPriceType;            // defaults to MKT if omitted
  timeInForce?: KgiTimeInForce;    // defaults to ROD
  orderCond?: KgiOrderCond;        // defaults to Cash
  oddLot?: KgiOddLot;             // defaults to false (regular lot)
  name?: string;                   // optional order label
}

// ---------------------------------------------------------------------------
// Order read — response types
// ---------------------------------------------------------------------------

/**
 * KGI Trade — opaque until B1 paper dry-run produces a real instance.
 * Source: brokerport_golden_2026-04-23.md §187-188
 *   get_trades(full=False) empty: {} — dict keyed by order_id when populated
 * Using Record<string, unknown> for now; will be tightened in B1.
 */
export type KgiTradeRaw = Record<string, unknown>;

/**
 * get_trades(full=True) bucket map.
 * Source: PHASE0_CLOSE_2026-04-23.md §47-51
 *   Empty state: {'無效單': []}
 * Key is a KGI-defined bucket label (e.g. "無效單", "有效單").
 * Value is array of trade records — open schema until B1 evidence.
 */
export type KgiTradesFullRaw = Record<string, unknown[]>;

/**
 * get_deals() raw.
 * Source: brokerport_golden_2026-04-23.md §196-199
 *   Empty: {} — keyed by deal_id when populated
 */
export type KgiDealsRaw = Record<string, unknown>;

/**
 * Normalised Position — adapter converts the pandas DataFrame row to this shape.
 * Source: brokerport_golden_2026-04-23.md §172-184
 *   index=symbol, columns: type / quantity_yd / quantity_td / quantity_B / quantity_S /
 *   lastprice / realized / unrealized
 * The "type" string "odd /cash /margin /short" is SPLIT by kgi-contract-rules.ts
 * into the 4 sub-fields below.
 */
export interface KgiPosition {
  symbol: string;               // row index from DataFrame
  // Adapter-side normalised sub-fields (split from type string):
  quantityOddYd: number;        // quantity_yd[0] — odd lot yesterday
  quantityCashYd: number;       // quantity_yd[1] — cash yesterday
  quantityMarginYd: number;     // quantity_yd[2] — margin yesterday
  quantityShortYd: number;      // quantity_yd[3] — short yesterday
  quantityOddTd: number;        // quantity_td[0]
  quantityCashTd: number;
  quantityMarginTd: number;
  quantityShortTd: number;
  quantityBoughtOdd: number;    // quantity_B[0]
  quantityBoughtCash: number;
  quantityBoughtMargin: number;
  quantityBoughtShort: number;
  quantitySoldOdd: number;      // quantity_S[0]
  quantitySoldCash: number;
  quantitySoldMargin: number;
  quantitySoldShort: number;
  lastPrice: number;
  realized: number;
  unrealized: number;
  // Adapter-side enrichment (kgi-contract-rules.ts):
  boardLot: number;             // 1000 for regular, 1 for odd-lot symbol
  netQuantity: number;          // sum of cash+margin holdings (today)
}

// ---------------------------------------------------------------------------
// Contract meta — read from api.Order.contract(type='dic')
// ---------------------------------------------------------------------------

/**
 * KGI Contract attrs (10) from api.Order.contract(type='dic').
 * Source: brokerport_golden_2026-04-23.md §212-224
 *   + evidence_2026-04-23/step8_contract_probe.log
 */
export interface KgiContract {
  symbol: string;
  name: string;
  market: "tse" | "otc" | string;     // "tse" = TWSE, "otc" = TPEx
  category: string;                    // e.g. "IC-製造"
  subCategory: string;                 // e.g. "先進製程"
  refPrice: number;
  bullLimit: number;                   // 漲停
  bearLimit: number;                   // 跌停
  dayTrade: "Yes" | "No" | string;
  updateDate: string;                  // ISO date string (from pd.Timestamp)
  // Adapter-side enrichment (NOT from KGI — kgi-contract-rules.ts):
  boardLot: number;                    // 1000 (TWSE/TPEx regular), 1 (odd-lot)
  tickSize: number;                    // see kgi-contract-rules TICK_SIZE table
  minQty: number;                      // 1 lot (regular); 1 share (odd-lot)
}

// ---------------------------------------------------------------------------
// Order events
// ---------------------------------------------------------------------------

/**
 * Order event types from api.Order.set_event().
 * Source: brokerport_golden_2026-04-23.md §119-123
 *   Response codes: pending=6002 / NewOrder event=4010 / Deal event=4011
 */
export type KgiOrderEventType =
  | "NewOrder"       // code 4010
  | "Deal"           // code 4011
  | "UpdatePrice"
  | "UpdateQty"
  | "CancelOrder";

/**
 * Raw order event envelope — actual payload shape confirmed in B1.
 * single-param callback: on_order_event(data)
 */
export interface KgiOrderEventRaw {
  type: KgiOrderEventType;
  code?: number;     // 6002 / 4010 / 4011
  data: unknown;
}

// ---------------------------------------------------------------------------
// The canonical BrokerPort interface
// ---------------------------------------------------------------------------

/**
 * BrokerPort — the typed seam between IUF strategy engine and any real broker adapter.
 *
 * Implementations:
 * - KgiBroker (apps/api/src/broker/kgi-broker.ts) — routes to kgi-gateway-client
 * - PaperBroker (apps/api/src/broker/paper-broker.ts) — in-process simulation
 *
 * All methods are async (Promise-based) to accommodate the HTTP/WS round-trip to
 * the Windows gateway process (Path B architecture).
 *
 * Canonical fields source: brokerport_golden_2026-04-23.md §126-166
 */
export interface BrokerPort {
  // -------------------------------------------------------------------------
  // Session
  // -------------------------------------------------------------------------

  /** Login with broker credentials. Returns session info after set_Account handshake. */
  login(credentials: KgiBrokerCredentials): Promise<BrokerSession>;

  /** Logout and tear down WebSocket connections. */
  logout(): Promise<void>;

  /**
   * List all accounts available for this login.
   * Maps to kgisuperpy api.show_account().
   * Source: brokerport_golden_2026-04-23.md §12-13
   */
  showAccounts(): Promise<KgiAccount[]>;

  /**
   * Select the active trading account.
   * IMPORTANT: only passes the account STRING — not the full dict.
   * Maps to api.set_Account(account: string).
   * Source: brokerport_golden_2026-04-23.md §15-16
   */
  setAccount(accountId: string): Promise<void>;

  // -------------------------------------------------------------------------
  // Quote
  // -------------------------------------------------------------------------

  /**
   * Register the tick callback. Must be called before subscribeTick().
   * Callback receives a single Tick argument (not (exchange, tick)).
   * Source: brokerport_golden_2026-04-23.md §60-63
   */
  onTick(cb: (tick: Tick) => void): void;

  /**
   * Register the bid/ask callback.
   * Source: brokerport_golden_2026-04-23.md §60-63
   */
  onBidAsk(cb: (bidask: BidAsk) => void): void;

  /**
   * Subscribe to tick stream for a symbol.
   * Maps to api.Quote.subscribe_tick(symbol, odd_lot, version=v1).
   * Source: brokerport_golden_2026-04-23.md §50-51
   */
  subscribeTick(symbol: string, opts?: { oddLot?: boolean }): Promise<void>;

  /**
   * Subscribe to bid/ask stream for a symbol.
   * Maps to api.Quote.subscribe_bidask(symbol, odd_lot, version=v1).
   * Source: brokerport_golden_2026-04-23.md §52-53
   */
  subscribeBidAsk(symbol: string, opts?: { oddLot?: boolean }): Promise<void>;

  /**
   * Unsubscribe by label (returned from subscribe calls).
   * Maps to api.Quote.unsubscribe(label).
   * Source: brokerport_golden_2026-04-23.md §55
   */
  unsubscribe(label: string): Promise<void>;

  // -------------------------------------------------------------------------
  // Order write
  // -------------------------------------------------------------------------

  /**
   * Submit a new order.
   * Maps to api.Order.create_order(...).
   * Response codes: pending=6002 / NewOrder event=4010 / Deal event=4011.
   * Source: brokerport_golden_2026-04-23.md §68-98
   * NOTE: actual create_order call NOT verified in Phase 0 — verified in B1.
   */
  createOrder(input: KgiCreateOrderInput): Promise<KgiTradeRaw>;

  /**
   * Cancel an existing order by order_id.
   * Maps to api.Order.cancel_order(order_id).
   * Source: brokerport_golden_2026-04-23.md §102
   */
  cancelOrder(orderId: string): Promise<void>;

  /**
   * Modify price or quantity of an existing order.
   * Maps to api.Order.update_order(order_id, price?, qty?).
   * Source: brokerport_golden_2026-04-23.md §103
   */
  updateOrder(orderId: string, patch: { price?: number; qty?: number }): Promise<void>;

  // -------------------------------------------------------------------------
  // Order read
  // -------------------------------------------------------------------------

  /**
   * Query submitted orders.
   * full=false (default): dict keyed by order_id, empty={}.
   * full=true: bucket map — at minimum {'無效單': []}. Schema open until B1.
   * Source: brokerport_golden_2026-04-23.md §186-193
   */
  getTrades(full?: false): Promise<KgiTradeRaw>;
  getTrades(full: true): Promise<KgiTradesFullRaw>;
  getTrades(full?: boolean): Promise<KgiTradeRaw | KgiTradesFullRaw>;

  /**
   * Query filled deals.
   * Empty state: {}. Keyed by deal_id when populated.
   * Source: brokerport_golden_2026-04-23.md §196-199
   */
  getDeals(): Promise<KgiDealsRaw>;

  /**
   * Query current portfolio positions.
   * Returns one entry per symbol held. Adapter normalises the KGI DataFrame row
   * (type string split, quantity_* arrays indexed) into KgiPosition objects.
   * Source: brokerport_golden_2026-04-23.md §172-184
   *         evidence_2026-04-23/step7_order_state_probe.log (00981A, 36 shares)
   */
  getPosition(): Promise<KgiPosition[]>;

  // -------------------------------------------------------------------------
  // Meta
  // -------------------------------------------------------------------------

  /**
   * Fetch contract spec for a single symbol.
   * Returns KgiContract with adapter-side enrichment (boardLot / tickSize / minQty).
   * Maps to api.Order.contract(type='dic')[symbol].
   * Source: brokerport_golden_2026-04-23.md §201-226
   */
  getContract(symbol: string): Promise<KgiContract | null>;

  /**
   * Fetch all contracts as a map (symbol → KgiContract).
   * Covers 2,653 TSE+OTC symbols per step8 probe.
   * Source: evidence_2026-04-23/step8_contract_probe.log
   */
  listContracts(): Promise<Map<string, KgiContract>>;

  // -------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------

  /**
   * Register order lifecycle event callback.
   * Maps to api.Order.set_event(fn). Callback receives single arg data.
   * Event types: NewOrder(4010) / Deal(4011) / UpdatePrice / UpdateQty / CancelOrder.
   * Source: brokerport_golden_2026-04-23.md §117-123
   */
  onOrderEvent(cb: (event: KgiOrderEventRaw) => void): void;
}
