"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  BarChart3,
  Brain,
  Building2,
  GitFork,
  LineChart,
  Newspaper,
  Radio,
  Sparkles,
  Target,
  Wrench,
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

const INTERNAL_NAV: NavItem[] = [
  { path: "/admin/brain/llm", title: "Brain", sub: "AI 成本與用量", Icon: Brain, activePaths: ["/admin/brain"] },
  { path: "/admin/events", title: "EventLog", sub: "事件與稽核", Icon: GitFork, activePaths: ["/admin/events"] },
  { path: "/admin/portfolio/snapshots", title: "Portfolio", sub: "快照版本", Icon: LineChart, activePaths: ["/admin/portfolio/snapshots"] },
  { path: "/admin/tools", title: "Tools", sub: "工具執行紀錄", Icon: Wrench, activePaths: ["/admin/tools"] },
  { path: "/admin/uta/accounts", title: "UTA", sub: "帳號與權限", Icon: Sparkles, activePaths: ["/admin/uta"] },
  { path: "/admin/strategies", title: "Strategies", sub: "策略治理", Icon: BarChart3, activePaths: ["/admin/strategies"] },
  { path: "/ops/f-auto", title: "F-AUTO SIM", sub: "KGI SIM / S1", Icon: Radio, activePaths: ["/ops/f-auto"] },
];

function pathMatches(pathname: string, path: string) {
  if (path === "/") return pathname === "/";
  return pathname === path || pathname.startsWith(`${path}/`);
}

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const navRef = useRef<HTMLElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const activeLink = navRef.current?.querySelector<HTMLElement>('a[aria-current="page"]');
    activeLink?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [mounted, pathname]);

  async function handleLogout() {
    await apiLogout();
    router.push("/login");
  }

  const internalActive = INTERNAL_NAV.some((item) => item.activePaths.some((path) => pathMatches(pathname, path)));

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

      <nav ref={navRef} className="tac-nav" aria-label="主要導覽">
        {NAV.map((item) => {
          const active = mounted && item.activePaths.some((path) => pathMatches(pathname, path));
          const Icon = item.Icon;
          return (
            <Link
              key={item.path}
              href={item.path}
              className={active ? "active" : ""}
              aria-current={active ? "page" : undefined}
            >
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

      <details className="tac-sidebar-internal" open={internalActive || undefined}>
        <summary aria-label="內部控管導覽">
          <span>內部控管</span>
          <small>Owner / 系統</small>
        </summary>
        <nav className="tac-nav tac-nav-admin" aria-label="內部控管導覽">
          {INTERNAL_NAV.map((item) => {
            const active = mounted && item.activePaths.some((path) => pathMatches(pathname, path));
            const Icon = item.Icon;
            return (
              <Link
                key={item.path}
                href={item.path}
                className={active ? "active" : ""}
                aria-current={active ? "page" : undefined}
              >
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
      </details>

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
