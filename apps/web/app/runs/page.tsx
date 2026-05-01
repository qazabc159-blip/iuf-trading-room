import Link from "next/link";

import { PageFrame, Panel } from "@/components/PageFrame";
import { MetricStrip } from "@/components/RadarWidgets";
import { listStrategyRuns } from "@/lib/api";

export const dynamic = "force-dynamic";

type RunsView = Awaited<ReturnType<typeof listStrategyRuns>>["data"];
type RunRow = RunsView["items"][number];
type LoadState =
  | { state: "LIVE"; data: RunsView; updatedAt: string; source: string }
  | { state: "EMPTY"; data: RunsView; updatedAt: string; source: string; reason: string }
  | { state: "BLOCKED"; data: RunsView; updatedAt: string; source: string; reason: string };

const emptyRuns: RunsView = {
  total: 0,
  items: [],
};

async function loadRuns(): Promise<LoadState> {
  const source = "GET /api/v1/strategy/runs?decisionMode=paper&sort=created_at";
  const updatedAt = new Date().toISOString();

  try {
    const envelope = await listStrategyRuns({
      decisionMode: "paper",
      limit: 50,
      sort: "created_at",
    });
    const data = envelope.data;
    if (data.items.length === 0) {
      return {
        state: "EMPTY",
        data,
        updatedAt,
        source,
        reason: "Strategy runs endpoint returned zero rows. No fallback run ledger is rendered.",
      };
    }
    return { state: "LIVE", data, updatedAt, source };
  } catch (error) {
    return {
      state: "BLOCKED",
      data: emptyRuns,
      updatedAt,
      source,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

function formatTime(value: string | null | undefined) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString("zh-TW", { hour12: false });
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-TW", { hour12: false });
}

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function stateTone(state: LoadState["state"]) {
  if (state === "LIVE") return "up";
  if (state === "EMPTY") return "gold";
  return "down";
}

function decisionTone(decision: RunRow["summary"] extends { allow: number } ? "allow" | "review" | "block" : never) {
  if (decision === "allow") return "up";
  if (decision === "review") return "gold";
  return "down";
}

function qualityPrimary(view: RunsView) {
  const counts = view.items.reduce(
    (acc, run) => {
      acc.ready += run.quality.strategyReady;
      acc.reference += run.quality.referenceOnly;
      acc.insufficient += run.quality.insufficient;
      return acc;
    },
    { ready: 0, reference: 0, insufficient: 0 }
  );
  return counts;
}

function SourceLine({ result }: { result: LoadState }) {
  return (
    <div className="tg soft" style={{ display: "flex", flexWrap: "wrap", gap: 10, margin: "10px 0 12px" }}>
      <span className={stateTone(result.state)} style={{ fontWeight: 700 }}>{result.state}</span>
      <span>{result.source}</span>
      <span>updated {formatTime(result.updatedAt)}</span>
      {result.state !== "LIVE" && <span>{result.reason}</span>}
    </div>
  );
}

function EmptyOrBlocked({ result }: { result: LoadState }) {
  if (result.state === "LIVE") return null;
  return (
    <div className="terminal-note">
      <span className={`tg ${stateTone(result.state)}`}>{result.state}</span>{" "}
      {result.reason}
    </div>
  );
}

export default async function RunsPage() {
  const result = await loadRuns();
  const statsAvailable = result.state !== "BLOCKED";
  const counts = qualityPrimary(result.data);
  const totals = result.data.items.reduce(
    (acc, run) => {
      acc.allow += run.summary.allow;
      acc.review += run.summary.review;
      acc.block += run.summary.block;
      return acc;
    },
    { allow: 0, review: 0, block: 0 }
  );
  const avgConfidence = result.data.items.length
    ? result.data.items.reduce((sum, run) => sum + (run.topIdea?.confidence ?? 0), 0) / result.data.items.length
    : 0;

  return (
    <PageFrame
      code="05"
      title="Runs"
      sub="Strategy run ledger"
      note="[05] RUNS reads the production strategy run ledger. It is read-only and never submits orders."
    >
      <MetricStrip
        cells={[
          { label: "STATE", value: result.state, tone: stateTone(result.state) },
          { label: "RUNS", value: statsAvailable ? result.data.total : "--" },
          { label: "ALLOW", value: statsAvailable ? totals.allow : "--", tone: "up" },
          { label: "REVIEW", value: statsAvailable ? totals.review : "--", tone: "gold" },
          { label: "BLOCK", value: statsAvailable ? totals.block : "--", tone: "down" },
          { label: "READY", value: statsAvailable ? counts.ready : "--", tone: statsAvailable && counts.ready > 0 ? "up" : "muted" },
          { label: "TOP CONF", value: statsAvailable && result.data.items.length ? percent(avgConfidence) : "--" },
        ]}
        columns={7}
      />

      <Panel
        code="RUN-TBL"
        title={`${formatTime(result.updatedAt)} TPE`}
        sub="STRATEGY RUNS / PAPER DECISION / READ ONLY"
        right={result.state}
      >
        <SourceLine result={result} />
        <EmptyOrBlocked result={result} />
        {result.state === "LIVE" && (
          <>
            <div className="row position-row table-head tg" style={{ gridTemplateColumns: "170px 136px 86px 72px 72px 72px 1fr 80px" }}>
              <span>ID</span><span>GENERATED</span><span>MODE</span><span>ALLOW</span><span>REVIEW</span><span>BLOCK</span><span>TOP IDEA</span><span>DETAIL</span>
            </div>
            {result.data.items.map((run) => (
              <Link
                href={`/runs/${encodeURIComponent(run.id)}`}
                className="row position-row"
                style={{ gridTemplateColumns: "170px 136px 86px 72px 72px 72px 1fr 80px" }}
                key={run.id}
              >
                <span className="tg gold">{run.id}</span>
                <span className="tg soft">{formatDateTime(run.generatedAt)}</span>
                <span className="tg">{run.decisionMode}</span>
                <span className={`num ${decisionTone("allow")}`}>{run.summary.allow}</span>
                <span className={`num ${decisionTone("review")}`}>{run.summary.review}</span>
                <span className={`num ${decisionTone("block")}`}>{run.summary.block}</span>
                <span className="tg soft" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {run.topIdea ? `${run.topIdea.symbol} / ${run.topIdea.direction} / ${run.topIdea.score.toFixed(1)} / ${run.topSymbols.join(", ")}` : "NO TOP IDEA"}
                </span>
                <span className="mini-button">DETAIL</span>
              </Link>
            ))}
          </>
        )}
      </Panel>

      <Panel code="RUN-QA" title="4-STATE AUDIT" sub="endpoint truth / no silent mock" right={result.source}>
        <div className="tg soft" style={{ display: "grid", gap: 6, paddingBottom: 12 }}>
          <span>source: {result.source}</span>
          <span>
            quality: {statsAvailable ? `ready ${counts.ready} / reference ${counts.reference} / insufficient ${counts.insufficient}` : "blocked until strategy run source is live"}
          </span>
          <span>write policy: list/detail only; strategy run execute and order submit remain outside this page.</span>
        </div>
      </Panel>
    </PageFrame>
  );
}
