import type { Metadata, Viewport } from "next";

export const metadata: Metadata = { title: "IUF TR Mobile" };
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function MobileLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="mobile-route"
      style={{
        minHeight: "100vh",
        background: "var(--night)",
        color: "var(--night-ink)",
        paddingBottom: 74,
      }}
    >
      {children}
      <MobileNav />
    </div>
  );
}

function MobileNav() {
  const items = [
    { href: "/m", label: "快覽", sub: "行動" },
    { href: "/m/kill", label: "風控", sub: "模式" },
    { href: "/", label: "戰情台", sub: "完整" },
  ];

  return (
    <nav
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        borderTop: "1px solid var(--night-rule-strong)",
        background: "var(--night)",
        backdropFilter: "blur(12px)",
        paddingBottom: "env(safe-area-inset-bottom)",
        zIndex: 50,
      }}
    >
      {items.map((item, index) => (
        <a
          key={item.href}
          href={item.href}
          style={{
            padding: "13px 10px",
            textAlign: "center",
            borderRight: index < items.length - 1 ? "1px solid var(--night-rule)" : "none",
            color: "var(--night-ink)",
            textDecoration: "none",
          }}
        >
          <div className="tg gold" style={{ fontSize: 12 }}>{item.label}</div>
          <div className="tg soft" style={{ fontSize: 10, marginTop: 3 }}>{item.sub}</div>
        </a>
      ))}
    </nav>
  );
}
