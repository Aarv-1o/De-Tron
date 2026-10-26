import { join } from "node:path";
import { parseFile } from "../parse/parse.ts";
import { listSourceFiles } from "./files.ts";
import { extractFunctions, type FunctionInfo } from "./functions.ts";

export interface RepoIndex {
  root: string;
  files: string[];
  functions: FunctionInfo[];
  // Files tree-sitter couldn't fully parse. Their results may be incomplete.
  filesWithSyntaxErrors: string[];
}

export async function buildIndex(root: string): Promise<RepoIndex> {
  const files = await listSourceFiles(root);
  const functions: FunctionInfo[] = [];
  const filesWithSyntaxErrors: string[] = [];

  for (const file of files) {
    const parsed = await parseFile(join(root, file));
    if (!parsed) continue;
    try {
      if (parsed.tree.rootNode.hasError) filesWithSyntaxErrors.push(file);
      functions.push(...extractFunctions(parsed, file));
    } finally {
      parsed.tree.delete();
    }
  }
  return { root, files, functions, filesWithSyntaxErrors };
}
