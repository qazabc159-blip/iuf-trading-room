"use client";

import { useEffect, useState } from "react";

function formatTpeParts(date: Date) {
  return {
    date: date.toLocaleDateString("zh-TW", { timeZone: "Asia/Taipei" }),
    time: date.toLocaleTimeString("zh-TW", {
      timeZone: "Asia/Taipei",
      hour12: false,
    }),
  };
}

export function TaipeiClock() {
  const [parts, setParts] = useState(() => formatTpeParts(new Date()));

  useEffect(() => {
    const timer = window.setInterval(() => setParts(formatTpeParts(new Date())), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  return <b suppressHydrationWarning>{parts.date} {parts.time}</b>;
}
