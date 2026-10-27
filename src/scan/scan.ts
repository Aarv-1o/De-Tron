import { unsupportedCode } from "../index/files.ts";
import { buildIndex, type RepoIndex } from "../index/repo.ts";
import { extractUsage } from "../index/usage.ts";
import { supportFor } from "../languages/index.ts";
import type { DeadCode } from "../report/deadCode.ts";
import { findDeadFunctions } from "../rules/codebase/deadFunctions.ts";
import { findDifferences, type CopyDifferences } from "../rules/codebase/differences.ts";
import { findDuplicates, type DuplicateGroup } from "../rules/codebase/duplicates.ts";
import { findFunctionShapeIssues } from "../rules/codebase/functionShape.ts";
import { findHotspots, gitHistory, indentComplexity, stringRows, type FileSize, type History, type Hotspot } from "../rules/codebase/hotspots.ts";
import { findUnusedFiles } from "../rules/codebase/unusedFiles.ts";
import { findUnusedPackages } from "../rules/codebase/unusedPackages.ts";
import { findCrossStack, type CrossStack } from "../rules/crossStack/check.ts";
import { htmlCallsIn } from "../rules/crossStack/htmlCalls.ts";
import type { FileApi } from "../rules/crossStack/types.ts";
import { runLineRules, type LineFinding } from "../rules/line/index.ts";

// Every check on one repo, with no printing: the CLI, and later the MCP server and the editor
// extension, all start from this.

export interface ScanResult {
  root: string;
  index: RepoIndex;
  skipped: Map<string, number>; // files in languages Detron doesn't read yet, by extension
  groups: DuplicateGroup[];
  differences: Map<DuplicateGroup, CopyDifferences>;
  dead: DeadCode;
  deadFiles: Set<string>;
  crossStack: CrossStack;
  hygiene: LineFinding[]; // without findings in dead files: the fix there is deleting the file
  history: History;
  hotspots: Hotspot[];
  seconds: number;
}

export async function scanRepo(root: string): Promise<ScanResult> {
  const started = Date.now();
  const hygiene: LineFinding[] = [];
  const apis = new Map<string, FileApi>();
  const sizes = new Map<string, FileSize>();
  const index = await buildIndex(root, {
    onFile: async (parsed, file) => {
      const imports = extractUsage(parsed).imports.map((i) => i.source);
      hygiene.push(...(await runLineRules(parsed, file, imports)));
      apis.set(file, supportFor(parsed.language).extractApi(parsed.tree.rootNode, file));
      // The file as written: an Astro template's nesting is complexity too.
      sizes.set(file, indentComplexity(parsed.original ?? parsed.source, stringRows(parsed.tree.rootNode)));
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
  // Issues inside a file that's dead as a whole are noise: the fix is deleting the file.
  const deadFiles = new Set(dead.files.map((f) => f.file));
  for (const file of deadFiles) {
    apis.delete(file);
    sizes.delete(file);
  }

  const imports = new Map([...index.usage].map(([file, u]) => [file, u.imports]));
  const crossStack = findCrossStack(apis, imports, await htmlCallsIn(root, index.allFiles));
  const history = await gitHistory(root);
  return {
    root, index, skipped: unsupportedCode(index.allFiles), groups, differences, dead, deadFiles, crossStack,
    hygiene: hygiene.filter((f) => !deadFiles.has(f.file)),
    history, hotspots: history.ok ? findHotspots(history.changes, sizes) : [],
    seconds: (Date.now() - started) / 1000,
  };
}
