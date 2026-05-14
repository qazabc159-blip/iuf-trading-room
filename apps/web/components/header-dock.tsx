"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Bell, FileText, LogOut, Settings, User, X } from "lucide-react";

import { apiLogout } from "@/lib/auth-client";

type Drawer = "alerts" | "system" | null;

export function HeaderDock() {
  const router = useRouter();
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [accountOpen, setAccountOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setDrawer(null);
        setAccountOpen(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  async function handleLogout() {
    await apiLogout();
    router.push("/login");
  }

  const drawerTitle = drawer === "alerts" ? "警示" : "系統狀態";

  return (
    <>
      <div className="header-dock" aria-label="右上快捷列">
        <button
          type="button"
          className="header-dock-button"
          aria-label="警示"
          aria-expanded={drawer === "alerts"}
          aria-controls={drawer === "alerts" ? "header-dock-drawer" : undefined}
          title="警示"
          onClick={() => {
            setAccountOpen(false);
            setDrawer((current) => (current === "alerts" ? null : "alerts"));
          }}
        >
          <Bell size={18} strokeWidth={1.8} />
          <span className="header-dock-dot" aria-hidden="true" />
        </button>

        <Link className="header-dock-button" aria-label="今日簡報" title="今日簡報" href="/briefs">
          <FileText size={18} strokeWidth={1.8} />
        </Link>

        <button
          type="button"
          className="header-dock-button"
          aria-label="系統狀態"
          aria-expanded={drawer === "system"}
          aria-controls={drawer === "system" ? "header-dock-drawer" : undefined}
          title="系統狀態"
          onClick={() => {
            setAccountOpen(false);
            setDrawer((current) => (current === "system" ? null : "system"));
          }}
        >
          <Settings size={18} strokeWidth={1.8} />
        </button>

        <button
          type="button"
          className="header-dock-button"
          aria-label="帳戶"
          aria-expanded={accountOpen}
          title="帳戶"
          onClick={() => {
            setDrawer(null);
            setAccountOpen((current) => !current);
          }}
        >
          <User size={18} strokeWidth={1.8} />
        </button>

        {accountOpen && (
          <div className="header-account-menu" role="menu" aria-label="帳戶選單">
            <div className="header-account-card">
              <span>個資</span>
              <b>Owner Workspace</b>
            </div>
            <button type="button" role="menuitem" onClick={handleLogout}>
              <LogOut size={15} strokeWidth={1.9} />
              <span>登出</span>
            </button>
          </div>
        )}
      </div>

      {drawer && <button type="button" className="header-dock-scrim" aria-label="關閉面板" onClick={() => setDrawer(null)} />}

      {drawer && (
        <aside id="header-dock-drawer" className="header-dock-drawer" role="dialog" aria-modal="false" aria-label={drawerTitle}>
          <div className="header-dock-drawer-head">
            <div>
              <span className="tg gold">DOCK</span>
              <h2>{drawerTitle}</h2>
            </div>
            <button type="button" aria-label="關閉" onClick={() => setDrawer(null)}>
              <X size={18} strokeWidth={1.9} />
            </button>
          </div>

          {drawer === "alerts" ? (
            <div className="header-dock-drawer-body">
              <div className="header-dock-state">
                <span>DAY 6</span>
                <b>Notification Center</b>
                <p>最近 7 天事件準備接入：風控、委託、推薦變更與系統事件。</p>
              </div>
              <Link href="/alerts" onClick={() => setDrawer(null)}>
                開啟警示頁
              </Link>
            </div>
          ) : (
            <div className="header-dock-drawer-body">
              <div className="header-dock-state">
                <span>STATUS</span>
                <b>SIM-only v1</b>
                <p>模擬交易與券商 SIM 會清楚分線；正式交易維持關閉。</p>
              </div>
              <Link href="/ops" onClick={() => setDrawer(null)}>
                開啟營運監控
              </Link>
            </div>
          )}
        </aside>
      )}
    </>
  );
}
