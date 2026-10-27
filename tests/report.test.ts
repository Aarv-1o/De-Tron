import assert from "node:assert/strict";
import { test } from "node:test";
import { fakeFunction } from "./helpers.ts";
import { duplicatesToJson, formatDuplicates } from "../src/report/duplicates.ts";
import type { DuplicateGroup } from "../src/rules/codebase/duplicates.ts";

const fn = (name: string, file: string, startLine: number) => fakeFunction({ name, file, startLine });

const groups: DuplicateGroup[] = [
  { kind: "exact", confidence: "sure", sharedValues: ["just now", "m ago"], functions: [fn("timeAgo", "a.ts", 3), fn("fileTimeAgo", "b.ts", 8)] },
  { kind: "similar", confidence: "maybe", sharedValues: [], functions: [fn("fetchClients", "c.ts", 1), fn("fetchItems", "d.ts", 1)] },
];

test("text report: sure copies with locations, evidence and advice; hints hidden by default", () => {
  const text = formatDuplicates(groups, false);
  assert.match(text, /Copies \(1\)/);
  assert.match(text, /1\. timeAgo, fileTimeAgo \(2 copies\)/);
  assert.match(text, /a\.ts:3 {2}timeAgo/);
  assert.match(text, /Same wording: "just now", "m ago"/);
  assert.match(text, /→ Keep one, import it everywhere else\./);
  assert.match(text, /1 more hints hidden/);
  assert.doesNotMatch(text, /fetchClients/);
});

test("text report: --all shows hints", () => {
  assert.match(formatDuplicates(groups, true), /Hints \(1\)[\s\S]*fetchClients/);
});

test("text report: says so when there is nothing", () => {
  assert.equal(formatDuplicates([], false), "No copies found.\n");
});

test("JSON leaves out internal body shapes", () => {
  const json = duplicatesToJson(groups);
  assert.deepEqual(Object.keys(json[0]!.functions[0]!).sort(), ["endLine", "file", "language", "name", "startLine"]);
});
