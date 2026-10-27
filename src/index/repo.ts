import { join } from "node:path";
import { parseFile } from "../parse/parse.ts";
import { isSource, listRepoFiles } from "./files.ts";
import { extractFunctions, type FunctionInfo } from "./functions.ts";
import { extractUsage, type FileUsage } from "./usage.ts";

export interface RepoIndex {
  root: string;
  allFiles: string[]; // including configs, styles, docs: for finding references outside code
  files: string[]; // source files Detron parses
  functions: FunctionInfo[];
  usage: Map<string, FileUsage>; // per file: what it imports and which names it uses
  // Files tree-sitter couldn't fully parse. Their results may be incomplete.
  filesWithSyntaxErrors: string[];
}

export async function buildIndex(root: string): Promise<RepoIndex> {
  const allFiles = await listRepoFiles(root);
  const files = allFiles.filter(isSource);
  const functions: FunctionInfo[] = [];
  const usage = new Map<string, FileUsage>();
  const filesWithSyntaxErrors: string[] = [];

  for (const file of files) {
    const parsed = await parseFile(join(root, file));
    if (!parsed) continue;
    try {
      if (parsed.tree.rootNode.hasError) filesWithSyntaxErrors.push(file);
      functions.push(...extractFunctions(parsed, file));
      usage.set(file, extractUsage(parsed));
    } finally {
      parsed.tree.delete();
    }
  }
  return { root, allFiles, files, functions, usage, filesWithSyntaxErrors };
}
