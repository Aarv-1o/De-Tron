import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { collectFindings } from "../findings/collect.ts";
import { formatAgent } from "../report/agent.ts";
import { formatForAgent, formatForPerson } from "../report/brief.ts";
import { explainFindings, findingsOn } from "../report/explain.ts";
import { changedLines, isInChanges } from "../scan/changes.ts";
import { formatScan, scanToJson } from "../report/scan.ts";
import { runLanguageServer } from "../lsp/server.ts";
import { scanRepo } from "../scan/scan.ts";

const HELP = `Detron: stops AI coding agents from making a mess of your codebase.

Usage:
  detron scan [path]          Find security holes, crash risks, frontend/backend mismatches,
                              database issues, copied and dead code in a repo, and where
                              to clean first (default: current folder)
  detron lsp                  Run as a language server, for editors (VS Code, Cursor,
                              Windsurf, Antigravity, JetBrains, Zed, Neovim)
  detron explain <file:line>  Everything about the findings on one line: what the code
                              does, why it matters, how to fix it, how to check

Options:
  --changed             Only findings in your changes: this branch since it left main,
                        or uncommitted work on main
  --base <ref>          With --changed: compare with this branch or commit instead
  --brief               One line per finding, errors and warnings only (for agents)
  --all                 Also show hints (less certain findings)
  --agent               Findings as steps an AI agent can follow: what, why, how to fix,
                        whether it's safe, how to check
  --json                The same findings, machine-readable
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

type Format = "text" | "agent" | "json" | "brief";
interface ScanOptions { all: boolean; format: Format; changed: boolean; base: string | undefined }

async function scan(path: string, { all, format, changed, base }: ScanOptions, out: Write): Promise<number> {
  const root = resolve(path);
  if (!(await isFolder(root))) {
    out(`Can't scan "${path}": that folder doesn't exist.\n`);
    return 2;
  }
  const result = await scanRepo(root);
  if (format === "text" && !changed) {
    out(formatScan(result, all));
    return 0;
  }
  let findings = await collectFindings(result);
  let older = 0;
  if (changed) {
    const changes = await changedLines(root, base);
    if (!changes.ok) out(`Showing everything: can't tell what changed (${changes.reason}).\n\n`);
    const mine = findings.filter((f) => isInChanges(f, changes));
    older = findings.length - mine.length;
    findings = mine;
  }
  const shown = all ? findings : findings.filter((f) => f.confidence !== "maybe");
  if (format === "brief") out(formatForAgent(shown, `detron scan${changed ? " --changed" : ""} --agent`));
  else if (format === "text") out(formatForPerson(shown, older));
  else if (format === "agent") out(formatAgent(root, findings, all));
  else out(`${JSON.stringify(scanToJson(result, findings), null, 2)}\n`);
  return 0;
}

// detron explain src/routes/orders.js:9
async function explain(target: string, out: Write): Promise<number> {
  const m = /^(.+):(\d+)$/.exec(target);
  if (!m) {
    out(`Give a file and line, like src/app.ts:42.\n`);
    return 2;
  }
  const [file, line] = [m[1]!.replace(/\\/g, "/").replace(/^\.\//, ""), Number(m[2])];
  const root = resolve(".");
  const here = findingsOn(await collectFindings(await scanRepo(root)), file, line);
  out(here.length ? explainFindings(root, here) : `No findings on ${file}:${line}.\n`);
  return 0;
}

// Returns the exit code: 0 ok, 2 bad input.
export async function run(argv: string[], out: Write): Promise<number> {
  // Editors add their own flags (--stdio, --clientProcessId=123): the server reads what it
  // needs, and nothing may be printed, since stdout is the editor's channel.
  if (argv[0] === "lsp") {
    runLanguageServer(); // keeps running until the editor closes it
    return 0;
  }
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        all: { type: "boolean" }, agent: { type: "boolean" }, json: { type: "boolean" }, brief: { type: "boolean" },
        changed: { type: "boolean" }, base: { type: "string" }, help: { type: "boolean", short: "h" },
      },
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
  if (command === "explain" && !extra.length) return explain(path, out);
  if (command === "scan" && extra.length === 1 && ["all", "agent", "json", "brief", "changed"].includes(extra[0]!)) {
    out(`Did you mean --${extra[0]}? Options start with two dashes.\n`);
    return 2;
  }
  if (command !== "scan" || extra.length) {
    out(`Unknown command: ${positionals.join(" ")}\n\n${HELP}`);
    return 2;
  }
  const format: Format = values.json ? "json" : values.agent ? "agent" : values.brief ? "brief" : "text";
  return scan(path, { all: values.all ?? false, format, changed: values.changed ?? !!values.base, base: values.base }, out);
}
