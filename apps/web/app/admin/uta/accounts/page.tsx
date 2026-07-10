import { PageFrame, Panel } from "@/components/PageFrame";
import {
  getUtaAdapters,
  getUtaOrders,
  type BrokerAdapterEntry,
  type UnifiedOrderEntry,
} from "@/lib/api";
import { isKnownSimOnlyAdapter, safetyModeLabel, sideLabel } from "./uta-order-vocab";

const CSS = `
  ._uta-kpi {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(90px, 1fr));
    gap: 1px;
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.09);
    border-radius: 6px;
    margin-bottom: 16px;
    overflow: hidden;
  }
  ._uta-kpi-cell {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 10px 8px;
    background: rgba(0,0,0,0.25);
    gap: 4px;
  }
  ._uta-kpi-val {
    font-size: 18px;
    font-weight: 700;
    font-family: var(--mono, monospace);
    color: #e0e0e0;
    line-height: 1;
  }
  ._uta-kpi-lbl {
    font-size: 10px;
    color: rgba(255,255,255,0.4);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  ._uta-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 11px;
  }
  ._uta-table th {
    text-align: left;
    padding: 6px 10px;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: rgba(255,255,255,0.4);
    border-bottom: 1px solid rgba(255,255,255,0.08);
  }
  ._uta-table td {
    padding: 7px 10px;
    color: rgba(255,255,255,0.75);
    border-bottom: 1px solid rgba(255,255,255,0.04);
    font-family: var(--mono, monospace);
  }
  ._uta-table tr:last-child td { border-bottom: none; }
  ._uta-table tr:hover td { background: rgba(255,255,255,0.02); }
  ._uta-table-scroll {
    width: 100%;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }
  ._uta-table-scroll ._uta-table {
    min-width: 640px;
  }
  ._uta-table-scroll--orders ._uta-table {
    min-width: 860px;
  }
  ._uta-badge {
    display: inline-flex;
    align-items: center;
    white-space: nowrap;
    padding: 1px 6px;
    border-radius: 3px;
    font-size: 10px;
    font-weight: 600;
  }
  ._uta-cap-grid {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  ._uta-cap-tag {
    padding: 1px 6px;
    border-radius: 3px;
    font-size: 10px;
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.1);
    color: rgba(255,255,255,0.6);
  }
  ._uta-account-hint {
    padding: 12px 14px;
    background: rgba(255,184,0,0.05);
    border: 1px solid rgba(255,184,0,0.15);
    border-radius: 6px;
    font-size: 11px;
    color: rgba(255,184,0,0.7);
    margin-top: 4px;
    line-height: 1.6;
  }
`;

function adaptorBadgeStyle(isActive: boolean) {
  return isActive
    ? { background: "rgba(76,175,80,0.15)", color: "#4caf50", border: "1px solid rgba(76,175,80,0.3)" }
    : { background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.4)", border: "1px solid rgba(255,255,255,0.1)" };
}

function sideBadgeStyle(action: string) {
  if (action === "Buy") return { background: "rgba(76,175,80,0.15)", color: "#4caf50", border: "1px solid rgba(76,175,80,0.3)" };
  if (action === "Sell") return { background: "rgba(239,83,80,0.15)", color: "#ef5350", border: "1px solid rgba(239,83,80,0.3)" };
  return { background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.5)", border: "1px solid rgba(255,255,255,0.1)" };
}

function statusBadgeStyle(status: string) {
  if (status === "filled") return { background: "rgba(76,175,80,0.15)", color: "#4caf50", border: "1px solid rgba(76,175,80,0.3)" };
  if (status === "rejected" || status === "cancelled") return { background: "rgba(239,83,80,0.15)", color: "#ef5350", border: "1px solid rgba(239,83,80,0.3)" };
  if (status === "pending" || status === "submitted") return { background: "rgba(255,184,0,0.15)", color: "#ffb800", border: "1px solid rgba(255,184,0,0.3)" };
  return { background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.5)", border: "1px solid rgba(255,255,255,0.1)" };
}

function safetyModeBadgeStyle(simOnly: boolean) {
  return simOnly
    ? { background: "rgba(33,150,243,0.15)", color: "#42a5f5", border: "1px solid rgba(33,150,243,0.3)" }
    : { background: "rgba(255,184,0,0.12)", color: "#ffb800", border: "1px solid rgba(255,184,0,0.3)" };
}

function fmtDT(iso: string) {
  return new Date(iso).toLocaleString("zh-TW", { hour12: false });
}

function SyncNote({ reason }: { reason: string }) {
  return (
    <div className="state-panel">
      <span className="badge badge-yellow">資料同步中</span>
      <span className="state-reason">{reason}</span>
    </div>
  );
}

function capList(caps: BrokerAdapterEntry["capabilities"]) {
  const items: string[] = [];
  if (caps.oddLot) items.push("零股");
  if (caps.marginTrading) items.push("融資");
  if (caps.shortSelling) items.push("融券");
  if (caps.afterHoursFixing) items.push("盤後");
  if (caps.simModeAvailable) items.push("SIM");
  if (caps.maxSubscriptions != null) items.push(`訂閱 ≤${caps.maxSubscriptions}`);
  return items;
}

