import assert from "node:assert/strict";
import { test } from "node:test";
import { unsupportedCode } from "../src/index/files.ts";
import { grammarForFile, supportFor } from "../src/languages/index.ts";

test("every supported extension has a grammar and an adapter", () => {
  for (const file of ["a.js", "a.jsx", "a.mjs", "a.cjs", "a.ts", "a.mts", "a.cts", "a.tsx", "a.py"]) {
    const grammar = grammarForFile(file);
    assert.ok(grammar, file);
    assert.equal(supportFor(grammar.id), grammar.lang);
  }
});

test("a language is either supported or listed as not supported yet, never both", () => {
  const notYet = unsupportedCode(["a.astro", "a.vue", "a.svelte", "A.java", "a.go", "a.rs", "a.py", "a.ts"]);
  assert.deepEqual([...notYet.keys()].sort(), ["astro", "go", "java", "rs", "svelte", "vue"]);
});
