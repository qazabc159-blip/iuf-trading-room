import Link from "next/link";

import { PageFrame, Panel } from "@/components/PageFrame";

import { InviteIssuer } from "./InviteIssuer";

export default function InviteAdminPage() {
  return (
    <PageFrame
      code="ADM-INV"
      title="測試邀請碼"
      sub="帳號開通"
      note="測試邀請碼 / Owner-only；產生後交給測試者到註冊頁建立網站帳號。"
    >
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
