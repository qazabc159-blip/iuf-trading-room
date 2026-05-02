"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { apiLogout } from "@/lib/auth-client";

const NAV = [
  { icon: "dashboard", path: "/", label: "戰情台總覽", tc: "盤勢與任務" },
  { icon: "themes", path: "/themes", label: "主題板", tc: "產業主題" },
  { icon: "companies", path: "/companies", label: "公司板", tc: "台股公司池" },
  { icon: "ideas", path: "/ideas", label: "策略想法", tc: "候選清單" },
  { icon: "runs", path: "/runs", label: "策略批次", tc: "批次紀錄" },
  { icon: "trade", path: "/portfolio", label: "模擬交易室", tc: "委託與部位", exec: true },
  { icon: "signals", path: "/signals", label: "訊號證據", tc: "訊號與依據" },
  { icon: "plans", path: "/plans", label: "交易計畫", tc: "計畫註記" },
  { icon: "ops", path: "/ops", label: "營運監控", tc: "系統狀態" },
  { icon: "intel", path: "/market-intel", label: "重大訊息", tc: "公告與新聞" },
  { icon: "lab", path: "/lab", label: "量化研究", tc: "策略包" },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    await apiLogout();
    router.push("/login");
  }

  return (
    <aside className="app-sidebar">
      <div className="brand-lockup">
        <div className="brand-mark">IUF</div>
        <div className="sidebar-title">台股 AI 交易戰情室</div>
        <div className="sidebar-meta">操作員 / IUF-01</div>
        <div className="sidebar-mode">模擬模式 / 風控守門</div>
      </div>

      <nav className="nav-list" aria-label="主要導覽">
        {NAV.map((item) => {
          const active = item.path === "/" ? pathname === "/" : pathname.startsWith(item.path);
          return (
            <Link key={item.path} href={item.path} className="nav-link" data-active={active}>
              <span className={`nav-icon nav-icon-${item.icon}`} aria-hidden="true">
                <span />
              </span>
              <span>
                <span className="nav-label">{item.label}</span>
                <span className="nav-tc">{item.tc}</span>
              </span>
            </Link>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <div>搜尋 / 台股公司池</div>
        <div>命令面板 / Ctrl+K</div>
        <div className="soft">交易模式 / 風控監管</div>
      </div>
      <button type="button" className="sidebar-logout" onClick={handleLogout}>
        登出
      </button>
    </aside>
  );
}
