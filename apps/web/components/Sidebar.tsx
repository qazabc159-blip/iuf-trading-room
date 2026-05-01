"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { apiLogout } from "@/lib/auth-client";

const NAV = [
  { code: "01", icon: "dashboard", path: "/", label: "戰情台", tc: "總覽" },
  { code: "02", icon: "themes", path: "/themes", label: "主題板", tc: "產業鏈" },
  { code: "03", icon: "companies", path: "/companies", label: "公司板", tc: "個股資料" },
  { code: "04", icon: "ideas", path: "/ideas", label: "策略想法", tc: "候選單" },
  { code: "05", icon: "runs", path: "/runs", label: "策略批次", tc: "批次紀錄" },
  { code: "06", icon: "trade", path: "/portfolio", label: "交易室", tc: "模擬 / 風控", exec: true },
  { code: "07", icon: "signals", path: "/signals", label: "訊號證據", tc: "訊號流" },
  { code: "08", icon: "plans", path: "/plans", label: "交易計畫", tc: "計畫書" },
  { code: "09", icon: "ops", path: "/ops", label: "營運監控", tc: "系統狀態" },
  { code: "10", icon: "intel", path: "/market-intel", label: "重大訊息", tc: "公告新聞" },
  { code: "11", icon: "lab", path: "/lab", label: "量化研究", tc: "研究包" },
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
        <div className="tg" style={{ marginTop: 10, color: "var(--night-ink)" }}>交易戰情室</div>
        <div className="tg" style={{ marginTop: 6 }}>操作員 / IUF-01</div>
        <div className="tg gold" style={{ marginTop: 5 }}>紙上模式 / 風控守門</div>
      </div>

      <nav className="nav-list" aria-label="主要導覽">
        {NAV.map((item) => {
          const active = item.path === "/" ? pathname === "/" : pathname.startsWith(item.path);
          return (
            <Link key={item.code} href={item.path} className="nav-link" data-active={active}>
              <span className={`nav-icon nav-icon-${item.icon}`} aria-hidden="true">
                <span />
              </span>
              <span>
                <span className="nav-label">{item.label}{item.exec && <span className="gold"> / 執行</span>}</span>
                <span className="nav-tc">{item.tc}</span>
              </span>
            </Link>
          );
        })}
      </nav>

      <div className="tg" style={{ padding: "13px 18px", borderTop: "1px solid var(--night-rule)", lineHeight: 1.8 }}>
        <div>搜尋 / 真實公司池</div>
        <div>指令面板 / Ctrl+K</div>
        <div>交易模式 / 風控控管</div>
        <div className="soft">前端 / 真資料介面</div>
      </div>
      <button type="button" className="sidebar-logout" onClick={handleLogout}>
        登出
      </button>
    </aside>
  );
}
