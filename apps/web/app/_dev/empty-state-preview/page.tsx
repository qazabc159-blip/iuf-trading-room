"use client";

/* ─────────────────────────────────────────────────────────────────
   DEV ONLY — /app/_dev/empty-state-preview/page.tsx
   展示 4 個 producer-aware empty-state component
   供 Bruce Phase 3 在 dev 環境核對視覺與 copy 是否符合規範
   ───────────────────────────────────────────────────────────────── */

import { ThemePoolEmpty }            from "@/components/empty-states/ThemePoolEmpty";
import { SignalFeedEmpty }           from "@/components/empty-states/SignalFeedEmpty";
import { BriefInMemoryBanner }       from "@/components/empty-states/BriefInMemoryBanner";
import { OpenAliceAwaitingDevice }   from "@/components/empty-states/OpenAliceAwaitingDevice";
import type { OpenAliceObservability } from "@/lib/api";

/* ── Fixture data ── */

const FIXTURE_SIGNALS = [
  { id: "sig-001", title: "AI Optics 族群短線動能正轉", direction: "bullish" as const },
  { id: "sig-002", title: "外資連三日賣超半導體指數", direction: "bearish" as const },
  { id: "sig-003", title: "台幣匯率震盪，觀望為主", direction: "neutral" as const },
];

const FIXTURE_OBSERVABILITY: OpenAliceObservability = {
  source: "bridge_fallback",
  workerStatus: "healthy",
  sweepStatus: "healthy",
  workerHeartbeatAt: new Date(Date.now() - 42_000).toISOString(),
  workerHeartbeatAgeSeconds: 42,
  lastSweepAt: new Date(Date.now() - 120_000).toISOString(),
  lastSweepAgeSeconds: 120,
  metrics: {
    mode: "memory",
    queuedJobs: 0,
    runningJobs: 0,
    staleRunningJobs: 0,
    terminalJobs: 0,
    activeDevices: 0,
    staleDevices: 0,
    expiredJobsRequeued: 0,
    expiredJobsFailed: 0,
  },
};

/* ── Preview section ── */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="dev-preview-section">
      <div className="dev-preview-label">
        <span style={{ color: "var(--accent)", fontFamily: "var(--font-mono)", fontSize: "var(--fs-xs)" }}>
          DEV · {title}
        </span>
      </div>
      <div className="dev-preview-body">
        {children}
      </div>
    </div>
  );
}

export default function EmptyStatePreviewPage() {
  return (
    <div className="content" style={{ maxWidth: "800px", margin: "0 auto" }}>
      {/* ── Page header ── */}
      <div className="hero">
        <p className="eyebrow">DEV PREVIEW</p>
        <h2>Empty State Components</h2>
        <p style={{ color: "var(--muted)", fontSize: "var(--fs-sm)", marginTop: "var(--sp-2)" }}>
          S7 · Producer-Aware Empty State UI Skeleton
          {" · "}
          <span style={{ fontFamily: "var(--font-mono)", color: "var(--dim)" }}>
            2026-04-23
          </span>
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-8)" }}>

        {/* 1 · ThemePoolEmpty */}
        <Section title="1 / ThemePoolEmpty — core pool 空（poolType=core）">
          <ThemePoolEmpty
            themeName="AI Optics"
            poolType="core"
          />
        </Section>

        <Section title="1b / ThemePoolEmpty — 兩個 pool 都空（poolType=both）">
          <ThemePoolEmpty
            themeName="Audit Trail Live Check"
            poolType="both"
          />
        </Section>

        {/* 2 · SignalFeedEmpty */}
        <Section title="2 / SignalFeedEmpty — 6 個 signal 樣本">
          <SignalFeedEmpty
            totalSignals={6}
            sampleSignals={FIXTURE_SIGNALS}
          />
        </Section>

        <Section title="2b / SignalFeedEmpty — 無樣本可顯示">
          <SignalFeedEmpty
            totalSignals={0}
            sampleSignals={[]}
          />
        </Section>

        {/* 3 · BriefInMemoryBanner */}
        <Section title="3 / BriefInMemoryBanner — 0 brief（重啟後清空）">
          <BriefInMemoryBanner
            inMemoryCount={0}
            lastRestartAt={new Date(Date.now() - 3_600_000).toISOString()}
          />
        </Section>

        <Section title="3b / BriefInMemoryBanner — 有 3 筆 in-memory brief">
          <BriefInMemoryBanner
            inMemoryCount={3}
          />
        </Section>

        {/* 4 · OpenAliceAwaitingDevice */}
        <Section title="4 / OpenAliceAwaitingDevice — devices=0, jobs=0, worker healthy">
          <OpenAliceAwaitingDevice
            observability={FIXTURE_OBSERVABILITY}
            deviceCount={0}
            jobCount={0}
          />
        </Section>

        <Section title="4b / OpenAliceAwaitingDevice — worker stale">
          <OpenAliceAwaitingDevice
            observability={{
              ...FIXTURE_OBSERVABILITY,
              workerStatus: "stale",
              sweepStatus: "stale",
              workerHeartbeatAt: new Date(Date.now() - 600_000).toISOString(),
              workerHeartbeatAgeSeconds: 600,
            }}
            deviceCount={0}
            jobCount={0}
          />
        </Section>

      </div>

      {/* ── Footer ── */}
      <div style={{
        marginTop: "var(--sp-12)",
        padding: "var(--sp-4)",
        borderTop: "1px solid var(--line)",
        color: "var(--dim)",
        fontSize: "var(--fs-xs)",
        fontFamily: "var(--font-mono)",
      }}>
        DEV ONLY — 此頁不在 production nav 中，Bruce Phase 3 驗收用。
        <br />
        Components 路徑：apps/web/components/empty-states/*.tsx
      </div>
    </div>
  );
}
