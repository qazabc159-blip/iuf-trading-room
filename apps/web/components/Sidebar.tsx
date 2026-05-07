"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { apiLogout } from "@/lib/auth-client";

const NAV = [
  { path: "/", title: "戰情台總覽", sub: "盤勢與任務", code: "01" },
  { path: "/market-intel", title: "市場情報", sub: "重大訊息", code: "02" },
  { path: "/companies", title: "公司板", sub: "台股公司池", code: "03" },
  { path: "/ideas", title: "策略想法", sub: "候選清單", code: "04" },
  { path: "/runs", title: "策略批次", sub: "批次紀錄", code: "05" },
  { path: "/portfolio", title: "模擬交易室", sub: "委託與部位", code: "06" },
  { path: "/signals", title: "訊號證據", sub: "訊號與依據", code: "07" },
  { path: "/plans", title: "交易計畫", sub: "計畫註記", code: "08" },
  { path: "/themes", title: "主題板", sub: "產業主題", code: "09" },
  { path: "/ops", title: "營運監控", sub: "系統狀態", code: "10" },
  { path: "/lab", title: "量化研究", sub: "策略包", code: "11" },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    await apiLogout();
    router.push("/login");
  }

  return (
    <aside className="app-sidebar app-tactical-sidebar tac-sidebar">
      <div className="tac-brand">
        <div className="tac-brand-row">
          <div className="tac-logo">I<span /></div>
          <div>
            <div className="tac-brand-kicker">IUF · 戰情台</div>
            <div className="tac-brand-version">v3.0 · TACTICAL</div>
          </div>
        </div>
        <strong>台股 AI 交易戰情室</strong>
        <small>操作員 · IUF-01</small>
        <div className="tac-mode"><span />模擬模式 / 風控守門</div>
      </div>

      <nav className="tac-nav" aria-label="主要導覽">
        {NAV.map((item) => {
          const active = item.path === "/" ? pathname === "/" : pathname.startsWith(item.path);
          return (
            <Link key={item.path} href={item.path} className={active ? "active" : ""}>
              <span>{item.code}</span>
              <div>
                <b>{item.title}</b>
                <small>{item.sub}</small>
              </div>
              {active && <i />}
            </Link>
          );
        })}
      </nav>

      <div className="tac-sidebar-radar">
        <span className="tac-mini-radar" />
        <div>
          <small>MARKET · INTEL</small>
          <b>正式資料 / 風控守門</b>
        </div>
      </div>
      <button type="button" className="tac-sidebar-logout" onClick={handleLogout}>
        登出
      </button>
    </aside>
  );
}
