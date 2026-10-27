import assert from "node:assert/strict";
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

test("buildIndex hands each parsed file to onFile, before freeing it", async () => {
  const root = await makeRepo({ "a.ts": "const a = 1;\n", "b.py": "b = 2\n", "notes.md": "# hi\n" });
  const seen: string[] = [];
  await buildIndex(root, { onFile: (parsed, file) => {
    seen.push(`${file}:${parsed.tree.rootNode.type}`);
  } });
  assert.deepEqual(seen, ["a.ts:program", "b.py:module"]);
});
