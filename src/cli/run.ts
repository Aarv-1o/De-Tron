import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { unsupportedCode } from "../index/files.ts";
import { buildIndex } from "../index/repo.ts";
import { extractUsage } from "../index/usage.ts";
import { supportFor } from "../languages/index.ts";
import { crossStackToJson, formatCrossStack } from "../report/crossStack.ts";
import { deadCodeToJson, formatDeadCode, type DeadCode } from "../report/deadCode.ts";
import { duplicatesToJson, formatDuplicates } from "../report/duplicates.ts";
import { formatHygiene } from "../report/hygiene.ts";
import { findDeadFunctions } from "../rules/codebase/deadFunctions.ts";
import { findDifferences, type CopyDifferences } from "../rules/codebase/differences.ts";
import { findDuplicates, type DuplicateGroup } from "../rules/codebase/duplicates.ts";
import { findFunctionShapeIssues } from "../rules/codebase/functionShape.ts";
import { findUnusedFiles } from "../rules/codebase/unusedFiles.ts";
import { findUnusedPackages } from "../rules/codebase/unusedPackages.ts";
import { findCrossStack } from "../rules/crossStack/check.ts";
import { htmlCallsIn } from "../rules/crossStack/htmlCalls.ts";
import type { FileApi } from "../rules/crossStack/types.ts";
import { runLineRules, type LineFinding } from "../rules/line/index.ts";

const HELP = `Detron: stops AI coding agents from making a mess of your codebase.

Usage:
  detron scan [path]    Find copied code, dead code, frontend/backend mismatches and
                        code hygiene issues in a repo
                        (default: current folder)

Options:
  --all                 Also show hints (less certain findings)
  --json                Machine-readable output, for agents and scripts
  -h, --help            Show this help
`;

type Write = (text: string) => void;

async function isFolder(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false; // stat fails when the path doesn't exist: that's the answer, not an error
  }
}

async function scan(path: string, all: boolean, json: boolean, out: Write): Promise<number> {
  const root = resolve(path);
  if (!(await isFolder(root))) {
    out(`Can't scan "${path}": that folder doesn't exist.\n`);
    return 2;
  }
  const started = Date.now();
  const hygiene: LineFinding[] = [];
  const apis = new Map<string, FileApi>();
  const index = await buildIndex(root, {
    onFile: async (parsed, file) => {
      const imports = extractUsage(parsed).imports.map((i) => i.source);
      hygiene.push(...(await runLineRules(parsed, file, imports)));
      apis.set(file, supportFor(parsed.language).extractApi(parsed.tree.rootNode, file));
    },
  });
  hygiene.push(...findFunctionShapeIssues(index.functions));
  const groups = findDuplicates(index.functions);
  const differences = new Map<DuplicateGroup, CopyDifferences>();
  for (const group of groups) {
    const diff = await findDifferences(root, group);
    if (!diff) continue;
    differences.set(group, diff);
    // Similar structure and shared wording, but most lines differ: a hint, not a copy.
    if (diff.mostlyDifferent) group.confidence = "maybe";
  }
  const dead: DeadCode = {
    packages: await findUnusedPackages(index),
    files: await findUnusedFiles(index),
    functions: await findDeadFunctions(index),
  };

  const skipped = unsupportedCode(index.allFiles);

  // Issues inside a file that's dead as a whole are noise: the fix is deleting the file.
  const deadFiles = new Set(dead.files.map((f) => f.file));
  const liveHygiene = hygiene.filter((f) => !deadFiles.has(f.file));
  for (const file of deadFiles) apis.delete(file);
  const imports = new Map([...index.usage].map(([file, u]) => [file, u.imports]));
  const crossStack = findCrossStack(apis, imports, await htmlCallsIn(root, index.allFiles));

  if (json) {
    const report = {
      root, files: index.files.length, functions: index.functions.length,
      skippedFiles: Object.fromEntries(skipped),
      filesWithSyntaxErrors: index.filesWithSyntaxErrors,
      duplicates: duplicatesToJson(groups, differences), deadCode: deadCodeToJson(dead),
      crossStack: crossStackToJson(crossStack), hygiene: liveHygiene,
    };
    out(`${JSON.stringify(report, null, 2)}\n`);
    return 0;
  }
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  out(`Detron scan: ${root}\n${index.files.length} files, ${index.functions.length} functions, ${seconds}s\n`);
  if (skipped.size) {
    const list = [...skipped].map(([ext, n]) => `${n} .${ext}`).join(", ");
    const total = [...skipped.values()].reduce((a, b) => a + b, 0);
    out(`Not checked: ${list} file${total > 1 ? "s" : ""} (not supported yet). Results only cover the files above.\n`);
  }
  out("\n");
  out(formatDuplicates(groups, all, differences, deadFiles));
  out(`\n${formatDeadCode(dead, all)}`);
  out(`\n${formatCrossStack(crossStack, all)}`);
  out(`\n${formatHygiene(liveHygiene, all)}`);
  if (index.filesWithSyntaxErrors.length) {
    out(`\nNote: ${index.filesWithSyntaxErrors.length} file(s) have syntax Detron couldn't fully read, so results there may be incomplete:\n`);
    for (const f of index.filesWithSyntaxErrors) out(`  ${f}\n`);
  }
  return 0;
}

// Returns the exit code: 0 ok, 2 bad input.
export async function run(argv: string[], out: Write): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: { all: { type: "boolean" }, json: { type: "boolean" }, help: { type: "boolean", short: "h" } },
    });
  } catch (error) {
    out(`${(error as Error).message}\n\n${HELP}`);
    return 2;
  }
  const { values, positionals } = parsed;
  const [command, path = ".", ...extra] = positionals;
  if (values.help || !command) {
    out(HELP);
    return values.help ? 0 : 2;
  }
  if (command === "scan" && extra.length === 1 && ["all", "json"].includes(extra[0]!)) {
    out(`Did you mean --${extra[0]}? Options start with two dashes.\n`);
    return 2;
  }
  if (command !== "scan" || extra.length) {
    out(`Unknown command: ${positionals.join(" ")}\n\n${HELP}`);
    return 2;
  }
  return scan(path, values.all ?? false, values.json ?? false, out);
}
