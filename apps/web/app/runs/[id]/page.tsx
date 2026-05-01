import Link from "next/link";

import { PageFrame, Panel } from "@/components/PageFrame";
import { MetricStrip } from "@/components/RadarWidgets";
import { getStrategyRunById, listStrategyRuns } from "@/lib/api";

export const dynamic = "force-dynamic";

type RunRecord = Awaited<ReturnType<typeof getStrategyRunById>>["data"];
type RunsView = Awaited<ReturnType<typeof listStrategyRuns>>["data"];
type RunOutput = RunRecord["outputs"][number];
type RunListItem = RunsView["items"][number];
type DetailData = {
  run: RunRecord | null;
  runs: RunsView;
};
type LoadState =
  | { state: "LIVE"; data: DetailData; updatedAt: string; source: string }
  | { state: "EMPTY"; data: DetailData; updatedAt: string; source: string; reason: string }
  | { state: "BLOCKED"; data: DetailData; updatedAt: string; source: string; reason: string };

const emptyRuns: RunsView = { total: 0, items: [] };

async function loadDetail(id: string): Promise<LoadState> {
  const source = `GET /api/v1/strategy/runs/${id}`;
  const updatedAt = new Date().toISOString();

  try {
    const [runEnvelope, runsEnvelope] = await Promise.all([
      getStrategyRunById(id),
      listStrategyRuns({ decisionMode: "paper", limit: 50, sort: "created_at" }),
    ]);
    const run = runEnvelope.data;
    if (run.outputs.length === 0 && run.items.length === 0) {
      return {
        state: "EMPTY",
        data: { run, runs: runsEnvelope.data },
        updatedAt: run.generatedAt || updatedAt,
        source,
        reason: "Strategy run exists but emitted zero output rows.",
      };
    }
    return {
      state: "LIVE",
      data: { run, runs: runsEnvelope.data },
      updatedAt: run.generatedAt || updatedAt,
      source,
    };
  } catch (error) {
    return {
      state: "BLOCKED",
      data: { run: null, runs: emptyRuns },
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

function decisionTone(decision: RunOutput["marketDecision"]) {
  if (decision === "allow") return "up";
  if (decision === "review") return "gold";
  return "down";
}

function directionTone(direction: RunOutput["direction"]) {
  if (direction === "bullish") return "up";
  if (direction === "bearish") return "down";
  return "muted";
}

function formatQueryValue(value: unknown) {
  if (Array.isArray(value)) return value.join(" / ") || "--";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value === null || value === undefined || value === "") return "--";
  return String(value);
}

function barWidth(value: number, total: number) {
  if (total <= 0) return "0%";
  return `${Math.min(100, Math.round((value / total) * 100))}%`;
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

function buildLineage(run: RunRecord | null, runs: RunsView) {
  if (!run) return [];
  const sorted = runs.items.slice().sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  const index = sorted.findIndex((item) => item.id === run.id);
  const newer = index > 0 ? sorted[index - 1] : null;
  const older = index >= 0 && index < sorted.length - 1 ? sorted[index + 1] : null;
  return [
    { label: "NEWER", item: newer },
    { label: "CURRENT", item: sorted[index] ?? null },
    { label: "OLDER", item: older },
  ] satisfies { label: string; item: RunListItem | null }[];
}

export default async function RunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: encodedId } = await params;
  const id = decodeURIComponent(encodedId);
  const result = await loadDetail(id);
  const run = result.data.run;
  const summary = run?.summary ?? {
    total: 0,
    allow: 0,
    review: 0,
    block: 0,
    bullish: 0,
    bearish: 0,
    neutral: 0,
    quality: { strategyReady: 0, referenceOnly: 0, insufficient: 0, primaryReasons: [] },
  };
  const outputs = run?.outputs ?? [];
  const lineage = buildLineage(run, result.data.runs);

  return (
    <PageFrame
      code="05-D"
      title={run?.id ?? id}
      sub={run ? `Strategy run / ${run.query.decisionMode}` : "Strategy run unavailable"}
      note="[05D] RUN DETAIL reads the production strategy run record. Execute/order actions are intentionally hidden."
    >
      <MetricStrip
        cells={[
          { label: "STATE", value: result.state, tone: stateTone(result.state) },
          { label: "TOTAL", value: summary.total },
          { label: "ALLOW", value: summary.allow, tone: "up" },
          { label: "REVIEW", value: summary.review, tone: "gold" },
          { label: "BLOCK", value: summary.block, tone: "down" },
          { label: "READY", value: summary.quality.strategyReady, tone: summary.quality.strategyReady > 0 ? "up" : "muted" },
        ]}
        columns={6}
      />

      <div className="company-grid">
        <div>
          <Panel code="RUN-QRY" title={`${formatTime(result.updatedAt)} TPE`} sub="QUERY SNAPSHOT / READ ONLY" right={result.state}>
            <SourceLine result={result} />
            <EmptyOrBlocked result={result} />
            {run && (
              <div style={{ border: "1px solid var(--night-rule-strong)" }}>
                {Object.entries(run.query).map(([key, value]) => (
                  <div className="row limit-row" key={key}>
                    <span className="tg gold">{key}</span>
                    <span className="tg" style={{ gridColumn: "span 2", textAlign: "right" }}>{formatQueryValue(value)}</span>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel code="RUN-IDEA" title="OUTPUTS" sub="company detail links only" right={`${outputs.length} ROWS`}>
            {outputs.length === 0 && (
              <div className="terminal-note">
                <span className="tg gold">EMPTY</span> This run has no output rows.
              </div>
            )}
            {outputs.map((idea) => (
              <div className="row idea-row" key={`${idea.companyId}-${idea.symbol}`}>
                <Link href={`/companies/${idea.symbol}`} className="tg gold">{idea.symbol}</Link>
                <span className={`tg ${directionTone(idea.direction)}`}>{idea.direction}</span>
                <span className="num">{idea.score.toFixed(1)}</span>
                <span className={`tg ${decisionTone(idea.marketDecision)}`}>{idea.marketDecision}</span>
                <span className="tc soft" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {idea.companyName} / {idea.topThemeName ?? "NO THEME"} / {idea.primaryReason}
                </span>
                <Link href={`/companies/${idea.symbol}`} className="mini-button">DETAIL</Link>
              </div>
            ))}
          </Panel>
        </div>

        <div>
          <Panel code="RUN-OUT" title="OUTCOME SPLIT" sub="summary from API" right={run?.id ?? "BLOCKED"}>
            {[
              ["ALLOW", summary.allow, "up"],
              ["REVIEW", summary.review, "gold"],
              ["BLOCK", summary.block, "down"],
              ["BULLISH", summary.bullish, "up"],
              ["BEARISH", summary.bearish, "down"],
              ["NEUTRAL", summary.neutral, "muted"],
            ].map(([label, value, tone]) => (
              <div style={{ padding: "10px 0", borderBottom: "1px solid var(--night-rule)" }} key={label}>
                <div className="tg" style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>{label}</span><span className={String(tone)}>{value}</span>
                </div>
                <div className="bar" style={{ marginTop: 8 }}>
                  <span style={{ width: barWidth(Number(value), Math.max(1, summary.total)), background: tone === "gold" ? "var(--gold-bright)" : tone === "up" ? "var(--tw-up-bright)" : tone === "down" ? "var(--tw-dn-bright)" : "var(--night-mid)" }} />
                </div>
              </div>
            ))}
            <div className="tg soft" style={{ display: "grid", gap: 6, padding: "12px 0" }}>
              <span>generated: {formatDateTime(run?.generatedAt)}</span>
              <span>avg confidence: {outputs.length ? percent(outputs.reduce((sum, item) => sum + item.confidence, 0) / outputs.length) : "--"}</span>
              <span>write policy: execute/order controls hidden until explicit backend and risk gate approval.</span>
            </div>
          </Panel>

          <Panel code="RUN-LIN" title="LINEAGE" sub="newer / older run chain" right="NAV">
            {lineage.length === 0 && <div className="terminal-note"><span className="tg gold">EMPTY</span> No lineage available.</div>}
            {lineage.map(({ label, item }) => (
              <div className="row telex-row" style={{ gridTemplateColumns: "70px 1fr" }} key={label}>
                <span className="tg gold">{label}</span>
                {item ? (
                  <Link href={`/runs/${encodeURIComponent(item.id)}`} className="tg">{item.id} / {item.decisionMode}</Link>
                ) : (
                  <span className="tg soft">NONE</span>
                )}
              </div>
            ))}
          </Panel>
        </div>
      </div>
    </PageFrame>
  );
}
