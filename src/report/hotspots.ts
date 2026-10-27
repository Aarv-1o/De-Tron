import type { History, Hotspot } from "../rules/codebase/hotspots.ts";

const SHOWN = 5;
const SHOWN_ALL = 10;
const num = (n: number) => n.toLocaleString("en-US");

// `findings`: how many other Detron findings each file has, so "clean here first" has a starting point.
export function formatHotspots(history: History, hotspots: Hotspot[], findings: Map<string, number>, showAll: boolean): string {
  if (!history.ok) return `Hotspots: not checked (${history.reason}).\n`;
  if (!hotspots.length) return "No hotspots found (no file changed more than once).\n";
  const shown = hotspots.slice(0, showAll ? SHOWN_ALL : SHOWN);
  const cells = shown.map((h) => ({
    file: h.file,
    changes: `${h.changes} changes`,
    lines: `${num(h.lines)} lines`,
    found: findings.get(h.file) ? `${findings.get(h.file)} finding${findings.get(h.file) === 1 ? "" : "s"} above` : "",
  }));
  const w = (key: keyof (typeof cells)[number]) => Math.max(...cells.map((c) => c[key].length));
  const lines = cells.map((c, i) =>
    `  ${`${i + 1}.`.padEnd(String(cells.length).length + 1)} ${c.file.padEnd(w("file"))}  ${c.changes.padStart(w("changes"))}  ${c.lines.padStart(w("lines"))}  ${c.found}`.trimEnd(),
  );
  const more = hotspots.length > shown.length ? [`  ${hotspots.length - shown.length} more with --all.`] : [];
  return [
    `Hotspots: complex files that change often (from ${history.commits} commits)`,
    "",
    ...lines,
    "     → Clean these first. Messy files that rarely change can wait.",
    ...more,
    "",
  ].join("\n");
}

export function hotspotsToJson(history: History, hotspots: Hotspot[]) {
  if (!history.ok) return { checked: false, reason: history.reason };
  return { checked: true, commits: history.commits, files: hotspots.map((h) => ({ ...h, score: Number(h.score.toFixed(3)) })) };
}
