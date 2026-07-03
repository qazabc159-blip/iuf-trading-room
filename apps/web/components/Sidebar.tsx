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
  Network,
  Newspaper,
  Radio,
  Sparkles,
  Target,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";

import { apiGetMe, apiLogout } from "@/lib/auth-client";

type NavItem = {
  path: string;
  title: string;
  sub: string;
  Icon: LucideIcon;
  activePaths: string[];
};

const NAV: NavItem[] = [
  { path: "/", title: "戰情台", sub: "今日總覽", Icon: Target, activePaths: ["/"] },
  { path: "/market-intel", title: "市場情報", sub: "AI 精選", Icon: Newspaper, activePaths: ["/market-intel"] },
  {
    path: "/ai-recommendations",
    title: "AI 推薦",
    sub: "推薦股票",
    Icon: Sparkles,
    activePaths: ["/ai-recommendations", "/ideas", "/runs", "/signals"],
  },
  {
    path: "/portfolio",
    title: "交易室",
    sub: "Paper / SIM",
    Icon: LineChart,
    activePaths: ["/portfolio", "/plans"],
  },
  {
    path: "/companies",
    title: "公司 / 主題",
    sub: "公司雷達",
    Icon: Building2,
    activePaths: ["/companies", "/themes"],
  },
  {
    path: "/quant-strategies",
    title: "量化策略",
    sub: "SIM-only",
    Icon: BarChart3,
    activePaths: ["/quant-strategies"],
  },
];

const OWNER_NAV: NavItem[] = [
  {
    path: "/ops/f-auto",
    title: "F-AUTO SIM",
    sub: "S1 持倉 / 損益",
    Icon: Radio,
    activePaths: ["/ops/f-auto"],
  },
];

const INTERNAL_NAV: NavItem[] = [
  { path: "/admin/brain/llm", title: "Brain", sub: "AI 費用與模型", Icon: Brain, activePaths: ["/admin/brain/llm"] },
  { path: "/admin/brain/decisions", title: "主腦決策", sub: "決策流", Icon: Network, activePaths: ["/admin/brain/decisions"] },
  { path: "/admin/events", title: "EventLog", sub: "事件流", Icon: GitFork, activePaths: ["/admin/events"] },
  { path: "/admin/portfolio/snapshots", title: "Portfolio", sub: "快照版本", Icon: LineChart, activePaths: ["/admin/portfolio/snapshots"] },
  { path: "/admin/tools", title: "Tools", sub: "工具登錄", Icon: Wrench, activePaths: ["/admin/tools"] },
  { path: "/admin/uta/accounts", title: "UTA", sub: "帳號管理", Icon: Sparkles, activePaths: ["/admin/uta"] },
  { path: "/admin/strategies", title: "Strategies", sub: "策略治理", Icon: BarChart3, activePaths: ["/admin/strategies"] },
  { path: "/admin/team", title: "團隊與邀請", sub: "用戶 / 邀請管理", Icon: Users, activePaths: ["/admin/team"] },
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
  const [userRole, setUserRole] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    let cancelled = false;

    void apiGetMe().then((result) => {
      if (cancelled) return;
      setUserRole(result.ok ? result.user.role : null);
    });

    return () => {
      cancelled = true;
    };
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

  const isOwner = userRole === "Owner";
  const primaryNav = isOwner ? [...NAV, ...OWNER_NAV] : NAV;
  const internalActive = INTERNAL_NAV.some((item) => item.activePaths.some((path) => pathMatches(pathname, path)));

  return (
    <aside className="app-sidebar app-tactical-sidebar tac-sidebar">
      <div className="tac-brand">
        <div className="tac-brand-row">
          <div className="tac-logo">I<span /></div>
          <div>
            <div className="tac-brand-kicker">IUF Trading Room</div>
            <div className="tac-brand-version">v3.0 · Tactical</div>
          </div>
        </div>
        <strong>台股 AI 交易戰情室</strong>
        <small>操作員 · IUF-01</small>
        <div className="tac-mode"><span />Paper / SIM 模式 · Real Order 停用</div>
      </div>

      <nav ref={navRef} className="tac-nav" aria-label="主要導覽">
        {primaryNav.map((item) => {
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

      {isOwner && (
        <details className="tac-sidebar-internal" open={internalActive || undefined}>
          <summary aria-label="內部後台導覽">
            <span>內部後台</span>
            <small>Owner-only</small>
          </summary>
          <nav className="tac-nav tac-nav-admin" aria-label="內部後台導覽">
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
      )}

      <div className="tac-sidebar-radar">
        <span className="tac-mini-radar" />
        <div>
          <small>MARKET INTEL</small>
          <b>資料健康 / 風控狀態</b>
        </div>
      </div>
      <button type="button" className="tac-sidebar-logout" onClick={handleLogout}>
        登出
      </button>
    </aside>
  );
}
