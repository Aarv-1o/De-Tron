import type { LineFinding } from "../rules/line/types.ts";
import { hiddenNote, nothingFound } from "./common.ts";

// In the order they're shown: things that hide failures first.
const TITLES: Record<string, string> = {
  "empty-catch": "Errors silently ignored",
  "catch-only-logs": "Errors only logged",
  "catch-returns-default": "Errors turned into default values",
  "catch-rethrow": "Catch blocks that do nothing",
  "commented-out-code": "Commented-out code",
  "unused-param": "Unused parameters",
  "deep-nesting": "Deeply nested functions",
  "comment-repeats-code": "Comments that repeat the code",
  "long-params": "Long parameter lists",
};

const MAX_SHOWN = 8;

function section(rule: string, findings: LineFinding[]): string[] {
  const sorted = [...findings].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  const sameMessage = new Set(sorted.map((f) => f.message)).size === 1;
  const where = sorted.map((f) => `${f.file}:${f.line}`);
  const width = Math.max(...where.slice(0, MAX_SHOWN).map((w) => w.length));
  const lines = [`  ${TITLES[rule] ?? rule} (${findings.length})`];
  sorted.slice(0, MAX_SHOWN).forEach((f, i) => {
    const detail = sameMessage ? "" : `  ${f.message}`;
    lines.push(`     ${where[i]!.padEnd(sameMessage ? 0 : width)}${detail}${f.confidence === "sure" ? "  (safe to fix)" : ""}`);
  });
  if (sorted.length > MAX_SHOWN) lines.push(`     …and ${sorted.length - MAX_SHOWN} more (--json lists all)`);
  if (sameMessage) lines.push(`     → ${sorted[0]!.message}`);
  return [...lines, ""];
}

export function formatHygiene(findings: LineFinding[], showHints: boolean): string {
  const shown = findings.filter((f) => showHints || f.confidence !== "maybe");
  const hidden = findings.length - shown.length;
  const rules = [...new Set(shown.map((f) => f.rule))].sort(
    (a, b) => Object.keys(TITLES).indexOf(a) - Object.keys(TITLES).indexOf(b),
  );
  const lines = rules.flatMap((rule) => section(rule, shown.filter((f) => f.rule === rule)));
  if (!lines.length) return nothingFound("code hygiene issues", hidden);
  if (hidden) lines.push(`  ${hiddenNote(hidden)}`, "");
  return `Code hygiene\n\n${lines.join("\n")}`;
}
