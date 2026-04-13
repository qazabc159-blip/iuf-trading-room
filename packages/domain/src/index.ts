import { getPersistenceMode } from "@iuf-trading-room/db";

import { MemoryTradingRoomRepository } from "./memory-repository.js";
import { PostgresTradingRoomRepository } from "./postgres-repository.js";

export type { SessionOptions, TradingRoomRepository } from "./types.js";

export function getTradingRoomRepository() {
  return getPersistenceMode() === "database"
    ? new PostgresTradingRoomRepository()
    : new MemoryTradingRoomRepository();
}
