import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { init, withDetronHooks } from "../src/agent/init.ts";
import { makeRepo } from "./helpers.ts";

const CMD = 'node "D:/detron/De-Tron/dist/detron.mjs" hook claude';

test("init adds Detron's hooks, keeps the person's own, and doesn't add them twice", () => {
  const mine = { hooks: { PostToolUse: [{ matcher: "Edit", hooks: [{ type: "command", command: "prettier --write" }] }] }, model: "opus" };
  const once = withDetronHooks(mine, CMD);
  const twice = withDetronHooks(once, CMD);
  assert.deepEqual(twice, once);
  assert.equal(twice.model, "opus");
  assert.deepEqual(Object.keys(twice.hooks!), ["PostToolUse", "SessionStart", "PreToolUse", "Stop"]);
  assert.deepEqual(twice.hooks!.PostToolUse!.map((g) => g.hooks[0]!.command), ["prettier --write", CMD]);
  assert.equal(twice.hooks!.PreToolUse![0]!.matcher, "Write|Edit|MultiEdit|NotebookEdit");
});

test("init writes the local settings and the mode, and won't overwrite settings it can't read", async () => {
  const root = await makeRepo({ "index.js": "export const a = 1;\n", "tools/detron.mjs": "// stand-in for the built Detron\n" });
  const entry = join(root, "tools/detron.mjs");
  const done = await init(root, entry, "block");
  assert.equal(done.length, 2);
  const settings = JSON.parse(await readFile(join(root, ".claude/settings.local.json"), "utf8"));
  assert.equal(settings.hooks.Stop[0].hooks[0].command, `node "${entry.replace(/\\/g, "/")}" hook claude`);
  assert.deepEqual(JSON.parse(await readFile(join(root, ".detron/config.json"), "utf8")), { mode: "block" });
  await writeFile(join(root, ".claude/settings.local.json"), "{ not json");
  await assert.rejects(init(root, entry, undefined), /won't overwrite it/);
  assert.equal(await readFile(join(root, ".claude/settings.local.json"), "utf8"), "{ not json");
});
