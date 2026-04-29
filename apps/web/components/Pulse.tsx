"use client";
/**
 * Pulse — 7-bar block sparkline using Unicode block elements.
 *   ▁▂▃▄▅▆▇█  · monochrome, scales to current heat ceiling.
 * No SVG — keeps it readable at any size, prints clean.
 */
const BLOCKS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"] as const;

export function Pulse({ values }: { values: number[] }) {
  if (!values.length) return null;
  const max = Math.max(...values, 1);
  return (
    <span
      aria-label={`pulse ${values.join(" ")}`}
      style={{
        fontFamily: "var(--mono)", fontSize: 13, lineHeight: 1, letterSpacing: 1,
        color: "var(--gold)", whiteSpace: "nowrap",
      }}
    >
      {values.map((v, i) => {
        const idx = Math.min(BLOCKS.length - 1, Math.max(0, Math.floor((v / max) * (BLOCKS.length - 1))));
        return <span key={i}>{BLOCKS[idx]}</span>;
      })}
    </span>
  );
}
