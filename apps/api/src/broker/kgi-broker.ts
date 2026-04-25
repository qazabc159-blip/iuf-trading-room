/**
 * kgi-broker.ts — KGI broker adapter (BrokerPort implementation)
 *
 * Implements BrokerPort by delegating all I/O to KgiGatewayClient.
 * Applies adapter-side normalisation (board_lot / tick_size / position type split)
 * via kgi-contract-rules.ts.
 *
 * B0 scope: skeleton with stub delegation to gateway client.
 * All methods delegate to KgiGatewayClient (which throws NotImplementedError in B0).
 * Real gateway wiring: Path B W1-W5.
 *
 * Key adapter decisions:
 * 1. set_Account() pitfall: only passes account string, not the full {account, account_flag, broker_id} dict.
 *    Source: brokerport_golden_2026-04-23.md §15-16 — "注意只吃 account 字串，不是整個 dict"
 * 2. get_position().type is "odd /cash /margin /short" composite string — split into 4 sub-fields.
 *    Source: PHASE0_CLOSE_2026-04-23.md §31, brokerport_golden_2026-04-23.md §176
 * 3. get_trades(full=True) may return {'無效單': []} bucket — open schema, Record<string, unknown[]>.
 *    Source: PHASE0_CLOSE_2026-04-23.md §47-51
 * 4. contract() does not include board_lot / tick_size / min_qty — enriched by kgi-contract-rules.ts.
 *    Source: brokerport_golden_2026-04-23.md §226
 */

import type { BrokerPort } from "./broker-port.js";
import type {
  BidAsk,
  BrokerSession,
  KgiAccount,
  KgiBrokerCredentials,
  KgiContract,
  KgiCreateOrderInput,
  KgiDealsRaw,
  KgiOrderEventRaw,
  KgiPosition,
  KgiTradeRaw,
  KgiTradesFullRaw,
  Tick,
} from "./broker-port.js";
import {
  getBoardLot,
  getTickSize,
  normaliseMarket,
  parsePositionTypeString,
  getQuantityByLabel,
} from "./kgi-contract-rules.js";
import {
  KgiGatewayClient,
  type KgiGatewayClientConfig,
} from "./kgi-gateway-client.js";

// ---------------------------------------------------------------------------
// KgiBroker
// ---------------------------------------------------------------------------

export class KgiBroker implements BrokerPort {
  private readonly gateway: KgiGatewayClient;
  private session: BrokerSession | null = null;

  constructor(config: KgiGatewayClientConfig) {
    this.gateway = new KgiGatewayClient(config);
  }

  // -------------------------------------------------------------------------
  // Session
  // -------------------------------------------------------------------------

  /**
   * Login via gateway. After gateway returns, setAccount() is NOT called here —
   * the caller must invoke setAccount(accounts[0].account) explicitly.
   * This preserves the "show accounts → pick one → set" flow.
   */
  async login(credentials: KgiBrokerCredentials): Promise<BrokerSession> {
    const result = await this.gateway.login(credentials);
    this.session = {
      accountId: "",   // populated after setAccount()
      connectedAt: result.connectedAt,
    };
    return this.session;
  }

  async logout(): Promise<void> {
    await this.gateway.logout();
    this.session = null;
  }

  /**
   * Returns List[{account, accountFlag, brokerId}].
   * Source: brokerport_golden_2026-04-23.md §12-13
   */
  async showAccounts(): Promise<KgiAccount[]> {
    return this.gateway.showAccounts();
  }

  /**
   * Set the active trading account.
   *
   * CRITICAL: only pass the account string (e.g. "0308732"), NOT the full dict.
   * KGI set_Account() only accepts the account string parameter.
   * Source: brokerport_golden_2026-04-23.md §15-16
   *
   * Upper-level callers should do:
   *   const accounts = await broker.showAccounts();
   *   await broker.setAccount(accounts[0].account);
   */
  async setAccount(accountId: string): Promise<void> {
    await this.gateway.setAccount(accountId);
    if (this.session) {
      this.session = { ...this.session, accountId };
    }
  }

