import { supportFor, type LanguageId } from "../languages/index.ts";
import type { ParsedFile } from "../parse/parse.ts";

export interface FunctionInfo {
  name: string;
  file: string;
  language: LanguageId;
  startLine: number; // 1-based
  endLine: number;
  params: string[]; // names, or the raw text for destructured params
  className: string | undefined;
  // How it gets called: "method" (class), "property" (object key, e.g. { handler() {} }), or "function".
  kind: "function" | "method" | "property";
  decorated: boolean; // Python decorators: often registers it with a framework (routes, fixtures)
  defaultExport: boolean;
  exported: boolean; // JS/TS: exported from the module. Python: public top-level name.
  async: boolean;
  nesting: number; // deepest if/for/while/try nesting inside it
  unusedParams: string[]; // simple params its body never mentions
  passedAsValue: boolean; // its name is passed around in its file (a callback, a route handler), not only called
  shape: string[]; // see shapeOf: used to spot copies
}

export function extractFunctions(parsed: ParsedFile, file: string): FunctionInfo[] {
  return supportFor(parsed.language).extractFunctions(parsed.tree.rootNode, file, parsed.language);
}
