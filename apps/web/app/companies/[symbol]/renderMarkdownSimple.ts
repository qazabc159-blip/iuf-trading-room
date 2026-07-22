import { createElement, type ReactNode } from "react";

// ── Markdown renderer (simple, no XSS risk since content is from our own backend) ──
//
// Extracted to a plain .ts file (2026-07-22, PR #1341 Pete review round 2) so
// it is a pure function callable from vitest without a JSX transform — this
// repo's vitest config does not transform .tsx JSX at runtime (tsconfig has
// `jsx: "preserve"`, meant for Next.js's own compiler), so a .test.ts file
// cannot import a runtime binding out of a "use client" .tsx component.
// `createElement` calls below are the non-JSX equivalent of the original
// inline JSX in AiAnalystReportPanel.tsx; no behavior change.
//
// Loop invariant: every branch below MUST advance `i` by at least 1 per
// outer-loop pass. Before this fix, the paragraph-collection branch excluded
// any line merely `.startsWith("#")` — but the backend gate
// (apps/api/src/brain/react-loop.ts:91-101) tolerates headers with no space
// after "#" (e.g. "##1.公司概況與定位"), so such a line matched none of the
// H1/H2/H3 branches (which require the literal "# "/"## "/"### " prefix) yet
// was also excluded from the paragraph branch, producing a zero-length
// paragraph and an un-incremented `i` — a synchronous infinite loop that
// froze the tab. Fixed by excluding only the exact heading/bullet prefixes
// from paragraph collection (a line that merely starts with "#" without a
// following space is now treated as plain paragraph text, which is always
// consumed and always advances `i`). The iteration ceiling below is a
// second, independent safety net in case a future edit to this function
// reintroduces a non-advancing branch.
export function renderMarkdownSimple(md: string): ReactNode[] {
  const lines = md.split("\n");
  const nodes: ReactNode[] = [];
  let i = 0;
  let guard = 0;
  const guardMax = lines.length * 4 + 16;

  while (i < lines.length) {
    if (++guard > guardMax) {
      // Should be unreachable given the loop invariant above — this only
      // fires if a future change breaks that invariant again. Stop instead
      // of hanging the tab; the rest of the report is simply not rendered.
      break;
    }
    const line = lines[i];

    // H1
    if (line.startsWith("# ")) {
      nodes.push(createElement("h2", { key: i, className: "_ai-md-h1" }, line.slice(2)));
      i++;
      continue;
    }
    // H2
    if (line.startsWith("## ")) {
      nodes.push(createElement("h3", { key: i, className: "_ai-md-h2" }, line.slice(3)));
      i++;
      continue;
    }
    // H3
    if (line.startsWith("### ")) {
      nodes.push(createElement("h4", { key: i, className: "_ai-md-h3" }, line.slice(4)));
      i++;
      continue;
    }
    // Bullet
    if (line.startsWith("- ") || line.startsWith("* ")) {
      const bullets: string[] = [];
      while (i < lines.length && (lines[i].startsWith("- ") || lines[i].startsWith("* "))) {
        bullets.push(lines[i].slice(2));
        i++;
      }
      nodes.push(
        createElement(
          "ul",
          { key: `ul-${i}`, className: "_ai-md-ul" },
          bullets.map((b, j) => createElement("li", { key: j }, b))
        )
      );
      continue;
    }
    // Blank line
    if (line.trim() === "") {
      i++;
      continue;
    }
    // Paragraph.
    // Only stop on an EXACT heading/bullet prefix ("# "/"## "/"### "/"- "/"* ").
    // A line that merely starts with "#" without a following space (a
    // header format the backend gate tolerates, see loop-invariant comment
    // above) is plain paragraph text here, not a heading boundary — this
    // guarantees the current line (which already failed all three heading
    // checks above) is always consumed on the first iteration.
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].startsWith("# ") &&
      !lines[i].startsWith("## ") &&
      !lines[i].startsWith("### ") &&
      !lines[i].startsWith("- ") &&
      !lines[i].startsWith("* ")
    ) {
      para.push(lines[i]);
      i++;
    }
    if (para.length > 0) {
      nodes.push(createElement("p", { key: `p-${i}`, className: "_ai-md-p" }, para.join(" ")));
    }
  }

  return nodes;
}
