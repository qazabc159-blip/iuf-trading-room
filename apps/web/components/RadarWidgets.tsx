export type Tone = "gold" | "up" | "down" | "muted";

export function toneClass(value: number): Exclude<Tone, "gold"> {
  if (value > 0) return "up";
  if (value < 0) return "down";
  return "muted";
}

export function signed(value: number, digits = 2) {
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;
}

export function MetricStrip({
  cells,
  columns,
}: {
  cells: { label: string; value: React.ReactNode; delta?: number | string; tone?: Tone }[];
  columns?: number;
}) {
  return (
    <div className="quote-strip" style={columns ? { gridTemplateColumns: `repeat(${columns}, minmax(120px, 1fr))` } : undefined}>
      {cells.map((cell) => {
        const tone = cell.tone ?? (typeof cell.delta === "number" ? toneClass(cell.delta) : "");
        return (
          <div className="quote-card" key={cell.label}>
            <div className="tg quote-symbol">{cell.label}</div>
            <div className={`quote-last num ${tone}`}>{cell.value}</div>
            {cell.delta !== undefined && (
              <div className={`tg ${tone}`}>
                {typeof cell.delta === "number" ? signed(cell.delta, Math.abs(cell.delta) >= 10 ? 1 : 2) : cell.delta}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function Sparkline({ values }: { values: number[] }) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1, max - min);
  const points = values
    .map((value, index) => {
      const x = 4 + index * 13;
      const y = 20 - ((value - min) / span) * 17;
      return `${x},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg className="spark" viewBox="0 0 96 24" aria-hidden>
      <polyline points={points} fill="none" stroke="var(--night-mid)" strokeWidth="1.2" />
    </svg>
  );
}

export function Pill({
  children,
  tone = "muted",
}: {
  children: React.ReactNode;
  tone?: Tone;
}) {
  return <span className={`tg session-pill ${tone}`}>{children}</span>;
}

export function TimeText({ iso }: { iso: string }) {
  return <>{new Date(iso).toLocaleString("zh-TW", { hour12: false })}</>;
}
