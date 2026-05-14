"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BarChart3,
  Building2,
  LineChart,
  Newspaper,
  Sparkles,
  Target,
  type LucideIcon,
} from "lucide-react";

import { apiLogout } from "@/lib/auth-client";

type NavItem = {
  path: string;
  title: string;
  sub: string;
  Icon: LucideIcon;
  activePaths: string[];
};

const NAV: NavItem[] = [
  { path: "/", title: "戰情台", sub: "盤勢與任務", Icon: Target, activePaths: ["/"] },
  { path: "/market-intel", title: "市場情報", sub: "重大訊息", Icon: Newspaper, activePaths: ["/market-intel"] },
  {
    path: "/ai-recommendations",
    title: "AI 推薦",
    sub: "推薦引擎",
    Icon: Sparkles,
    activePaths: ["/ai-recommendations", "/ideas", "/runs", "/signals"],
  },
  {
    path: "/portfolio",
    title: "交易室",
    sub: "委託與部位",
    Icon: LineChart,
    activePaths: ["/portfolio", "/plans"],
  },
  {
    path: "/companies",
    title: "公司 / 主題",
    sub: "公司圖譜",
    Icon: Building2,
    activePaths: ["/companies", "/themes"],
  },
  {
    path: "/quant-strategies",
    title: "量化策略",
    sub: "SIM-only",
    Icon: BarChart3,
    activePaths: ["/quant-strategies", "/lab"],
  },
];

function pathMatches(pathname: string, path: string) {
  if (path === "/") return pathname === "/";
  return pathname === path || pathname.startsWith(`${path}/`);
}

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
          const active = item.activePaths.some((path) => pathMatches(pathname, path));
          const Icon = item.Icon;
          return (
            <Link key={item.path} href={item.path} className={active ? "active" : ""}>
              <span className="tac-nav-icon" aria-hidden="true">
                <Icon size={17} strokeWidth={1.9} />
              </span>
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
