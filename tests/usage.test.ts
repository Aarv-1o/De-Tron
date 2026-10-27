import assert from "node:assert/strict";
import { test } from "node:test";
import { extractUsage, type FileUsage } from "../src/index/usage.ts";
import { parseSource, type LanguageId } from "../src/parse/parse.ts";

async function usage(source: string, language: LanguageId): Promise<FileUsage> {
  const tree = await parseSource(source, language);
  try {
    return extractUsage({ path: "x", language, source, tree });
  } finally {
    tree.delete();
  }
}

test("JS/TS: every import style", async () => {
  const { imports } = await usage(`
import React, { useState as useS, useEffect } from "react";
import * as path from 'node:path';
import "./styles.css";
export { formatSize } from "./utils/format";
export * from "./types";
const lazyPage = () => import("./pages/Inbox");
const dotenv = require("dotenv");
const wasm = require.resolve("tree-sitter-python/tree-sitter-python.wasm");
`, "tsx");
  assert.deepEqual(imports.map((i) => i.source), [
    "react", "node:path", "./styles.css", "./utils/format", "./types",
    "./pages/Inbox", "dotenv", "tree-sitter-python/tree-sitter-python.wasm",
  ]);
  assert.deepEqual(imports[0]!.names, ["useState", "useEffect"]);
  assert.deepEqual(imports[3]!.names, ["formatSize"]);
});

test("Python: import and from-import, absolute and relative", async () => {
  const { imports } = await usage(`
import os, json as j
import agents.planner
from agents.utils import maps_text_search, general_search as gs
from .prompts import SYSTEM
from . import chatbot
`, "python");
  assert.deepEqual(imports.map((i) => i.source), ["os", "json", "agents.planner", "agents.utils", ".prompts", "."]);
  assert.deepEqual(imports[3]!.names, ["maps_text_search", "general_search"]);
  assert.deepEqual(imports[5]!.names, ["chatbot"]);
});

test("counts how often each name appears", async () => {
  const { names } = await usage("function a() { return b(1) + b(2); }\nconst c = { b };\n", "javascript");
  assert.equal(names.get("a"), 1);
  assert.equal(names.get("b"), 3);
});

test("export lists don't count as using a name", async () => {
  const es = (await usage("function a() {}\nfunction b() { a(); }\nexport { a, b };\n", "javascript")).names;
  assert.equal(es.get("a"), 2, "definition + call, not the export list");
  assert.equal(es.get("b"), 1);
  const cjs = (await usage("function a() {}\nfunction b() {}\nmodule.exports = { a, b: b, c: () => a() };\nexports.d = b;\n", "javascript")).names;
  assert.equal(cjs.get("a"), 2, "definition + the call inside c");
  assert.equal(cjs.get("b"), 1);
});

test("records which local name each import binds", async () => {
  const js = await usage(`import a, { b as c } from "./x";\nimport * as d from "./y";\nconst e = require("./z");\nconst { f, g: h } = require("./w");\n`, "typescript");
  assert.deepEqual(js.imports.map((i) => i.bound), [{ a: "default", c: "b" }, { d: "*" }, { e: "default" }, { f: "f", h: "g" }]);
  const py = await usage(`import os\nimport app.api.chat as chat\nimport app.db\nfrom app.api.news import router as news_router, X\n`, "python");
  assert.deepEqual(py.imports.map((i) => i.bound), [{ os: "*" }, { chat: "*" }, {}, { news_router: "router", X: "X" }]);
});
