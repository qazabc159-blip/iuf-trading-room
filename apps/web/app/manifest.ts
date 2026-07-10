import type { MetadataRoute } from "next";

/**
 * PWA installability manifest (App 化切片 1).
 *
 * `start_url` = "/m": the mobile quick-glance lane (briefs/themes/AI推薦/大盤
 * overview/kill-switch/watchlist behind one bottom-nav) is the better landing
 * surface for a home-screen-installed icon than the full desktop-style "/"
 * control tower — it's purpose-built for a quick phone tap, and its own
 * bottom nav already has a one-tap "回完整戰情台" escape to "/" so no
 * functionality is lost. Both routes sit behind the same auth gate.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "IUF 台股 AI 交易戰情室",
    short_name: "IUF 戰情室",
    description: "台股研究、每日簡報、量化驗證、紙上交易與風控工作台",
    start_url: "/m",
    scope: "/",
    display: "standalone",
    background_color: "#080b10",
    theme_color: "#080b10",
    lang: "zh-Hant",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
