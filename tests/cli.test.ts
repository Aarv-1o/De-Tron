import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { run } from "../src/cli/run.ts";
import { makeRepo } from "./helpers.ts";

const flagRepo = fileURLToPath(new URL("fixtures/duplicates/flag", import.meta.url));

async function cli(...args: string[]): Promise<{ code: number; text: string }> {
  let text = "";
  const code = await run(args, (t) => (text += t));
  return { code, text };
}

test("scan prints copies found in a repo", async () => {
  const { code, text } = await cli("scan", flagRepo);
  assert.equal(code, 0);
  assert.match(text, /Detron scan: .*flag/);
  assert.match(text, /\d+ files, \d+ functions/);
  assert.match(text, /Copies \(3\)/);
  assert.match(text, /web\/time\.ts:1 {2}timeAgo/);
  assert.match(text, /Dead code|No dead code found/);
  assert.match(text, /Code hygiene|No code hygiene issues found/);
});

test("scan --json is valid JSON with the groups", async () => {
  const { code, text } = await cli("scan", flagRepo, "--json");
  assert.equal(code, 0);
  const data = JSON.parse(text);
  assert.ok(data.duplicates.some((g: { kind: string }) => g.kind === "cross-language"));
  assert.deepEqual(Object.keys(data.deadCode).sort(), ["files", "functions", "packages"]);
});

test("help, unknown commands and missing folders", async () => {
  assert.equal((await cli("--help")).code, 0);
  assert.equal((await cli()).code, 2);
  const unknown = await cli("fix", ".");
  assert.equal(unknown.code, 2);
  assert.match(unknown.text, /Unknown command: fix/);
  const typo = await cli("scan", ".", "all");
  assert.equal(typo.code, 2);
  assert.match(typo.text, /Did you mean --all\?/);
  const missing = await cli("scan", "no/such/folder");
  assert.equal(missing.code, 2);
  assert.match(missing.text, /that folder doesn't exist/);
});

test("scan says which files it couldn't check", async () => {
  const root = await makeRepo({ "src/a.ts": "export const a = 1;\n", "src/Nav.vue": "<template></template>\n", "src/Hero.vue": "" });
  const { text } = await cli("scan", root);
  assert.match(text, /Not checked: 2 .vue files \(not supported yet\)/);
});
