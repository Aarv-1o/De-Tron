import { GUIDES } from "../findings/guide.ts";
import type { LineFinding } from "../rules/line/types.ts";
import { hiddenNote, nothingFound } from "./common.ts";

// In the order they're shown: things that fail at runtime or hide failures first.
const ORDER = [
  "query-in-loop", "tree-walk-queries", "money-float", "insert-without-columns", "leading-wildcard-search", "order-by-random", "select-star",
  "empty-catch", "catch-only-logs", "catch-returns-default", "catch-rethrow", "commented-out-code", "unused-param",
  "deep-nesting", "comment-repeats-code", "long-params",
];

const MAX_SHOWN = 8;

function section(rule: string, findings: LineFinding[]): string[] {
  const sorted = [...findings].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  const sameMessage = new Set(sorted.map((f) => f.message)).size === 1;
  const where = sorted.map((f) => `${f.file}:${f.line}`);
  const width = Math.max(...where.slice(0, MAX_SHOWN).map((w) => w.length));
  const lines = [`  ${GUIDES[rule]?.name ?? rule} (${findings.length})`];
  sorted.slice(0, MAX_SHOWN).forEach((f, i) => {
    const detail = sameMessage ? "" : `  ${f.message}`;
    lines.push(`     ${where[i]!.padEnd(sameMessage ? 0 : width)}${detail}${f.confidence === "sure" ? "  (safe to fix)" : ""}`);
  });
  if (sorted.length > MAX_SHOWN) lines.push(`     …and ${sorted.length - MAX_SHOWN} more (--json lists all)`);
  if (sameMessage) lines.push(`     → ${sorted[0]!.message}`);
  return [...lines, ""];
}

// One report section of per-line findings: "Code hygiene", "Database".
export function formatLineFindings(heading: string, findings: LineFinding[], showHints: boolean): string {
  const shown = findings.filter((f) => showHints || f.confidence !== "maybe");
  const hidden = findings.length - shown.length;
  const rules = [...new Set(shown.map((f) => f.rule))].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
  const lines = rules.flatMap((rule) => section(rule, shown.filter((f) => f.rule === rule)));
  if (!lines.length) return nothingFound(`${heading.toLowerCase()} issues`, hidden);
  if (hidden) lines.push(`  ${hiddenNote(hidden)}`, "");
  return `${heading}\n\n${lines.join("\n")}`;
}
