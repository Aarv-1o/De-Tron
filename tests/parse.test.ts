import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { makeRepo } from "./helpers.ts";
import { detectLanguage, parseFile, parseSource } from "../src/parse/parse.ts";

test("detects languages by extension", () => {
  assert.equal(detectLanguage("a/b.js"), "javascript");
  assert.equal(detectLanguage("App.JSX"), "javascript");
  assert.equal(detectLanguage("x.mts"), "typescript");
  assert.equal(detectLanguage("Page.tsx"), "tsx");
  assert.equal(detectLanguage("main.py"), "python");
  assert.equal(detectLanguage("style.css"), undefined);
  assert.equal(detectLanguage("Makefile"), undefined);
});

test("parses each language without errors", async () => {
  const samples = {
    javascript: "export function add(a, b) { return a + b; }",
    typescript: "export const add = (a: number, b: number): number => a + b;",
    tsx: "export const Hi = ({ name }: { name: string }) => <p>{name}</p>;",
    python: "def add(a: int, b: int) -> int:\n    return a + b\n",
  } as const;
  for (const [language, source] of Object.entries(samples)) {
    const tree = await parseSource(source, language as keyof typeof samples);
    assert.equal(tree.rootNode.hasError, false, `${language} sample should parse cleanly`);
    tree.delete();
  }
});

test("parseFile reads and parses a supported file", async () => {
  const dir = await makeRepo({ "util.py": "def time_ago(ts):\n    return ts\n" });
  const parsed = await parseFile(join(dir, "util.py"));
  assert.ok(parsed);
  assert.equal(parsed.language, "python");
  assert.equal(parsed.tree.rootNode.type, "module");
  parsed.tree.delete();
});

test("parseFile skips unsupported files", async () => {
  const dir = await makeRepo({ "notes.md": "# hi" });
  assert.equal(await parseFile(join(dir, "notes.md")), undefined);
});
