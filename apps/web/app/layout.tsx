import "./globals.css";
import type { Metadata } from "next";
import { JetBrains_Mono, Noto_Sans_TC, Noto_Serif_TC, Source_Serif_4 } from "next/font/google";

import { CommandPalette } from "@/components/CommandPalette";
import { Sidebar } from "@/components/Sidebar";

/* next/font is self-hosted, zero CLS. */
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

const sansTc = Noto_Sans_TC({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
  variable: "--font-sans-tc",
  display: "swap",
});

const serifTc = Noto_Serif_TC({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-serif-tc",
  display: "swap",
});

export const metadata: Metadata = {
  title: "IUF 台股 AI 交易戰情室",
  description: "台股研究、每日簡報、量化驗證、紙上交易與風控工作台",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant" className={`${serif.variable} ${mono.variable} ${sansTc.variable} ${serifTc.variable}`}>
      <body className="app-root">
        <Sidebar />
        <div className="app-main-shell">{children}</div>
        <CommandPalette />
      </body>
    </html>
  );
}