function AdapterTable({ adapters }: { adapters: BrokerAdapterEntry[] }) {
  return (
    <div className="_uta-table-scroll">
      <table className="_uta-table">
        <thead>
          <tr>
            <th>adapter_key</th>
            <th>名稱</th>
            <th>能力</th>
            <th>狀態</th>
          </tr>
        </thead>
        <tbody>
          {adapters.length === 0
            ? <tr><td colSpan={4} style={{ color: "rgba(255,255,255,0.3)", textAlign: "center" }}>尚無 adapter 登錄</td></tr>
            : adapters.map((a) => (
              <tr key={a.adapterKey}>
                <td style={{ color: "#ffb800" }}>{a.adapterKey}</td>
                <td>{a.displayName}</td>
                <td>
                  <div className="_uta-cap-grid">
                    {capList(a.capabilities).map((cap) => (
                      <span key={cap} className="_uta-cap-tag">{cap}</span>
                    ))}
                  </div>
                </td>
                <td>
                  <span className="_uta-badge" style={adaptorBadgeStyle(a.isActive)}>
                    {a.isActive ? "啟用" : "停用"}
                  </span>
                </td>
              </tr>
            ))
          }
        </tbody>
      </table>
    </div>
  );
}

function OrdersTable({ orders }: { orders: UnifiedOrderEntry[] }) {
  return (
    <div className="_uta-table-scroll _uta-table-scroll--orders">
      <table className="_uta-table">
        <thead>
          <tr>
            <th>時間</th>
            <th>broker</th>
            <th>ticker</th>
            <th>方向</th>
            <th>數量</th>
            <th>單位</th>
            <th>限價</th>
            <th>狀態</th>
            <th>安全模式</th>
          </tr>
        </thead>
        <tbody>
          {orders.length === 0
            ? <tr><td colSpan={9} style={{ color: "rgba(255,255,255,0.3)", textAlign: "center" }}>尚無委託記錄</td></tr>
            : orders.map((o) => (
              <tr key={o.id}>
                <td style={{ whiteSpace: "nowrap" }}>{fmtDT(o.createdAt)}</td>
                <td>{o.adapterKey}</td>
                <td style={{ color: "#ffb800" }}>{o.symbol}</td>
                <td><span className="_uta-badge" style={sideBadgeStyle(o.action)}>{sideLabel(o.action)}</span></td>
                <td>{o.qty}</td>
                <td>{o.quantityUnit}</td>
                <td>{o.limitPrice ?? "市價"}</td>
                <td><span className="_uta-badge" style={statusBadgeStyle(o.status)}>{o.status}</span></td>
                <td>
                  <span className="_uta-badge" style={safetyModeBadgeStyle(isKnownSimOnlyAdapter(o.adapterKey))}>{safetyModeLabel(isKnownSimOnlyAdapter(o.adapterKey))}</span>
                </td>
              </tr>
            ))
          }
        </tbody>
      </table>
    </div>
  );
}

export default async function UtaAccountsPage() {
  let adapters: BrokerAdapterEntry[] = [];
  let orders: UnifiedOrderEntry[] = [];
  let adaptersError = false;
  let ordersError = false;

  try {
    const res = await getUtaAdapters();
    adapters = res.data?.adapters ?? [];
  } catch {
    adaptersError = true;
  }

  try {
    const res = await getUtaOrders({ limit: 50 });
    orders = res.data?.orders ?? [];
  } catch {
    ordersError = true;
  }

  return (
    <PageFrame
      code="ADM-UTA"
      title="UTA 帳號管理"
      sub="OpenAlice Phase A / 唯讀"
      note="Broker Adapter 登錄 / 跨 broker 委託總覽 — Owner only。Phase A 僅讀，不提供正式委託操作入口。"
    >
      <style>{CSS}</style>

      <div className="_uta-kpi">
        <div className="_uta-kpi-cell">
          <span className="_uta-kpi-val" style={{ color: adaptersError ? "#ffb800" : "#4caf50" }}>{adaptersError ? "同步中" : "正常"}</span>
          <span className="_uta-kpi-lbl">端點狀態</span>
        </div>
        <div className="_uta-kpi-cell">
          <span className="_uta-kpi-val">{adapters.length}</span>
          <span className="_uta-kpi-lbl">Broker Adapter</span>
        </div>
        <div className="_uta-kpi-cell">
          <span className="_uta-kpi-val">{orders.length}</span>
          <span className="_uta-kpi-lbl">近期委託</span>
        </div>
        <div className="_uta-kpi-cell">
          <span className="_uta-kpi-val">{orders.filter((o) => isKnownSimOnlyAdapter(o.adapterKey)).length}</span>
          <span className="_uta-kpi-lbl">SIM 委託</span>
        </div>
      </div>

      <Panel code="ADM-UTA-ADAPTERS" title="Broker Adapter 登錄" right={adaptersError ? "同步中" : `${adapters.length} 個`}>
        {adaptersError
          ? <SyncNote reason="Adapter 登錄暫時無法讀取。" />
          : <AdapterTable adapters={adapters} />
        }
      </Panel>

      <Panel code="ADM-UTA-ACCOUNTS" title="Broker 帳號" right="Phase A — 未開放建立">
        <div className="state-panel">
          <span className="badge badge-yellow">Phase A</span>
          <span className="state-reason">
            Phase A 無帳號建立 UI — broker credentials 需 Yang 在後台設定。
          </span>
        </div>
        <div className="_uta-account-hint">
          Phase B 計畫：Credential Vault (KMS 加密) + 多帳號聚合 + cross-broker routing。
          Phase A 僅 read-only adapter 瀏覽。楊董設好 broker creds 後，帳號會自動出現在委託記錄。
        </div>
      </Panel>

      <Panel code="ADM-UTA-ORDERS" title="跨 Broker 委託記錄（近 50 筆）" right={ordersError ? "同步中" : `${orders.length} 筆`}>
        {ordersError
          ? <SyncNote reason="委託記錄暫時無法讀取。" />
          : <OrdersTable orders={orders} />
        }
      </Panel>
    </PageFrame>
  );
}
