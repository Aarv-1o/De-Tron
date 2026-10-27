import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Node } from "web-tree-sitter";

// Hotspots (Tornhill, "Your Code as a Crime Scene"): files that are complex AND change often.
// That's where bugs and agent mess pile up, so clean there first and leave stable code alone.

const run = promisify(execFile);

export interface Hotspot {
  file: string;
  changes: number; // commits that touched the file
  lines: number;
  complexity: number; // total indentation, in indent levels
  score: number; // 0..1, relative to the worst file in the repo
}

export type History =
  | { ok: true; changes: Map<string, number>; commits: number }
  | { ok: false; reason: string };

const MIN_COMMITS = 10; // fewer, and "changes often" means nothing yet
const MAX_SHOWN = 10;

// How often each file changed, with paths relative to `root` (which may be a folder inside the repo).
export async function gitHistory(root: string): Promise<History> {
  let prefix: string;
  try {
    prefix = (await run("git", ["-C", root, "rev-parse", "--show-prefix"])).stdout.trim();
  } catch {
    return { ok: false, reason: "not a git repo" }; // rev-parse fails outside a repo, or without git: same answer
  }
  const args = ["-C", root, "log", "--no-merges", "--format=@%h", "--name-only", "--", "."];
  const log = (await run("git", args, { maxBuffer: 256 * 1024 * 1024 })).stdout;
  const commits = log.split("\n").filter((l) => l.startsWith("@")).length;
  if (commits < MIN_COMMITS) return { ok: false, reason: `only ${commits} commit${commits === 1 ? "" : "s"} of history` };
  const changes = new Map<string, number>();
  for (const line of log.split("\n")) {
    if (!line || line.startsWith("@") || !line.startsWith(prefix)) continue;
    const file = line.slice(prefix.length);
    changes.set(file, (changes.get(file) ?? 0) + 1);
  }
  return { ok: true, changes, commits };
}

export interface FileSize {
  lines: number;
  complexity: number;
}

// Rows inside multi-line strings (prompts, templates, docstrings): text, not code.
export function stringRows(root: Node): Set<number> {
  const rows = new Set<number>();
  const visit = (node: Node) => {
    if (/string$/.test(node.type) && node.endPosition.row > node.startPosition.row) {
      for (let row = node.startPosition.row + 1; row <= node.endPosition.row; row++) rows.add(row);
      return;
    }
    for (const child of node.namedChildren) visit(child);
  };
  visit(root);
  return rows;
}

// Total indentation in indent levels: a cheap complexity measure that works in any language.
// The indent step (2 or 4 spaces, a tab) is the file's own, so styles compare fairly.
export function indentComplexity(text: string, skipRows: Set<number> = new Set()): FileSize {
  const widths: number[] = [];
  let lines = 0;
  for (const [row, line] of text.split("\n").entries()) {
    if (!line.trim() || skipRows.has(row)) continue;
    lines++;
    const lead = /^[ \t]*/.exec(line)![0].replaceAll("\t", "    ").length;
    if (lead) widths.push(lead);
  }
  const step = widths.length ? Math.min(...widths) : 1;
  return { lines, complexity: Math.round(widths.reduce((sum, w) => sum + w / step, 0)) };
}

// A small file with nothing wrong isn't worth flagging, however often it changes.
const MIN_LINES = 150;
export const worthFlagging = (h: Hotspot, hasFindings: boolean) => h.lines >= MIN_LINES || hasFindings;

export function findHotspots(changes: Map<string, number>, sizes: Map<string, FileSize>): Hotspot[] {
  const rows = [...sizes].flatMap(([file, size]) => {
    const n = changes.get(file) ?? 0;
    return n > 1 ? [{ file, changes: n, ...size }] : [];
  });
  if (!rows.length) return [];
  const maxChanges = Math.max(...rows.map((r) => r.changes));
  const maxComplexity = Math.max(...rows.map((r) => r.complexity)) || 1;
  return rows
    .map((r) => ({ ...r, score: (r.changes / maxChanges) * (r.complexity / maxComplexity) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_SHOWN);
}
