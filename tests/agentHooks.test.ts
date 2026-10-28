import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { Sessions } from "../src/agent/session.ts";
import { makeRepo } from "./helpers.ts";

const START = `export function load(url) {\n  try {\n    return fetch(url);\n  } catch (e) {}\n}\n`;
const SAVE = `${START}export function save(x) {\n  try {\n    db.put(x);\n  } catch (e) {}\n}\n`;

async function task(mode?: "block") {
  const root = await makeRepo({ "index.js": START, ...(mode ? { ".detron/config.json": JSON.stringify({ mode }) } : {}) });
  const sessions = new Sessions(root);
  const hook = async (event: string, extra: object = {}) => {
    const reply = await sessions.handle({ hook_event_name: event, session_id: "s1", ...extra });
    return reply.stdout ? JSON.parse(reply.stdout) : undefined;
  };
  const edit = async (file: string, text: string) => {
    await hook("PreToolUse", { tool_name: "Write", tool_input: { file_path: join(root, file) } });
    await mkdir(join(root, file, ".."), { recursive: true });
    await writeFile(join(root, file), text);
    return hook("PostToolUse", { tool_name: "Write", tool_input: { file_path: join(root, file) } });
  };
  return { root, hook, edit };
}

test("after an edit: only problems this task added, each told once, silent when clean", async () => {
  const { hook, edit } = await task();
  await hook("SessionStart");
  assert.equal(await edit("notes.js", "export const a = 1;\n"), undefined, "nothing new: silent");
  const told = await edit("index.js", SAVE);
  assert.equal(told.hookSpecificOutput.hookEventName, "PostToolUse");
  assert.match(told.hookSpecificOutput.additionalContext, /^Detron: this edit added 1 problem:\nindex\.js:9 warning detron\/empty-catch: /);
  assert.doesNotMatch(told.hookSpecificOutput.additionalContext, /index\.js:4/, "the empty catch from before the task isn't this task's");
  assert.equal(await edit("notes.js", "export const a = 2;\n"), undefined, "already told: not repeated");
});

test("every 10 edits, a check-in; at the end, a summary for the person", async () => {
  const { hook, edit } = await task();
  await hook("SessionStart");
  await edit("index.js", SAVE);
  let reply;
  for (let i = 2; i <= 10; i++) reply = await edit("notes.js", `export const a = ${i};\n`);
  assert.match(reply.hookSpecificOutput.additionalContext, /^Detron check-in after 10 edits: this task added 1 problem\.\nFocus here:\n- index\.js:9 warning/);
  const stop = await hook("Stop", { stop_hook_active: false });
  assert.equal(stop.systemMessage, "Detron: this task added 1 problem (1 will break). See them with `detron scan --changed` or in the Detron sidebar.");
});

test("block mode: a new security problem comes back as an error, and the task can't finish until it's fixed", async () => {
  const { hook, edit } = await task("block");
  await hook("SessionStart");
  const risky = `export function run(req, res) {\n  res.json(eval(req.body.code));\n}\n`;
  const told = await edit("run.js", risky);
  assert.equal(told.decision, "block");
  assert.match(told.reason, /run\.js:2 error detron\/code-eval: /);
  const stop = await hook("Stop", { stop_hook_active: false });
  assert.equal(stop.decision, "block");
  assert.match(stop.reason, /^Detron: not done yet\. This task added 1 security or crash problem:/);
  assert.equal((await hook("Stop", { stop_hook_active: true })).decision, undefined, "already continuing after a block: let it stop");
  await edit("run.js", `export function run(req, res) {\n  res.json({ ok: true });\n}\n`);
  assert.equal((await hook("Stop", { stop_hook_active: false })).systemMessage, "Detron: this task added no new problems.");
});

test("suggest mode never blocks", async () => {
  const { hook, edit } = await task();
  await hook("SessionStart");
  const told = await edit("run.js", `export function run(req, res) {\n  res.json(eval(req.body.code));\n}\n`);
  assert.equal(told.decision, undefined);
  assert.match(told.hookSpecificOutput.additionalContext, /code-eval/);
  assert.equal((await hook("Stop", { stop_hook_active: false })).decision, undefined);
});
