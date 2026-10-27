import type { Node } from "web-tree-sitter";
import type { FunctionInfo } from "../index/functions.ts";
import type { ImportInfo } from "../index/usage.ts";

export type LanguageId = "javascript" | "typescript" | "tsx" | "python";

// Everything Detron needs to know about one language family. Adding a language
// (Java, Go, Astro...) means writing one of these and registering it in index.ts.
export interface LanguageSupport {
  family: string; // dialects that share code rules, e.g. JS, TS and TSX are all "js"
  label: string; // for people: "JS/TS", "Python"
  grammars: Record<string, { id: LanguageId; wasm: string }>; // by file extension
  extractFunctions(root: Node, file: string, id: LanguageId): FunctionInfo[];
  extractImports(root: Node): ImportInfo[];
  // The module names an import can point at: "./util.js" -> ["util"], "agents.planner" -> ["planner"].
  importedModules(imp: ImportInfo): string[];
  // Files that run on their own: "app" (a web server: never unused) or "script" (maybe a leftover).
  entryKind(text: string): "app" | "script" | undefined;
  unusedExportReason: string; // what "exported but unused" means in this language
}
