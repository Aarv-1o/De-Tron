import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { run } from "../src/cli/run.ts";

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
});

test("scan --json is valid JSON with the groups", async () => {
  const { code, text } = await cli("scan", flagRepo, "--json");
  assert.equal(code, 0);
  const data = JSON.parse(text);
  assert.ok(data.duplicates.some((g: { kind: string }) => g.kind === "cross-language"));
});

test("help, unknown commands and missing folders", async () => {
  assert.equal((await cli("--help")).code, 0);
  assert.equal((await cli()).code, 2);
  const unknown = await cli("fix", ".");
  assert.equal(unknown.code, 2);
  assert.match(unknown.text, /Unknown command: fix/);
  const missing = await cli("scan", "no/such/folder");
  assert.equal(missing.code, 2);
  assert.match(missing.text, /that folder doesn't exist/);
});
