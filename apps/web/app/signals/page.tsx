import Link from "next/link";
import { PageFrame, Panel } from "@/components/PageFrame";
import { api } from "@/lib/radar-api";
import { MetricStrip } from "@/components/RadarWidgets";

export default async function SignalsPage() {
  const signals = await api.signals();
  const channels = Array.from(new Set(signals.map((signal) => signal.channel)));

  return (
    <PageFrame code="07" title="Signals" sub="訊號板" note="[07] SIGNALS · live tape · symbol and theme attachments">
      <MetricStrip
        cells={[
          { label: "TOTAL", value: signals.length },
          { label: "MOM", value: signals.filter((s) => s.channel === "MOM").length, tone: "gold" },
          { label: "FII", value: signals.filter((s) => s.channel === "FII").length },
          { label: "THM", value: signals.filter((s) => s.channel === "THM").length },
          { label: "MUTED", value: signals.filter((s) => s.state === "MUTED").length, tone: "muted" },
          { label: "CHANNELS", value: channels.length },
        ]}
        columns={6}
      />

      <Panel code="SIG-TAPE" title="14:32:08 TPE · ● LIVE" sub="chronological signal rail" right={`${signals.length} EVENTS`}>
        {signals.map((signal) => (
          <div className="row telex-row" style={{ gridTemplateColumns: "76px 54px 78px 1fr 76px" }} key={signal.id}>
            <span className="tg soft">{new Date(signal.emittedAt).toLocaleTimeString("zh-TW", { hour12: false })}</span>
            <span className="tg gold">{signal.channel}</span>
            {signal.symbol ? (
              <Link href={`/companies/${signal.symbol}`} className="tg">{signal.symbol}</Link>
            ) : (
              <span className="tg muted">{signal.themeCode ?? "-"}</span>
            )}
            <span className="tg" style={{ color: signal.state === "MUTED" ? "var(--night-soft)" : "var(--night-ink)" }}>{signal.trigger}</span>
            <span className={`tg ${signal.quality === "HIGH" ? "gold" : "muted"}`}>Q·{signal.quality}</span>
          </div>
        ))}
      </Panel>
    </PageFrame>
  );
}
