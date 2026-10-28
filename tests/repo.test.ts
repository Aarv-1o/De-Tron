import assert from "node:assert/strict";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { makeRepo } from "./helpers.ts";
import { buildIndex } from "../src/index/repo.ts";

test("buildIndex indexes a mixed JS + Python repo", async () => {
  const root = await makeRepo({
    "web/chat.js": "export function stripJsonState(text) { return text; }\n",
    "api/main.py": "def _strip_json_state(text):\n    return text\n",
    "api/broken.py": "def oops(:\n",
  });

  const index = await buildIndex(root);
  assert.deepEqual(index.files, ["api/broken.py", "api/main.py", "web/chat.js"]);
  const names = index.functions.map((f) => `${f.file}:${f.name}`);
  assert.ok(names.includes("api/main.py:_strip_json_state"));
  assert.ok(names.includes("web/chat.js:stripJsonState"));
  // tree-sitter recovers what it can from broken files, so we flag them instead of skipping them.
  assert.deepEqual(index.filesWithSyntaxErrors, ["api/broken.py"]);
});

test("buildIndex reads again only the files that changed", async () => {
  const root = await makeRepo({ "a.ts": "export const a = 1;\n", "b.py": "b = 2\n", "notes.md": "# hi\n" });
  const cache = new Map();
  assert.equal((await buildIndex(root, cache)).filesRead, 2);
  assert.equal((await buildIndex(root, cache)).filesRead, 0, "nothing changed");
  await writeFile(join(root, "a.ts"), "export function a() { return 2; }\n");
  await writeFile(join(root, "c.ts"), "export const c = 3;\n");
  const again = await buildIndex(root, cache);
  assert.equal(again.filesRead, 2, "the edited file and the new one");
  assert.deepEqual(again.functions.map((f) => f.name), ["a"]);
  await rm(join(root, "b.py"));
  assert.deepEqual((await buildIndex(root, cache)).files, ["a.ts", "c.ts"]);
  assert.deepEqual([...cache.keys()].sort(), ["a.ts", "c.ts"], "a deleted file leaves the cache");
});
