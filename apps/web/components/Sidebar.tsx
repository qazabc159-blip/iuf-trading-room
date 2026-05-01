"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { apiLogout } from "@/lib/auth-client";

const NAV = [
  { code: "01", path: "/", label: "DASHBOARD", tc: "戰情台" },
  { code: "02", path: "/themes", label: "THEMES", tc: "主題板" },
  { code: "03", path: "/companies", label: "COMPANIES", tc: "公司板" },
  { code: "04", path: "/ideas", label: "IDEAS", tc: "策略想法" },
  { code: "05", path: "/runs", label: "RUNS", tc: "策略批次" },
  { code: "06", path: "/portfolio", label: "PORTFOLIO", tc: "紙上部位", exec: true },
  { code: "07", path: "/signals", label: "SIGNALS", tc: "訊號流" },
  { code: "08", path: "/plans", label: "PLANS", tc: "交易計畫" },
  { code: "09", path: "/ops", label: "OPS", tc: "營運監控" },
  { code: "10", path: "/market-intel", label: "INTEL", tc: "重大訊息" },
  { code: "11", path: "/lab", label: "LAB", tc: "量化實驗" },
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
        <div className="tg" style={{ marginTop: 10, color: "var(--night-ink)" }}>TRADING ROOM</div>
        <div className="tg" style={{ marginTop: 6 }}>OPERATOR / IUF-01</div>
        <div className="tg gold" style={{ marginTop: 5 }}>PAPER ARMED</div>
      </div>

      <nav className="nav-list">
        {NAV.map((item) => {
          const active = item.path === "/" ? pathname === "/" : pathname.startsWith(item.path);
          return (
            <Link key={item.code} href={item.path} className="nav-link" data-active={active}>
              <span className="nav-code">{item.code}</span>
              <span>
                <span className="nav-label">{item.label}{item.exec && <span className="gold"> / EXEC</span>}</span>
                <span className="nav-tc">{item.tc}</span>
              </span>
            </Link>
          );
        })}
      </nav>

      <div className="tg" style={{ padding: "13px 18px", borderTop: "1px solid var(--night-rule)", lineHeight: 1.8 }}>
        <div>Search / company universe</div>
        <div>Palette / Ctrl+K</div>
        <div>Kill / write-blocked</div>
        <div className="soft">REV / RADAR-0.8</div>
      </div>
      <button type="button" className="sidebar-logout" onClick={handleLogout}>
        LOGOUT
      </button>
    </aside>
  );
}
