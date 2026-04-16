"use client";

import { useEffect, useState } from "react";

import type { AppSession } from "@iuf-trading-room/contracts";

import { getSession } from "@/lib/api";

export function WorkspaceStatus() {
  const [session, setSession] = useState<AppSession | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const response = await getSession();
        setSession(response.data);
      } catch (error) {
        console.error("Unable to load session", error);
      }
    };

    void load();
  }, []);

  if (!session) {
    return <p className="rail-copy">載入中...</p>;
  }

  return (
    <div className="status-card">
      <p className="eyebrow">工作區</p>
      <strong>{session.workspace.name}</strong>
      <p className="rail-copy">
        {session.user.name} · {session.user.role}
      </p>
      <p className="rail-copy">
        模式：<span className="status-accent">{session.persistenceMode}</span>
      </p>
    </div>
  );
}
