import assert from "node:assert/strict";
import { test } from "node:test";
import { fakeFunction } from "./helpers.ts";
import { deadCodeToJson, formatDeadCode, type DeadCode } from "../src/report/deadCode.ts";

const fn = (name: string, file: string) => fakeFunction({ name, file, exported: true });

const found: DeadCode = {
  packages: [
    { name: "three", manifest: "package.json", dev: false, confidence: "sure", sizeBytes: 36_500_000 },
    { name: "left-pad", manifest: "web/package.json", dev: true, confidence: "likely", sizeBytes: undefined },
  ],
  files: [
    { file: "old.py", lines: 120, confidence: "likely", reason: "Nothing imports or mentions this file." },
    { file: "try.py", lines: 40, confidence: "maybe", reason: "A runnable script nothing refers to. Still needed?" },
  ],
  functions: [
    { fn: fn("stopScheduler", "scheduler.js"), confidence: "likely", reason: "Exported, but nothing uses it." },
    { fn: fn("helper", "old.py"), confidence: "sure", reason: "Nothing uses it." },
  ],
};

test("dead code report: sizes, uninstall commands, safe-to-remove marks", () => {
  const text = formatDeadCode(found, false);
  assert.match(text, /Unused packages \(2, 36\.5 MB\)/);
  assert.match(text, /three +36\.5 MB {2}package\.json {2}\(safe to remove\)/);
  assert.match(text, /left-pad .*dev, web\/package\.json$/m);
  assert.match(text, /→ npm uninstall three/);
  assert.match(text, /→ In web: npm uninstall left-pad/);
  assert.match(text, /scheduler\.js:3 {2}stopScheduler {2}Exported, but nothing uses it\./);
});

test("dead code report: hides hints, and doesn't repeat functions from dead files", () => {
  const text = formatDeadCode(found, false);
  assert.doesNotMatch(text, /try\.py/);
  assert.match(text, /1 more hint hidden/);
  assert.doesNotMatch(text, /helper/);
  assert.match(formatDeadCode(found, true), /try\.py/);
});

test("dead code report: empty, and JSON", () => {
  assert.equal(formatDeadCode({ packages: [], files: [], functions: [] }, false), "No dead code found.\n");
  assert.deepEqual(Object.keys(deadCodeToJson(found).functions[0]!).sort(), ["confidence", "endLine", "file", "name", "reason", "startLine"]);
});
