import { collectFindings } from "../findings/collect.ts";
import type { Finding } from "../findings/types.ts";
import type { FileCache } from "../index/fileScan.ts";
import { scanRepo } from "../scan/scan.ts";
import { loadConfig } from "./config.ts";
import { afterEdit, atStop, isEdit, type HookInput, type HookReply } from "./hooks.ts";
import { startTask, type Task } from "./ledger.ts";

// One repo's agent sessions: each session's task, and one cache of what every file taught us,
// so a check after an edit reads only that file. Lives in the background Detron (or for one
// hook call, when that can't start).

const SILENT: HookReply = { stdout: "", exitCode: 0 };

export class Sessions {
  private readonly cache: FileCache = new Map();
  private readonly tasks = new Map<string, { task: Task; told: Set<string> }>();

  constructor(readonly root: string) {}

  private async findings(): Promise<Finding[]> {
    return collectFindings(await scanRepo(this.root, this.cache));
  }

  // The task starts at the session's start, or before its first edit if that came first.
  private async taskOf(session: string, findings?: Finding[]) {
    let entry = this.tasks.get(session);
    if (!entry) this.tasks.set(session, (entry = { task: startTask(findings ?? (await this.findings())), told: new Set() }));
    return entry;
  }

  async handle(input: HookInput): Promise<HookReply> {
    const event = input.hook_event_name;
    if (event === "SessionStart") {
      this.tasks.delete(input.session_id); // a new or cleared conversation is a new task
      await this.taskOf(input.session_id);
      return SILENT;
    }
    if (event === "PreToolUse" && isEdit(input)) {
      await this.taskOf(input.session_id);
      return SILENT;
    }
    if (event === "PostToolUse" && isEdit(input)) {
      const { task, told } = await this.taskOf(input.session_id);
      return afterEdit(input, this.root, task, told, await this.findings(), await loadConfig(this.root));
    }
    if (event === "Stop") {
      const entry = this.tasks.get(input.session_id);
      if (!entry) return SILENT; // nothing was edited in this session
      return atStop(input, entry.task, await this.findings(), await loadConfig(this.root));
    }
    return SILENT;
  }
}
