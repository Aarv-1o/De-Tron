import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { buildIndex } from "../src/index/repo.ts";
import { formatDuplicates } from "../src/report/duplicates.ts";
import { findDifferences, normalizeLine } from "../src/rules/codebase/differences.ts";
import { findDuplicates } from "../src/rules/codebase/duplicates.ts";

const flagRepo = fileURLToPath(new URL("fixtures/duplicates/flag", import.meta.url));

test("normalizeLine: names don't matter, values do", () => {
  assert.equal(normalizeLine("if (mins < 1) return 'Just now';"), normalizeLine('if (m < 1) return "Just now";'));
  assert.notEqual(normalizeLine('if (s < 45) return "just now";'), normalizeLine('if (mins < 1) return "Just now";'));
  assert.equal(normalizeLine("return `${mins}m ago`;"), normalizeLine("return `${m}m ago`;"));
});

test("drifted copy: shows the lines that changed, against the most common version", async () => {
  const groups = findDuplicates((await buildIndex(flagRepo)).functions);
  const drifted = groups.find((g) => g.kind === "similar")!;
  const diff = await findDifferences(flagRepo, drifted);
  assert.ok(diff);
  assert.notEqual(diff.base.name, "relativeTime", "the base is a version that has a twin");
  assert.deepEqual(diff.copies.map((c) => c.fn.name), ["relativeTime"]);
  const changed = diff.copies[0]!.changes.map((c) => [c.base?.text.trim(), c.copy?.text.trim()]);
  assert.ok(changed.some(([b, c]) => b?.includes("Just now") && c?.includes('"just now"')));
  assert.ok(changed.some(([b, c]) => b?.includes("m ago") && c?.includes(" min ago")));
});

test("exact copies and cross-language copies aren't compared line by line", async () => {
  const groups = findDuplicates((await buildIndex(flagRepo)).functions);
  for (const g of groups.filter((g) => g.kind !== "similar")) assert.equal(await findDifferences(flagRepo, g), undefined);
});

test("report shows what differs, value changes first", async () => {
  const groups = findDuplicates((await buildIndex(flagRepo)).functions);
  const differences = new Map();
  for (const g of groups) {
    const d = await findDifferences(flagRepo, g);
    if (d) differences.set(g, d);
  }
  const text = formatDuplicates(groups, false, differences);
  assert.match(text, /What differs from web\/(time\.ts:1 timeAgo|Page\.tsx:2 fileTimeAgo):/);
  assert.match(text, /web\/chat\.js:2 relativeTime\n +\d+: if \(mins < 1\) return "just now";\n +instead of: if \(\w+ < 1\) return ['"]Just now['"];/);
  assert.match(text, /Identical apart from names\./);
});
