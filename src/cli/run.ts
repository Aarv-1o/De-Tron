import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { buildIndex } from "../index/repo.ts";
import { duplicatesToJson, formatDuplicates } from "../report/duplicates.ts";
import { findDuplicates } from "../rules/codebase/duplicates.ts";

const HELP = `Detron: stops AI coding agents from making a mess of your codebase.

Usage:
  detron scan [path]    Find copied code in a repo (default: current folder)

Options:
  --all                 Also show hints (same structure, different values)
  --json                Machine-readable output, for agents and scripts
  -h, --help            Show this help
`;

type Write = (text: string) => void;

async function isFolder(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function scan(path: string, all: boolean, json: boolean, out: Write): Promise<number> {
  const root = resolve(path);
  if (!(await isFolder(root))) {
    out(`Can't scan "${path}": that folder doesn't exist.\n`);
    return 2;
  }
  const started = Date.now();
  const index = await buildIndex(root);
  const groups = findDuplicates(index.functions);

  if (json) {
    out(`${JSON.stringify({ root, files: index.files.length, functions: index.functions.length, filesWithSyntaxErrors: index.filesWithSyntaxErrors, duplicates: duplicatesToJson(groups) }, null, 2)}\n`);
    return 0;
  }
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  out(`Detron scan: ${root}\n${index.files.length} files, ${index.functions.length} functions, ${seconds}s\n\n`);
  out(formatDuplicates(groups, all));
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
  if (command !== "scan" || extra.length) {
    out(`Unknown command: ${positionals.join(" ")}\n\n${HELP}`);
    return 2;
  }
  return scan(path, values.all ?? false, values.json ?? false, out);
}
