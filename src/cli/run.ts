import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { formatScan, scanToJson } from "../report/scan.ts";
import { scanRepo } from "../scan/scan.ts";

const HELP = `Detron: stops AI coding agents from making a mess of your codebase.

Usage:
  detron scan [path]    Find copied code, dead code, frontend/backend mismatches and
                        code hygiene issues in a repo, and where to clean first
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
  const result = await scanRepo(root);
  out(json ? `${JSON.stringify(scanToJson(result), null, 2)}\n` : formatScan(result, all));
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
