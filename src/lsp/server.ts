import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createConnection, ProposedFeatures, TextDocumentSyncKind, type Connection } from "vscode-languageserver/node";
import { collectFindings } from "../findings/collect.ts";
import { markNotUseful } from "../findings/feedback.ts";
import { PARTS, partOf, severityOf, type Part } from "../findings/severity.ts";
import type { Finding } from "../findings/types.ts";
import { formatAgent } from "../report/agent.ts";
import { formatForPerson } from "../report/brief.ts";
import { explainFindings, findingsOn } from "../report/explain.ts";
import { changedLines, isInChanges, type Changes } from "../scan/changes.ts";
import type { FileCache } from "../index/fileScan.ts";
import { scanRepo } from "../scan/scan.ts";
import { codeActions, diagnosticsByFile, hotspotLens, hoverCard, uriOf } from "./convert.ts";

// `detron lsp`: Detron as a language server, so every editor that speaks LSP (VS Code, Cursor,
// Windsurf, Antigravity, JetBrains, Zed, Neovim) shows findings where the code is. One full
// scan when the folder opens, then again after each save.

export interface Options {
  show: "changes" | "all"; // "changes": only what this branch or uncommitted work added
  hints: boolean;
  clientCommands: boolean; // the Detron extension handles detron.copyFix
}

export interface Status {
  scanning: boolean;
  show: Options["show"];
  counts: Record<Part, number>;
  older: number; // findings left out because they're from before your changes
  error?: string;
}

const SAVE_DELAY_MS = 400; // several files saved at once: one scan

async function readOrEmpty(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return ""; // deleted since the scan: its squiggles go at the top until the next scan clears them
  }
}

