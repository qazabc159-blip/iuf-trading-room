"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { code: "01", path: "/", label: "DASHBOARD", tc: "戰情台" },
  { code: "02", path: "/themes", label: "THEMES", tc: "主題板" },
  { code: "03", path: "/companies", label: "COMPANIES", tc: "公司板" },
  { code: "04", path: "/ideas", label: "IDEAS", tc: "策略意見" },
  { code: "05", path: "/runs", label: "RUNS", tc: "策略歷史" },
  { code: "06", path: "/portfolio", label: "PORTFOLIO", tc: "下單台", exec: true },
  { code: "07", path: "/signals", label: "SIGNALS", tc: "訊號" },
  { code: "08", path: "/plans", label: "PLANS", tc: "計畫" },
  { code: "09", path: "/ops", label: "OPS", tc: "戰情室" },
  { code: "10", path: "/lab", label: "LAB", tc: "量化實驗室" },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="app-sidebar">
      <div className="brand-lockup">
        <div className="brand-mark">IUF</div>
        <div className="tg" style={{ marginTop: 10, color: "var(--night-ink)" }}>TRADING ROOM</div>
        <div className="tg" style={{ marginTop: 6 }}>OPERATOR · IUF·01</div>
        <div className="tg gold" style={{ marginTop: 5 }}>● ARMED</div>
      </div>

      <nav className="nav-list">
        {NAV.map((item) => {
          const active = item.path === "/" ? pathname === "/" : pathname.startsWith(item.path);
          return (
            <Link key={item.code} href={item.path} className="nav-link" data-active={active}>
              <span className="nav-code">{item.code}</span>
              <span>
                <span className="nav-label">{item.label}{item.exec && <span className="gold"> ·EXEC</span>}</span>
                <span className="nav-tc">{item.tc}</span>
              </span>
            </Link>
          );
        })}
      </nav>

      <div className="tg" style={{ padding: "13px 18px", borderTop: "1px solid var(--night-rule)", lineHeight: 1.8 }}>
        <div>⌘K · SEARCH</div>
        <div>⌘P · PALETTE</div>
        <div>⌘. · KILL</div>
        <div className="soft">REV · RADAR-0.8</div>
      </div>
    </aside>
  );
}
