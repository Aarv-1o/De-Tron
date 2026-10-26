import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildIndex } from "../src/index/repo.ts";

test("buildIndex indexes a mixed JS + Python repo", async () => {
  const root = await mkdtemp(join(tmpdir(), "detron-"));
  await mkdir(join(root, "web"));
  await mkdir(join(root, "api"));
  await writeFile(join(root, "web/chat.js"), "export function stripJsonState(text) { return text; }\n");
  await writeFile(join(root, "api/main.py"), "def _strip_json_state(text):\n    return text\n");
  await writeFile(join(root, "api/broken.py"), "def oops(:\n");

  const index = await buildIndex(root);
  assert.deepEqual(index.files, ["api/broken.py", "api/main.py", "web/chat.js"]);
  const names = index.functions.map((f) => `${f.file}:${f.name}`);
  assert.ok(names.includes("api/main.py:_strip_json_state"));
  assert.ok(names.includes("web/chat.js:stripJsonState"));
  // tree-sitter recovers what it can from broken files, so we flag them instead of skipping them.
  assert.deepEqual(index.filesWithSyntaxErrors, ["api/broken.py"]);
});
