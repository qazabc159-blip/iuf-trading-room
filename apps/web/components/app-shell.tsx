import Link from "next/link";
import type { ReactNode } from "react";

import { primaryNavigation } from "@iuf-trading-room/ui";

import { WorkspaceStatus } from "./workspace-status";

export function AppShell({
  title,
  eyebrow,
  children
}: {
  title: string;
  eyebrow: string;
  children: ReactNode;
}) {
  return (
    <div className="page-frame">
      <aside className="rail">
        <div className="brand-block">
          <p className="eyebrow">IUF Trading Room</p>
          <h1>Control Tower</h1>
          <p className="rail-copy">
            Research-first workflow for themes, companies, signals, and execution plans.
          </p>
        </div>

        <WorkspaceStatus />

        <nav className="nav-stack">
          {primaryNavigation.map((item) => (
            <Link key={item.href} href={item.href} className="nav-link">
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>

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
