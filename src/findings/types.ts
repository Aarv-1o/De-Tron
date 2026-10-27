import type { Confidence } from "../rules/confidence.ts";

// One finding, in the shape every output uses: the text report, --agent, --json, and later
// the MCP server and the editor. Enough for an agent to act on without guessing.

export interface Place {
  file: string;
  line: number;
  label?: string; // "caller", "copy", "route it likely meant"
}

export interface Finding {
  id: string; // stable across runs while the code doesn't move: "long-params:src/a.ts:41"
  rule: string;
  category: "copies" | "dead-code" | "frontend-backend" | "hygiene" | "hotspot" | "database" | "security" | "crash";
  confidence: Confidence;
  file: string;
  line: number;
  endLine?: number;
  title: string; // what's wrong, in one line
  evidence: string[]; // the facts behind it: parameter names, copies, the route it meant
  related: Place[]; // other places involved: callers, other copies
  why: string; // why it matters, in one line
  fix: string[]; // steps
  // safe: a structure-only change (no change in what the code does), fine to make on its own.
  // ask-first: changes behavior or a contract; check with the person before doing it.
  // warning: not a task (a hotspot): how to work in this file.
  safety: "safe" | "ask-first" | "warning";
  verify: string; // how to know the fix worked
}
