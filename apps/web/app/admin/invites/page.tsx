import Link from "next/link";

import { PageFrame, Panel } from "@/components/PageFrame";

import { InviteIssuer } from "./InviteIssuer";

const INVITES_CSS = `
  ._bty-inv-hero {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 1px;
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.09);
    border-radius: 6px;
    margin-bottom: 16px;
    overflow: hidden;
  }
  ._bty-inv-hero-cell {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 14px 10px;
    background: rgba(0,0,0,0.25);
    gap: 5px;
  }
  ._bty-inv-hero-icon {
    font-size: 24px;
    line-height: 1;
  }
  ._bty-inv-hero-label {
    font-size: 11px;
    color: rgba(255,255,255,0.5);
    text-align: center;
    line-height: 1.4;
  }
  ._bty-inv-hero-val {
    font-size: 13px;
    font-weight: 600;
    color: #ffb800;
  }
`;

export default function InviteAdminPage() {
  return (
    <PageFrame
      code="ADM-INV"
      title="測試邀請碼"
      sub="帳號開通"
      note="測試邀請碼 / Owner-only；產生後交給測試者到註冊頁建立網站帳號。"
    >
      <style>{INVITES_CSS}</style>

      {/* Hero info strip */}
      <div className="_bty-inv-hero">
        <div className="_bty-inv-hero-cell">
          <span className="_bty-inv-hero-val" style={{ color: "#4caf50" }}>正常</span>
          <span className="_bty-inv-hero-label">端點狀態</span>
        </div>
        <div className="_bty-inv-hero-cell">
          <span className="_bty-inv-hero-val">Owner only</span>
          <span className="_bty-inv-hero-label">權限要求</span>
        </div>
        <div className="_bty-inv-hero-cell">
          <span className="_bty-inv-hero-val">一次性</span>
          <span className="_bty-inv-hero-label">邀請碼規則</span>
        </div>
        <div className="_bty-inv-hero-cell">
          <span className="_bty-inv-hero-val">Viewer</span>
          <span className="_bty-inv-hero-label">新帳號預設角色</span>
        </div>
      </div>

      <Panel code="INV-ISSUE" title="產生邀請碼" right="Owner-only">
        <InviteIssuer />
      </Panel>

      <Panel code="INV-FLOW" title="註冊流程" right="正式端點">
        <div className="state-panel">
          <span className="badge badge-green">正常</span>
          <span className="state-reason">
            這裡產生的是 IUF 網站帳號邀請碼，不是券商帳號。測試者拿到邀請碼後前往註冊頁建立帳號；
            後續證券帳號綁定、月費方案與功能權限會接在同一個網站帳號上。
          </span>
          <Link className="mini-button" href="/register" style={{ width: "fit-content" }}>
            前往註冊頁
          </Link>
        </div>
      </Panel>
    </PageFrame>
  );
}
