"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import { primaryNavigation } from "@iuf-trading-room/ui";

import { getSession } from "@/lib/api";
import type { AppSession } from "@iuf-trading-room/contracts";

export function AppShell({
  title,
  eyebrow,
  children
}: {
  title: string;
  eyebrow: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [session, setSession] = useState<AppSession | null>(null);

  useEffect(() => {
    getSession()
      .then((res) => setSession(res.data))
      .catch(() => {});
  }, []);

  const now = new Date();
  const timeStr = now.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" });
  const dateStr = now.toLocaleDateString("zh-TW", { month: "2-digit", day: "2-digit", weekday: "short" });

  return (
    <div className="page-frame">
      {/* 窄側欄 */}
      <aside className="rail">
        <div className="rail-brand">IUF</div>
        <nav className="nav-stack">
          {primaryNavigation.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`nav-link${pathname === item.href ? " active" : ""}`}
            >
              {item.short}
            </Link>
          ))}
        </nav>
      </aside>

      {/* 頂部戰情列 */}
      <div className="status-bar">
        <strong>{session?.workspace.name ?? "主交易桌"}</strong>
        <span style={{ color: "var(--dim)" }}>|</span>
        <span>
          模式：<strong>{session?.persistenceMode === "database" ? "PostgreSQL" : session?.persistenceMode ?? "—"}</strong>
        </span>
        <span style={{ color: "var(--dim)" }}>|</span>
        <span>
          <span className={`status-dot ${session ? "green" : "yellow"}`} />{" "}
          {session ? "系統連線中" : "載入中..."}
        </span>
        <span className="status-bar-right">
          {dateStr} {timeStr}
        </span>
      </div>

      {/* 主內容 */}
      <main className="content">
        <header className="hero">
          <p className="eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
        </header>
        {children}
      </main>
    </div>
  );
}
