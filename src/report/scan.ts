import type { ScanResult } from "../scan/scan.ts";
import { crossStackToJson, formatCrossStack } from "./crossStack.ts";
import { deadCodeToJson, formatDeadCode } from "./deadCode.ts";
import { duplicatesToJson, formatDuplicates } from "./duplicates.ts";
import { formatHotspots, hotspotsToJson } from "./hotspots.ts";
import { formatHygiene } from "./hygiene.ts";

// How many of the findings shown above are in each file.
function findingsPerFile(r: ScanResult, all: boolean): Map<string, number> {
  const shown = (c: string) => all || c !== "maybe";
  const files = [
    ...r.groups.filter((g) => shown(g.confidence)).flatMap((g) => g.functions.map((f) => f.file)),
    ...r.dead.functions.filter((d) => shown(d.confidence)).map((d) => d.fn.file),
    ...r.crossStack.missing.filter((m) => shown(m.confidence)).map((m) => m.file),
    ...r.crossStack.unused.filter((u) => shown(u.confidence)).map((u) => u.route.file),
    ...r.hygiene.filter((f) => shown(f.confidence)).map((f) => f.file),
  ];
  const counts = new Map<string, number>();
  for (const file of files) counts.set(file, (counts.get(file) ?? 0) + 1);
  return counts;
}

export function formatScan(r: ScanResult, all: boolean): string {
  const parts = [`Detron scan: ${r.root}\n${r.index.files.length} files, ${r.index.functions.length} functions, ${r.seconds.toFixed(1)}s\n`];
  if (r.skipped.size) {
    const list = [...r.skipped].map(([ext, n]) => `${n} .${ext}`).join(", ");
    const total = [...r.skipped.values()].reduce((a, b) => a + b, 0);
    parts.push(`Not checked: ${list} file${total > 1 ? "s" : ""} (not supported yet). Results only cover the files above.\n`);
  }
  parts.push(
    "\n",
    formatDuplicates(r.groups, all, r.differences, r.deadFiles),
    `\n${formatDeadCode(r.dead, all)}`,
    `\n${formatCrossStack(r.crossStack, all)}`,
    `\n${formatHygiene(r.hygiene, all)}`,
    `\n${formatHotspots(r.history, r.hotspots, findingsPerFile(r, all), all)}`,
  );
  const broken = r.index.filesWithSyntaxErrors;
  if (broken.length) {
    parts.push(`\nNote: ${broken.length} file(s) have syntax Detron couldn't fully read, so results there may be incomplete:\n`);
    parts.push(...broken.map((f) => `  ${f}\n`));
  }
  return parts.join("");
}

export function scanToJson(r: ScanResult) {
  return {
    root: r.root, files: r.index.files.length, functions: r.index.functions.length,
    skippedFiles: Object.fromEntries(r.skipped),
    filesWithSyntaxErrors: r.index.filesWithSyntaxErrors,
    duplicates: duplicatesToJson(r.groups, r.differences), deadCode: deadCodeToJson(r.dead),
    crossStack: crossStackToJson(r.crossStack), hygiene: r.hygiene, hotspots: hotspotsToJson(r.history, r.hotspots),
  };
}