  // -------------------------------------------------------------------------
  // Quote — callbacks registered before subscriptions
  // -------------------------------------------------------------------------

  onTick(cb: (tick: Tick) => void): void {
    this.gateway.setTickCallback(cb);
  }

  onBidAsk(cb: (bidask: BidAsk) => void): void {
    this.gateway.setBidAskCallback(cb);
  }

  async subscribeTick(symbol: string, opts?: { oddLot?: boolean }): Promise<void> {
    await this.gateway.subscribeTick(symbol, opts);
  }

  async subscribeBidAsk(symbol: string, opts?: { oddLot?: boolean }): Promise<void> {
    await this.gateway.subscribeBidAsk(symbol, opts);
  }

  async unsubscribe(label: string): Promise<void> {
    await this.gateway.unsubscribe(label);
  }

  // -------------------------------------------------------------------------
  // Order write
  // -------------------------------------------------------------------------

  async createOrder(input: KgiCreateOrderInput): Promise<KgiTradeRaw> {
    return this.gateway.createOrder(input);
  }

  async cancelOrder(orderId: string): Promise<void> {
    await this.gateway.cancelOrder(orderId);
  }

  async updateOrder(orderId: string, patch: { price?: number; qty?: number }): Promise<void> {
    await this.gateway.updateOrder(orderId, patch);
  }

  // -------------------------------------------------------------------------
  // Order read
  // -------------------------------------------------------------------------

  getTrades(full?: false): Promise<KgiTradeRaw>;
  getTrades(full: true): Promise<KgiTradesFullRaw>;
  async getTrades(full?: boolean): Promise<KgiTradeRaw | KgiTradesFullRaw> {
    if (full === true) {
      return this.gateway.getTrades(true);
    }
    return this.gateway.getTrades(false);
  }

  async getDeals(): Promise<KgiDealsRaw> {
    return this.gateway.getDeals();
  }

  /**
   * Fetch positions and normalise the KGI DataFrame row format.
   *
   * KGI returns a pandas DataFrame with:
   *   - index = symbol (may have "A" suffix for odd-lot positions, e.g. "00981A")
   *   - type = "odd /cash /margin /short" (composite string)
   *   - quantity_yd / quantity_td / quantity_B / quantity_S = number[4]
   *   - lastprice, realized, unrealized
   *
   * This adapter:
   * 1. Calls parsePositionTypeString() to validate the type string format.
   * 2. Indexes each quantity array by label (odd/cash/margin/short).
   * 3. Enriches with boardLot from kgi-contract-rules.getBoardLot().
   * 4. Computes netQuantity = quantityCashTd + quantityMarginTd.
   *
   * Source: brokerport_golden_2026-04-23.md §172-184
   *         PHASE0_CLOSE_2026-04-23.md §26-40 (00981A sample: 36 odd-lot shares)
   */
  async getPosition(): Promise<KgiPosition[]> {
    const rawPositions = await this.gateway.getPosition();
    // In B0 the gateway stubs returns KgiPosition[] directly.
    // In W1+ the gateway will return raw DataFrame rows; normalisation will move here.
    // The normalisation logic is expressed here as a no-op passthrough with enrichment.
    return rawPositions.map((pos) => enrichPosition(pos));
  }

  // -------------------------------------------------------------------------
  // Meta
  // -------------------------------------------------------------------------

  async getContract(symbol: string): Promise<KgiContract | null> {
    const contract = await this.gateway.getContract(symbol);
    if (!contract) return null;
    return enrichContract(contract);
  }

  async listContracts(): Promise<Map<string, KgiContract>> {
    const contracts = await this.gateway.listContracts();
    const enriched = new Map<string, KgiContract>();
    for (const [symbol, contract] of contracts) {
      enriched.set(symbol, enrichContract(contract));
    }
    return enriched;
  }

  // -------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------

  onOrderEvent(cb: (event: KgiOrderEventRaw) => void): void {
    this.gateway.setOrderEventCallback(cb);
  }

  // -------------------------------------------------------------------------
  // Accessors for testing
  // -------------------------------------------------------------------------

