import assert from "node:assert/strict";
import { test } from "node:test";
import { makeRepo } from "./helpers.ts";
import { buildIndex } from "../src/index/repo.ts";
import { findDeadFunctions } from "../src/rules/codebase/deadFunctions.ts";

async function deadIn(files: Record<string, string>): Promise<string[]> {
  const root = await makeRepo(files);
  return (await findDeadFunctions(await buildIndex(root))).map((d) => `${d.confidence} ${d.fn.name}`);
}

test("flags functions nothing uses", async () => {
  assert.deepEqual(await deadIn({
    "src/scheduler.js": [
      "function startScheduler() { tick(); }",
      "function tick() {}",
      "function oldTick() {}", // private, unused: sure
      "export function stopScheduler() {}", // exported, unused: likely
      "export function formatLegacy() {}", // only tests use it: likely
      "startScheduler();",
    ].join("\n"),
    "src/__tests__/scheduler.test.js": 'import { formatLegacy } from "../scheduler.js";\nformatLegacy();\n',
    "agents/utils.py": "def maps_search(q):\n    return q\n", // public Python, unused: likely
  }), ["likely maps_search", "sure oldTick", "likely stopScheduler", "likely formatLegacy"]);
});

test("does not flag functions used in ways we can't see by name", async () => {
  assert.deepEqual(await deadIn({
    "src/app.tsx": [
      'import { helper } from "./lib";',
      "export default function App() { return <Sprig />; }", // default export: loaded by the framework
      "function Sprig() { return helper(); }", // used in JSX
      "class Store { load() {} }", // method
      "const tool = { handler() {}, run: async () => {} };", // object properties
      "export function GET() {}", // framework route export
      "registry.register(tool);",
    ].join("\n"),
    "src/lib.ts": "export function helper() { return 1; }\n",
    "api/main.py": [
      "@app.get('/')",
      "def root():", // decorated: registered with FastAPI
      "    pass",
      "",
      "def __getattr__(name):", // dunder
      "    pass",
    ].join("\n"),
    "index.html": '<button onclick="sendMessage()">Send</button>\n<script src="chat.js"></script>\n',
    "chat.js": "function sendMessage() {}\n", // called from HTML
  }), []);
});
