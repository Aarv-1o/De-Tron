import { relative } from "node:path";
import { partOf, severityOf } from "../findings/severity.ts";
import type { Finding } from "../findings/types.ts";
import { briefLine } from "../report/brief.ts";
import type { Config } from "./config.ts";
import { fixedSince, keyOf, newSince, type Task } from "./ledger.ts";

// What Detron says at each moment of an agent's task. Short on purpose: the agent pays for
// every word, so it hears only problems this task added, once each, and nothing when clean.

export interface HookInput {
  hook_event_name: string;
  session_id: string;
  cwd?: string;
  tool_name?: string;
  tool_input?: { file_path?: string };
  stop_hook_active?: boolean;
}

export interface HookReply {
  stdout: string; // JSON for the agent, or "" to stay silent
  exitCode: number;
}

const EDIT_TOOLS = /^(Write|Edit|MultiEdit|NotebookEdit)$/;
const PER_EDIT = 5; // lines after one edit
const FOCUS = 3; // lines in a check-in
const MAX_BLOCKED_STOPS = 2; // then let it finish: a block that keeps failing is a loop

const SILENT: HookReply = { stdout: "", exitCode: 0 };
const json = (value: object): HookReply => ({ stdout: `${JSON.stringify(value)}\n`, exitCode: 0 });
const matters = (f: Finding) => ["error", "warning"].includes(severityOf(f));
const worstFirst = (a: Finding, b: Finding) => Number(severityOf(a) !== "error") - Number(severityOf(b) !== "error");
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export const isEdit = (input: HookInput) => EDIT_TOOLS.test(input.tool_name ?? "");

// After an edit: problems this task added that the agent hasn't been told about yet.
export function afterEdit(input: HookInput, root: string, task: Task, told: Set<string>, findings: Finding[], config: Config): HookReply {
  if (input.tool_input?.file_path) task.editedFiles.add(relative(root, input.tool_input.file_path).replace(/\\/g, "/"));
  task.edits++;
  const added = newSince(task, findings).filter(matters).sort(worstFirst);
  const fresh = added.filter((f) => !told.has(keyOf(f)));
  for (const f of fresh) told.add(keyOf(f));
  const lines: string[] = [];
  if (fresh.length) {
    lines.push(`Detron: this edit added ${plural(fresh.length, "problem")}:`, ...fresh.slice(0, PER_EDIT).map(briefLine));
    if (fresh.length > PER_EDIT) lines.push(`…and ${fresh.length - PER_EDIT} more.`);
    lines.push("Fix them before moving on, or say why not. Full steps: `detron explain <file:line>`.");
  }
  if (task.edits - task.lastCheckIn >= config.checkInEvery) {
    task.lastCheckIn = task.edits;
    lines.push(...(lines.length ? [""] : []), ...checkIn(task, findings));
  }
  if (!lines.length) return SILENT;
  const message = lines.join("\n");
  // Block mode: a new security or crash problem comes back to the agent as an error.
  if (config.mode === "block" && fresh.some((f) => severityOf(f) === "error")) return json({ decision: "block", reason: message });
  return json({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: message } });
}

function checkIn(task: Task, findings: Finding[]): string[] {
  const added = newSince(task, findings);
  const real = added.filter(matters).sort(worstFirst);
  const cleanup = added.length - real.length;
  const fixed = fixedSince(task, findings);
  const head = `Detron check-in after ${plural(task.edits, "edit")}: this task added ${plural(real.length, "problem")}${fixed ? ` and fixed ${fixed}` : ""}.`;
  if (!real.length && !cleanup) return [`${head} Nothing to fix: carry on.`];
  return [
    head,
    ...(real.length ? ["Focus here:", ...real.slice(0, FOCUS).map((f) => `- ${briefLine(f)}`)] : []),
    ...(cleanup ? [`Also ${plural(cleanup, "clean-up item")} (unused or copied code): \`detron scan --changed\` lists them. Clean up in its own step, not mixed with the feature.`] : []),
  ];
}

// When the agent wants to finish: a summary for the person; in block mode, not done while
// the task has added security or crash problems.
export function atStop(input: HookInput, task: Task, findings: Finding[], config: Config): HookReply {
  const added = newSince(task, findings);
  const real = added.filter(matters).sort(worstFirst);
  const errors = real.filter((f) => severityOf(f) === "error");
  if (config.mode === "block" && errors.length && !input.stop_hook_active && task.stopsBlocked < MAX_BLOCKED_STOPS) {
    task.stopsBlocked++;
    return json({ decision: "block", reason: [`Detron: not done yet. This task added ${plural(errors.length, "security or crash problem")}:`, ...errors.slice(0, PER_EDIT).map(briefLine), "Fix them, or tell the person why they're fine."].join("\n") });
  }
  if (!task.edits) return SILENT;
  const fixed = fixedSince(task, findings);
  const parts = ["security", "breaks", "database"].map((p) => [p, real.filter((f) => partOf(f) === p).length] as const).filter(([, n]) => n);
  const summary = real.length
    ? `Detron: this task added ${plural(real.length, "problem")} (${parts.map(([p, n]) => `${n} ${p === "breaks" ? "will break" : p}`).join(", ")})${fixed ? ` and fixed ${fixed}` : ""}. See them with \`detron scan --changed\` or in the Detron sidebar.`
    : `Detron: this task added no new problems${fixed ? ` and fixed ${fixed}` : ""}.`;
  return json({ systemMessage: summary });
}
