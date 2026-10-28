import assert from "node:assert/strict";
import { test } from "node:test";
import { collectFindings } from "../src/findings/collect.ts";
import { markNotUseful } from "../src/findings/feedback.ts";
import { scanRepo } from "../src/scan/scan.ts";
import { makeRepo } from "./helpers.ts";

const catches = (n: number) => Array.from({ length: n }, (_, i) => `export function f${i}() {\n  try { load(); } catch (e) {}\n}\n`).join("");
const empty = async (root: string) => (await collectFindings(await scanRepo(root))).filter((f) => f.rule === "empty-catch");

test("not useful hides that finding; a rule marked too often becomes a hint", async () => {
  const root = await makeRepo({ "index.js": catches(12) });
  const [first, second] = await empty(root);
  await markNotUseful(root, first!);
  let now = await empty(root);
  assert.equal(now.length, 11);
  assert.ok(now.every((f) => f.confidence !== "maybe"), "one click on twelve is under 10%");
  await markNotUseful(root, second!);
  now = await empty(root);
  assert.equal(now.length, 10);
  assert.ok(now.every((f) => f.confidence === "maybe"), "two of twelve is over 10%");
  assert.match(now[0]!.evidence.at(-1)!, /marked 2 of this rule's findings "not useful"/);
});
