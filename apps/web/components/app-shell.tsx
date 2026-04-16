"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import { primaryNavigation } from "@iuf-trading-room/ui";

import { getSession } from "@/lib/api";
import type { AppSession } from "@iuf-trading-room/contracts";

import { BootSequence } from "./boot-sequence";
import { CommandPalette } from "./command-palette";
import { TickerTape } from "./ticker-tape";

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

      {/* 頂部戰情列 — ticker tape 活體跑馬燈 */}
      <div className="status-bar">
        <strong style={{ flexShrink: 0 }}>
          {session?.workspace.name ?? "主交易桌"}
        </strong>
        <span style={{ color: "var(--dim)", flexShrink: 0 }}>|</span>
        <span style={{ flexShrink: 0 }}>
          <span className={`status-dot ${session ? "green" : "yellow"}`} />{" "}
          {session?.persistenceMode === "database" ? "PostgreSQL" : session?.persistenceMode ?? "—"}
        </span>
        <span style={{ color: "var(--dim)", flexShrink: 0 }}>|</span>

        <TickerTape />

        <span className="status-bar-right" style={{ flexShrink: 0 }}>
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

      <CommandPalette />
      <BootSequence />
    </div>
  );
}
