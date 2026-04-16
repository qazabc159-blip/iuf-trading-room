// Block sparkline helpers — turn a numeric series into Unicode block chars.
// 極小工具：接受任意數列，回傳 ▁▂▃▄▅▆▇█ 組成的字串，供表格內嵌使用。

const BLOCKS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

export function blockSpark(values: number[], opts?: { max?: number; min?: number }): string {
  if (!values || values.length === 0) return "";
  const min = opts?.min ?? Math.min(...values);
  const max = opts?.max ?? Math.max(...values);
  const span = max - min;
  if (span === 0) {
    // 全部一致 → 中間高度
    return values.map(() => BLOCKS[3]).join("");
  }
  return values
    .map((v) => {
      const ratio = (v - min) / span;
      const idx = Math.max(0, Math.min(BLOCKS.length - 1, Math.round(ratio * (BLOCKS.length - 1))));
      return BLOCKS[idx];
    })
    .join("");
}
