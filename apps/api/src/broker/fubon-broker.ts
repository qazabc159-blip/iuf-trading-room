/**
 * fubon-broker.ts — Fubon domain broker (thin normalisation layer over the gateway client)
 *
 * UTA-C3 skeleton (2026-07-04). Delegates all I/O to FubonGatewayClient. Unlike
 * KgiBroker, GAP-v1 already returns normalised (non-DataFrame) JSON, so this
 * layer's job is small: board-lot enrichment for display + a single seam that
 * fubon-broker-adapter.ts (the UTA wrapper) depends on instead of the gateway
 * client directly.
 *
 * boardLot is a plain TWSE/TPEx regular-lot constant here (1000) — NOT reused
 * from kgi-contract-rules.getBoardLot(), which infers odd-lot via a KGI-specific
 * symbol suffix convention ("00981A") that Neo SDK is not confirmed to share
 * (see FUBON_ADAPTER_INTERFACE_FREEZE_v1.md §4 SDK mapping TBD table). IsOddLot
 * is derived from qty instead, which holds regardless of SDK naming.
 */

import {
  FubonGatewayClient,
  type FubonGatewayClientConfig,
  type FubonOrderCreateInput,
  type FubonOrderResult,
  type FubonOrderCancelResult,
  type FubonOrderTodayEntry,
} from "./fubon-gateway-client.js";

const FUBON_BOARD_LOT = 1000;

export interface FubonPosition {
  symbol: string;
  qty: number;          // shares
  avgPrice: number;
  lastPrice: number;
  unrealized: number;
  realized: number;
  boardLot: number;
  isOddLot: boolean;
}

export interface FubonBalance {
  cashAvailable: number;
}

export class FubonBroker {
  private readonly gateway: FubonGatewayClient;

  constructor(config: FubonGatewayClientConfig = {}) {
    this.gateway = new FubonGatewayClient(config);
  }

  async health() {
    return this.gateway.health();
  }

  async sessionStatus() {
    return this.gateway.sessionStatus();
  }

  async getPositions(): Promise<FubonPosition[]> {
    const raw = await this.gateway.getPositions();
    return raw.map((p) => ({
      ...p,
      boardLot: FUBON_BOARD_LOT,
      isOddLot: p.qty % FUBON_BOARD_LOT !== 0,
    }));
  }

  async getBalances(): Promise<FubonBalance> {
    const raw = await this.gateway.getBalances();
    return { cashAvailable: raw.cashAvailable };
  }

  async createOrder(input: FubonOrderCreateInput): Promise<FubonOrderResult> {
    return this.gateway.createOrder(input);
  }

  async cancelOrder(orderId: string): Promise<FubonOrderCancelResult> {
    return this.gateway.cancelOrder(orderId);
  }

  async getOrdersToday(): Promise<FubonOrderTodayEntry[]> {
    return this.gateway.getOrdersToday();
  }

  /** Expose gateway for integration testing. */
  get _gateway(): FubonGatewayClient {
    return this.gateway;
  }
}
