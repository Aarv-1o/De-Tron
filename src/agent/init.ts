import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

// `detron init`: sets up Detron's hooks for Claude Code in a repo (Cursor and Copilot CLI load
// Claude Code's hooks too). In .claude/settings.local.json: it names where Detron is on this
// machine, so it isn't one to commit.

const EDITS = "Write|Edit|MultiEdit|NotebookEdit";
const TIMEOUT_S = 60; // the first hook of a session scans the whole repo

interface Handler { type: string; command: string; timeout?: number }
interface Group { matcher?: string; hooks: Handler[] }
type Settings = { hooks?: Record<string, Group[]> } & Record<string, unknown>;

const isDetron = (h: Handler) => / hook claude$/.test(h.command) && /detron/i.test(h.command);

// The settings with Detron's hooks added, replacing any it added before and keeping the rest.
export function withDetronHooks(settings: Settings, command: string): Settings {
  const hooks: Record<string, Group[]> = {};
  for (const [event, groups] of Object.entries(settings.hooks ?? {})) {
    const kept = groups.map((g) => ({ ...g, hooks: g.hooks.filter((h) => !isDetron(h)) })).filter((g) => g.hooks.length);
    if (kept.length) hooks[event] = kept;
  }
  const handler = { type: "command", command, timeout: TIMEOUT_S };
  const add = (event: string, group: Group) => (hooks[event] = [...(hooks[event] ?? []), group]);
  add("SessionStart", { hooks: [handler] });
  add("PreToolUse", { matcher: EDITS, hooks: [handler] });
  add("PostToolUse", { matcher: EDITS, hooks: [handler] });
  add("Stop", { hooks: [handler] });
  return { ...settings, hooks };
}

// The built Detron: hooks run it with plain node, from the repo's folder.
export function hookCommand(entry: string): string {
  const built = entry.endsWith(".mjs") ? entry : resolve(dirname(entry), "../../dist/detron.mjs");
  if (!existsSync(built)) throw new Error(`Detron isn't built yet: run \`npm run build\` in Detron's folder first (looked for ${built}).`);
  return `node "${built.replace(/\\/g, "/")}" hook claude`;
}

export async function init(root: string, entry: string, mode: "suggest" | "block" | undefined): Promise<string[]> {
  const command = hookCommand(entry);
  const path = join(root, ".claude/settings.local.json");
  let settings: Settings = {};
  if (existsSync(path)) {
    try {
      settings = JSON.parse(await readFile(path, "utf8")) as Settings;
    } catch (error) {
      throw new Error(`Can't read ${path} (${(error as Error).message}). Fix it or move it away, then run init again: Detron won't overwrite it.`);
    }
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(withDetronHooks(settings, command), null, 2)}\n`);
  const done = [`Claude Code hooks: ${path} (session start, before and after each edit, at the end)`];
  if (mode) {
    const configPath = join(root, ".detron/config.json");
    let config: Record<string, unknown> = {};
    if (existsSync(configPath)) config = JSON.parse(await readFile(configPath, "utf8")) as Record<string, unknown>;
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, `${JSON.stringify({ ...config, mode }, null, 2)}\n`);
    done.push(`Mode: ${mode} (${configPath})`);
  }
  return done;
}
