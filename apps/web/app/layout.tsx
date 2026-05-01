import "./globals.css";
import type { Metadata } from "next";
import { Source_Serif_4, JetBrains_Mono, Noto_Serif_TC } from "next/font/google";
import { Sidebar } from "@/components/Sidebar";
import { DataSourceBadge } from "@/components/DataSourceBadge";
import { CommandPalette } from "@/components/CommandPalette";

/* next/font is self-hosted, zero CLS. Replaces the Google CDN @import. */
const serif = Source_Serif_4({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  style: ["normal", "italic"],
  variable: "--font-serif",
  display: "swap",
});
const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-mono",
  display: "swap",
});
const serifTc = Noto_Serif_TC({
  subsets: ["latin"],          // zh-TW glyphs ship via the variable font itself
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-serif-tc",
  display: "swap",
});

export const metadata: Metadata = {
  title: "IUF Trading Room",
  description: "Theme-driven investment trading room",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant" className={`${serif.variable} ${mono.variable} ${serifTc.variable}`}>
      <body style={{ margin: 0, display: "flex", minHeight: "100vh", background: "var(--night)" }}>
        <Sidebar />
        <div style={{ flex: 1, display: "flex" }}>{children}</div>
        <DataSourceBadge />
        <CommandPalette />
      </body>
    </html>
  );
}