  /** Expose gateway for integration testing (inject synthetic events etc.) */
  get _gateway(): KgiGatewayClient {
    return this.gateway;
  }

  get currentSession(): BrokerSession | null {
    return this.session;
  }
}

// ---------------------------------------------------------------------------
// Adapter-side enrichment helpers
// ---------------------------------------------------------------------------

/**
 * Enrich a KgiPosition with adapter-side inferred fields.
 * Called after the gateway returns normalised position data.
 * In W1+ this will also handle the raw DataFrame → KgiPosition conversion.
 */
function enrichPosition(pos: KgiPosition): KgiPosition {
  return {
    ...pos,
    boardLot: getBoardLot(pos.symbol),
    netQuantity: pos.quantityCashTd + pos.quantityMarginTd,
  };
}

/**
 * Enrich a KgiContract with adapter-side inferred fields:
 * boardLot / tickSize / minQty (not exposed by KGI API).
 * market string normalised from "tse"/"otc" → "TWSE"/"TPEx".
 *
 * Source: kgi-contract-rules.ts; brokerport_golden_2026-04-23.md §226
 */
function enrichContract(contract: KgiContract): KgiContract {
  return {
    ...contract,
    market: normaliseMarket(contract.market),
    boardLot: getBoardLot(contract.symbol),
    tickSize: getTickSize(contract.refPrice),
    minQty: 1,  // always 1 unit (lot for regular, share for odd-lot)
  };
}

/**
 * normaliseRawPosition — convert raw gateway DataFrame row to KgiPosition.
 * Called in W1+ when the gateway returns unstructured JSON from the Python DataFrame.
 * Exported for unit testing; not used in B0 (gateway returns KgiPosition directly).
 *
 * @param symbol     - The DataFrame index value (e.g. "00981A", "2330")
 * @param rawType    - The "type" column string: "odd /cash /margin /short"
 * @param quantityYd - The quantity_yd list[int64] from gateway JSON
 * @param quantityTd - The quantity_td list[int64]
 * @param quantityB  - The quantity_B list[int64]
 * @param quantityS  - The quantity_S list[int64]
 * @param lastPrice  - The lastprice float
 * @param realized   - Realized P&L
 * @param unrealized - Unrealized P&L
 */
export function normaliseRawPosition(
  symbol: string,
  rawType: string,
  quantityYd: number[],
  quantityTd: number[],
  quantityB: number[],
  quantityS: number[],
  lastPrice: number,
  realized: number,
  unrealized: number
): KgiPosition {
  // Validate type string — throws if format changes in future KGI SDK versions.
  parsePositionTypeString(rawType);

  return {
    symbol,
    quantityOddYd:    getQuantityByLabel(quantityYd, "odd"),
    quantityCashYd:   getQuantityByLabel(quantityYd, "cash"),
    quantityMarginYd: getQuantityByLabel(quantityYd, "margin"),
    quantityShortYd:  getQuantityByLabel(quantityYd, "short"),
    quantityOddTd:    getQuantityByLabel(quantityTd, "odd"),
    quantityCashTd:   getQuantityByLabel(quantityTd, "cash"),
    quantityMarginTd: getQuantityByLabel(quantityTd, "margin"),
    quantityShortTd:  getQuantityByLabel(quantityTd, "short"),
    quantityBoughtOdd:    getQuantityByLabel(quantityB, "odd"),
    quantityBoughtCash:   getQuantityByLabel(quantityB, "cash"),
    quantityBoughtMargin: getQuantityByLabel(quantityB, "margin"),
    quantityBoughtShort:  getQuantityByLabel(quantityB, "short"),
    quantitySoldOdd:      getQuantityByLabel(quantityS, "odd"),
    quantitySoldCash:     getQuantityByLabel(quantityS, "cash"),
    quantitySoldMargin:   getQuantityByLabel(quantityS, "margin"),
    quantitySoldShort:    getQuantityByLabel(quantityS, "short"),
    lastPrice,
    realized,
    unrealized,
    boardLot:    getBoardLot(symbol),
    netQuantity: getQuantityByLabel(quantityTd, "cash") + getQuantityByLabel(quantityTd, "margin"),
  };
}
