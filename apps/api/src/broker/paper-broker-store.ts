import { and, eq } from "drizzle-orm";

import type {
  AppSession,
  BrokerAccount,
  Fill,
  Order
} from "@iuf-trading-room/contracts";
import { getDb, paperBrokerState } from "@iuf-trading-room/db";

// Mirror of paper-broker.ts internal state, with Maps unrolled so JSON.stringify
// round-trips losslessly.
export type PaperAccountSnapshot = {
  account: BrokerAccount;
  cash: number;
  positions: Array<{
    symbol: string;
    quantity: number;
    avgPrice: number;
    openedAt: string;
  }>;
  orders: Order[];
  fills: Fill[];
  realizedPnlToday: number;
  lastEventAt: string | null;
  createdAt: string;
};

function shouldPersist(session: AppSession): boolean {
  return session.persistenceMode === "database";
}

export async function loadWorkspaceSnapshots(
  session: AppSession
): Promise<Map<string, PaperAccountSnapshot>> {
  if (!shouldPersist(session)) return new Map();
  const db = getDb();
  if (!db) return new Map();

  const rows = await db
    .select({
      accountId: paperBrokerState.accountId,
      state: paperBrokerState.state
    })
    .from(paperBrokerState)
    .where(eq(paperBrokerState.workspaceId, session.workspace.id));

  const out = new Map<string, PaperAccountSnapshot>();
  for (const row of rows) {
    out.set(row.accountId, row.state as PaperAccountSnapshot);
  }
  return out;
}

export async function saveAccountSnapshot(
  session: AppSession,
  accountId: string,
  snapshot: PaperAccountSnapshot
): Promise<void> {
  if (!shouldPersist(session)) return;
  const db = getDb();
  if (!db) return;

  await db
    .insert(paperBrokerState)
    .values({
      workspaceId: session.workspace.id,
      accountId,
      state: snapshot,
      updatedAt: new Date()
    })
    .onConflictDoUpdate({
      target: [paperBrokerState.workspaceId, paperBrokerState.accountId],
      set: {
        state: snapshot,
        updatedAt: new Date()
      }
    });
}

export async function deleteWorkspaceSnapshots(session: AppSession): Promise<void> {
  if (!shouldPersist(session)) return;
  const db = getDb();
  if (!db) return;
  await db
    .delete(paperBrokerState)
    .where(eq(paperBrokerState.workspaceId, session.workspace.id));
}

export async function deleteAccountSnapshot(
  session: AppSession,
  accountId: string
): Promise<void> {
  if (!shouldPersist(session)) return;
  const db = getDb();
  if (!db) return;
  await db
    .delete(paperBrokerState)
    .where(
      and(
        eq(paperBrokerState.workspaceId, session.workspace.id),
        eq(paperBrokerState.accountId, accountId)
      )
    );
}
