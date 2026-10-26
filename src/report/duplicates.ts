import type { FunctionInfo } from "../index/functions.ts";
import type { Confidence, DuplicateGroup } from "../rules/codebase/duplicates.ts";

const ADVICE: Record<DuplicateGroup["kind"], Partial<Record<Confidence, string>>> = {
  exact: { sure: "Keep one, import it everywhere else." },
  similar: {
    likely: "These do the same job but have drifted apart. Pick the right behavior, keep one.",
    maybe: "Same structure, different values. Could become one helper with a parameter.",
  },
  "cross-language": {
    likely: "Same logic in JS and Python. Decide which side owns it.",
    maybe: "Same name in JS and Python. Check whether they do the same thing.",
  },
};

const HEADINGS: Record<Confidence, string> = {
  sure: "Copies",
  likely: "Likely copies",
  maybe: "Hints",
};

function title(group: DuplicateGroup): string {
  const names = [...new Set(group.functions.map((f) => f.name))];
  const shown = names.length > 3 ? `${names.slice(0, 3).join(", ")}…` : names.join(", ");
  return `${shown} (${group.functions.length} copies)`;
}

function location(fn: FunctionInfo): string {
  return `${fn.file}:${fn.startLine}  ${fn.name}`;
}

function quote(value: string): string {
  const oneLine = value.replace(/\s+/g, " ");
  return `"${oneLine.length > 40 ? `${oneLine.slice(0, 40)}…` : oneLine}"`;
}

export function formatDuplicates(groups: DuplicateGroup[], showHints: boolean): string {
  const lines: string[] = [];
  for (const level of ["sure", "likely", "maybe"] as const) {
    const inLevel = groups.filter((g) => g.confidence === level);
    if (!inLevel.length) continue;
    if (level === "maybe" && !showHints) {
      lines.push(`${inLevel.length} more hints hidden. Run with --all to see them.`, "");
      continue;
    }
    lines.push(`${HEADINGS[level]} (${inLevel.length})`, "");
    inLevel.forEach((group, i) => {
      lines.push(`  ${i + 1}. ${title(group)}`);
      for (const fn of group.functions) lines.push(`     ${location(fn)}`);
      if (group.sharedValues.length) lines.push(`     Same wording: ${group.sharedValues.slice(0, 3).map(quote).join(", ")}`);
      lines.push(`     → ${ADVICE[group.kind][level] ?? ""}`, "");
    });
  }
  return lines.length ? lines.join("\n") : "No copies found.\n";
}

// For agents and scripts: everything except the body shapes, which are internal.
export function duplicatesToJson(groups: DuplicateGroup[]) {
  return groups.map((g) => ({
    kind: g.kind,
    confidence: g.confidence,
    sharedValues: g.sharedValues,
    functions: g.functions.map(({ name, file, startLine, endLine, language }) => ({ name, file, startLine, endLine, language })),
  }));
}
