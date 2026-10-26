import assert from "node:assert/strict";
import { test } from "node:test";
import { extractFunctions, type FunctionInfo } from "../src/index/functions.ts";
import { parseSource, type LanguageId } from "../src/parse/parse.ts";

async function extract(source: string, language: LanguageId): Promise<FunctionInfo[]> {
  const tree = await parseSource(source, language);
  try {
    return extractFunctions({ path: "x", language, source, tree }, "x");
  } finally {
    tree.delete();
  }
}

const byName = (fns: FunctionInfo[]) => Object.fromEntries(fns.map((f) => [f.name, f]));

test("JS/TS: finds every named function form", async () => {
  const fns = byName(await extract(`
export function timeAgo(dateStr) { return dateStr; }
const formatSize = (bytes, { unit = "B" } = {}) => bytes;
export const fetchItems = async function (page = 1, ...rest) { await page; };
class Registry {
  has(type) { return this.map.has(type); }
}
const api = { load(id) { return id; } };
[1, 2].map((x) => x * 2); // anonymous: not indexed
`, "typescript"));

  assert.deepEqual(Object.keys(fns).sort(), ["fetchItems", "formatSize", "has", "load", "timeAgo"]);
  assert.deepEqual(fns.timeAgo?.params, ["dateStr"]);
  assert.deepEqual(fns.formatSize?.params, ["bytes", "{ unit = \"B\" }"]);
  assert.deepEqual(fns.fetchItems?.params, ["page", "...rest"]);
  assert.equal(fns.fetchItems?.async, true);
  assert.equal(fns.has?.className, "Registry");
  assert.equal(fns.timeAgo?.startLine, 2);
});

test("JS: knows what is exported, in every export style", async () => {
  const fns = byName(await extract(`
export function a() {}
function b() {}
function c() {}
function d() {}
function e() {}
function hidden() {}
export { b };
export default c;
module.exports.d = d;
exports.e = e;
`, "javascript"));
  for (const name of ["a", "b", "c", "d", "e"]) assert.equal(fns[name]?.exported, true, `${name} should be exported`);
  assert.equal(fns.hidden?.exported, false);
});

test("JS: module.exports object counts as exported", async () => {
  const fns = byName(await extract("function a() {}\nconst b = () => 1;\nmodule.exports = { a, b: b };", "javascript"));
  assert.equal(fns.a?.exported, true);
  assert.equal(fns.b?.exported, true);
});

test("TSX: components are functions too", async () => {
  const fns = await extract("export const Card = ({ title }: { title: string }) => <h2>{title}</h2>;", "tsx");
  assert.equal(fns[0]?.name, "Card");
  assert.equal(fns[0]?.exported, true);
});

test("Python: functions, methods, decorators and public names", async () => {
  const fns = byName(await extract(`
import functools

def strip_json_state(text: str, *, strict=False) -> str:
    return text

def _helper(x):
    return x

@functools.cache
async def fetch(url, timeout: int = 5, *args, **kwargs):
    return url

class Planner:
    def plan(self, state):
        def inner():
            pass
        return state
`, "python"));
  assert.deepEqual(fns.strip_json_state?.params, ["text", "strict"]);
  assert.equal(fns.strip_json_state?.exported, true);
  assert.equal(fns._helper?.exported, false);
  assert.equal(fns.fetch?.exported, true, "decorated top-level function is public");
  assert.equal(fns.fetch?.async, true);
  assert.deepEqual(fns.fetch?.params, ["url", "timeout", "*args", "**kwargs"]);
  assert.equal(fns.plan?.className, "Planner");
  assert.equal(fns.plan?.exported, false);
  assert.equal(fns.inner?.exported, false);
});
