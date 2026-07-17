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
import { getMarketDataOverview } from "@/lib/api";
import {
  CANONICAL_PRODUCT_SURFACES,
  INTERNAL_ADMIN_SURFACES,
  OWNER_PRODUCT_SURFACES,
  meetsMinRole,
  type WebSurface,
  type WorkspaceRole,
} from "@/lib/canonical-surfaces";
import { dataStateLabel, dataStateTone } from "@/lib/data-state-copy";
import { deriveTickerDisplay } from "@/lib/ticker-tape";

type NavItem = {
  path: string;
  title: string;
  sub: string;
  Icon: LucideIcon;
  activePaths: readonly string[];
  minRole: WorkspaceRole;
};

const SURFACE_ICONS: Record<string, LucideIcon> = {
  "/": Target,
  "/market-intel": Newspaper,
  "/ai-recommendations": Sparkles,
  "/portfolio": LineChart,
  "/companies": Building2,
  "/quant-strategies": BarChart3,
  "/ops/f-auto": Radio,
  "/admin/brain/llm": Brain,
  "/admin/brain/decisions": Network,
  "/admin/events": GitFork,
  "/admin/portfolio/snapshots": LineChart,
  "/admin/tools": Wrench,
  "/admin/uta/accounts": Sparkles,
  "/admin/strategies": BarChart3,
  "/admin/team": Users,
};

function surfaceToNavItem(surface: WebSurface): NavItem {
  return {
    path: surface.path,
    title: surface.title,
    sub: surface.sub,
    Icon: SURFACE_ICONS[surface.path] ?? Target,
    activePaths: surface.activePaths,
    minRole: surface.minRole,
  };
}

const PRODUCT_NAV = CANONICAL_PRODUCT_SURFACES.map(surfaceToNavItem);
const OWNER_PRODUCT_NAV = OWNER_PRODUCT_SURFACES.map(surfaceToNavItem);
const INTERNAL_ADMIN_NAV = INTERNAL_ADMIN_SURFACES.map(surfaceToNavItem);

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
  // 2026-07-18 全產品走查修復：這顆「資料健康 / 風控狀態」原本是全站每頁恆顯示
  // 同一句靜態文字（無任何資料來源、永遠套用 --tac-ok 綠色），跟頁面真實狀態
  // 無關——等於永遠謊報「健康」，違反「不假綠」的產品鐵律。改成跟 TickerTape
  // 同一支既有 `GET /api/v1/market-data/overview` 端點（零新後端）真的算出
  // live/close/delayed/empty 四態；抓不到就走 `empty` 誠實安靜態，不再假綠。
  const [marketHealth, setMarketHealth] = useState<ReturnType<typeof deriveTickerDisplay> | null>(null);

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
    let cancelled = false;

    void getMarketDataOverview({ includeStale: true, topLimit: 1 })
      .then((response) => {
        if (cancelled) return;
        setMarketHealth(deriveTickerDisplay(response.data));
      })
      .catch(() => {
        if (cancelled) return;
        setMarketHealth((current) => current ?? deriveTickerDisplay(null));
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
  const primaryNav = [...PRODUCT_NAV, ...OWNER_PRODUCT_NAV].filter((item) => meetsMinRole(userRole, item.minRole));
  const visibleInternalAdminNav = INTERNAL_ADMIN_NAV.filter((item) => meetsMinRole(userRole, item.minRole));
  const internalActive = visibleInternalAdminNav.some((item) => item.activePaths.some((path) => pathMatches(pathname, path)));

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

      {visibleInternalAdminNav.length > 0 && (
        <details className="tac-sidebar-internal" open={internalActive || undefined}>
          <summary aria-label="內部後台導覽">
            <span>內部後台</span>
            <small>{isOwner ? "Owner-only" : "內部限定"}</small>
          </summary>
          <nav className="tac-nav tac-nav-admin" aria-label="內部後台導覽">
            {visibleInternalAdminNav.map((item) => {
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
          <b style={{ color: dataStateTone(marketHealth?.dataState ?? "empty").color }}>
            資料健康：{marketHealth ? dataStateLabel({ state: marketHealth.dataState, asOf: marketHealth.asOf, reason: marketHealth.reason }) : "查詢中"}
          </b>
          <em>風控：Real Order 鎖定．僅 Paper/SIM</em>
        </div>
      </div>
      <button type="button" className="tac-sidebar-logout" onClick={handleLogout}>
        登出
      </button>
    </aside>
  );
}
