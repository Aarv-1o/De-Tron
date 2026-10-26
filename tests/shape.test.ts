import assert from "node:assert/strict";
import { test } from "node:test";
import { extractFunctions } from "../src/index/functions.ts";
import { parseSource, type LanguageId } from "../src/parse/parse.ts";

async function shapes(source: string, language: LanguageId): Promise<Record<string, string>> {
  const tree = await parseSource(source, language);
  try {
    const fns = extractFunctions({ path: "x", language, source, tree }, "x");
    return Object.fromEntries(fns.map((f) => [f.name, f.shape.join(" ")]));
  } finally {
    tree.delete();
  }
}

test("renamed copies get the same shape, whatever the function style", async () => {
  const s = await shapes(`
function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  return diff < 60000 ? "Just now" : \`\${diff}ms\`;
}
const fileTimeAgo = (d) => {
  const delta = Date.now() - new Date(d).getTime();
  return delta < 60000 ? 'Just now' : \`\${delta}ms\`;
};`, "typescript");
  assert.equal(s.timeAgo, s.fileTimeAgo);
});

test("different literals give different shapes", async () => {
  const s = await shapes(`
function a(x) { return x < 60 ? "Just now" : "later"; }
function b(x) { return x < 45 ? "just now" : "later"; }`, "javascript");
  assert.notEqual(s.a, s.b);
});

test("comments don't change the shape", async () => {
  const s = await shapes(`
def a(x):
    # double it
    return x * 2

def b(y):
    return y * 2
`, "python");
  assert.equal(s.a, s.b);
});