export function startServer(connection: Connection): void {
  let root = "";
  let rootUri = "";
  let options: Options = { show: "changes", hints: false, clientCommands: false };
  let all: Finding[] = [];
  const files: FileCache = new Map(); // in memory only: each save re-reads just the changed files
  let changes: Changes = { ok: false, reason: "not scanned yet" };
  let published = new Set<string>();
  let texts = new Map<string, string[]>();
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<void> | undefined;
  let again = false;

  const shown = () => all.filter((f) => (options.hints || f.confidence !== "maybe") && (options.show === "all" || isInChanges(f, changes)));
  // Findings left out because they're from before your changes.
  const older = () => (options.show === "changes" ? all.filter((f) => !isInChanges(f, changes)).length : 0);
  const fileOf = (uri: string) => relative(root, fileURLToPath(uri)).replace(/\\/g, "/");
  const linesOf = (file: string) => texts.get(file) ?? [];

  function status(scanning: boolean, error?: string): void {
    const now = shown().filter((f) => severityOf(f) !== "hint" && f.rule !== "hotspot");
    const counts = Object.fromEntries(PARTS.map((p) => [p, now.filter((f) => partOf(f) === p).length])) as Record<Part, number>;
    void connection.sendNotification("detron/status", { scanning, show: options.show, counts, older: older(), ...(error ? { error } : {}) } satisfies Status);
  }

  async function publish(): Promise<void> {
    const list = shown();
    const files = [...new Set(list.map((f) => f.file))];
    texts = new Map(await Promise.all(files.map(async (f) => [f, (await readOrEmpty(join(root, f))).split("\n")] as const)));
    const byFile = diagnosticsByFile(rootUri, list, linesOf);
    const now = new Set<string>();
    for (const [file, diagnostics] of byFile) {
      const uri = uriOf(rootUri, file);
      now.add(uri);
      await connection.sendDiagnostics({ uri, diagnostics });
    }
    for (const uri of published) if (!now.has(uri)) await connection.sendDiagnostics({ uri, diagnostics: [] });
    published = now;
    status(false);
  }

  async function scan(): Promise<void> {
    status(true);
    try {
      all = await collectFindings(await scanRepo(root, files));
      changes = await changedLines(root);
      await publish();
    } catch (error) {
      connection.console.error(`Detron scan failed: ${(error as Error).stack ?? error}`);
      status(false, (error as Error).message);
    }
  }

  // One scan at a time; a save during a scan runs one more after it.
  function rescan(): Promise<void> {
    if (running) {
      again = true;
      return running;
    }
    running = scan().finally(() => {
      running = undefined;
      if (again) {
        again = false;
        void rescan();
      }
    });
    return running;
  }

  connection.onInitialize((params) => {
    const folder = params.workspaceFolders?.[0]?.uri ?? params.rootUri;
    root = folder ? fileURLToPath(folder) : process.cwd();
    rootUri = folder ?? pathToFileURL(root).href;
    options = { ...options, ...(params.initializationOptions as Partial<Options> | undefined) };
    return {
      capabilities: {
        textDocumentSync: { openClose: true, save: true, change: TextDocumentSyncKind.None },
        hoverProvider: true,
        codeActionProvider: true,
        codeLensProvider: {},
        // "detron.server.*": the editor's language client registers each of these as an editor
        // command, so they mustn't share names with the extension's own detron.* commands.
        executeCommandProvider: { commands: ["detron.server.notUseful", "detron.server.toggleShow", "detron.server.toggleHints", "detron.server.rescan"] },
      },
      serverInfo: { name: "detron" },
    };
  });
  connection.onInitialized(() => void rescan());
  connection.onDidSaveTextDocument(() => {
    clearTimeout(timer);
    timer = setTimeout(() => void rescan(), SAVE_DELAY_MS);
  });

  connection.onHover(({ textDocument, position }) => {
    const here = findingsOn(shown(), fileOf(textDocument.uri), position.line + 1).filter((f) => f.rule !== "hotspot");
    return here.length ? { contents: hoverCard(here) } : null;
  });
  connection.onCodeAction(({ textDocument, range }) => {
    const file = fileOf(textDocument.uri);
    const here = shown().filter((f) => f.file === file && f.rule !== "hotspot" && f.line - 1 <= range.end.line && range.start.line <= (f.endLine ?? f.line) - 1);
    return codeActions(textDocument.uri, here, linesOf(file), { clientCommands: options.clientCommands, explain: (f) => explainFindings(root, [f]) });
  });
  connection.onCodeLens(({ textDocument }) => shown().filter((f) => f.rule === "hotspot" && f.file === fileOf(textDocument.uri)).map(hotspotLens));
  connection.onExecuteCommand(async ({ command, arguments: args }) => {
    if (command === "detron.server.notUseful") {
      const [id, rule] = args as [string, string];
      await markNotUseful(root, { id, rule });
      all = all.filter((f) => f.id !== id);
      return rescan();
    }
    if (command === "detron.server.toggleShow") {
      options.show = options.show === "changes" ? "all" : "changes";
      return publish();
    }
    if (command === "detron.server.toggleHints") {
      options.hints = !options.hints;
      return publish();
    }
    if (command === "detron.server.rescan") return rescan();
    return undefined;
  });

  // For the editor's sidebar: the list, a whole report, one finding's full explanation.
  connection.onRequest("detron/findings", () => ({
    show: options.show, hints: options.hints, older: older(),
    // Why "your changes" is everything, if it is: "not a git repo", "no commits yet".
    ...(changes.ok ? {} : { noChanges: changes.reason }),
    items: shown().map((f) => ({ id: f.id, rule: f.rule, part: partOf(f), severity: severityOf(f), file: f.file, line: f.line, title: f.title, why: f.why, does: f.plain?.does, replacedBy: f.plain?.replacedBy })),
  }));
  connection.onRequest("detron/report", ({ format }: { format: "agent" | "person" }) =>
    format === "agent" ? formatAgent(root, shown(), options.hints) : formatForPerson(shown(), older()));
  connection.onRequest("detron/explain", ({ id }: { id: string }) => {
    const f = all.find((x) => x.id === id);
    return f ? explainFindings(root, [f]) : "";
  });
  connection.listen();
}

export function runLanguageServer(): void {
  startServer(createConnection(ProposedFeatures.all, process.stdin, process.stdout));
}
