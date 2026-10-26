import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { buildIndex } from "../src/index/repo.ts";
import { findDuplicates, type DuplicateGroup } from "../src/rules/codebase/duplicates.ts";

const fixture = (name: string) => fileURLToPath(new URL(`fixtures/duplicates/${name}`, import.meta.url));
const names = (g: DuplicateGroup) => g.functions.map((f) => f.name).sort();

test("flags renamed exact copies as sure", async () => {
  const groups = findDuplicates((await buildIndex(fixture("flag"))).functions);
  const exact = groups.filter((g) => g.kind === "exact").map(names);
  assert.deepEqual(exact.sort(), [
    ["escapeRegex", "escapeRegex", "escapeRegex"],
    ["fileTimeAgo", "timeAgo"],
    ["formatFileSize", "formatSize"],
  ]);
  assert.ok(groups.filter((g) => g.kind === "exact").every((g) => g.confidence === "sure"));
});

test("flags a drifted copy as likely, alongside the originals", async () => {
  const groups = findDuplicates((await buildIndex(fixture("flag"))).functions);
  const near = groups.find((g) => g.kind === "similar" && names(g).includes("relativeTime"));
  assert.ok(near, "relativeTime should be grouped with timeAgo");
  assert.equal(near.confidence, "likely");
  assert.deepEqual(names(near), ["fileTimeAgo", "relativeTime", "timeAgo"]);
});

test("flags the same function written in JS and Python", async () => {
  const groups = findDuplicates((await buildIndex(fixture("flag"))).functions);
  const cross = groups.find((g) => g.kind === "cross-language");
  assert.ok(cross);
  assert.deepEqual(names(cross), ["_strip_json_state", "stripJsonState"]);
  assert.equal(cross.confidence, "likely", "shared string values make it likely");
});

test("does not flag look-alikes: tiny methods, icons, nested helpers, 2 small copies, one-word names, tests", async () => {
  const groups = findDuplicates((await buildIndex(fixture("no-flag"))).functions);
  assert.deepEqual(groups, []);
});
