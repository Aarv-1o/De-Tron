import type { Node } from "web-tree-sitter";
import { supportFor } from "../languages/index.ts";
import type { ParsedFile } from "../parse/parse.ts";

export interface ImportInfo {
  source: string; // "react", "./utils", "agents.planner", ".planner"
  names: string[]; // what was imported by name; empty for `import x` / side-effect imports
  line: number;
}

export interface FileUsage {
  imports: ImportInfo[];
  names: Map<string, number>; // every identifier in the file, with how often it appears
}

const NAME_TYPES = new Set([
  "identifier", "property_identifier", "shorthand_property_identifier",
  "shorthand_property_identifier_pattern", "type_identifier",
]);

// The value in `module.exports = ...` or `exports.x = ...`.
function commonJsExport(node: Node): Node | undefined {
  if (node.type !== "assignment_expression") return undefined;
  const left = node.childForFieldName("left")?.text ?? "";
  return /^(module\.)?exports(\.|$)/.test(left) ? (node.childForFieldName("right") ?? undefined) : undefined;
}

export function extractUsage(parsed: ParsedFile): FileUsage {
  const root = parsed.tree.rootNode;
  const names = new Map<string, number>();
  const count = (node: Node): void => {
    if (node.type === "export_clause") return; // `export { a, b }` lists names, it doesn't use them
    const exported = commonJsExport(node);
    if (exported) return countExported(exported);
    if (NAME_TYPES.has(node.type)) names.set(node.text, (names.get(node.text) ?? 0) + 1);
    for (const child of node.namedChildren) count(child);
  };
  // Same for CommonJS: skip bare names (`= a`, `= { a, b: c }`), but count what's inside real code.
  const countExported = (value: Node): void => {
    if (value.type === "identifier") return;
    if (value.type !== "object") return count(value);
    for (const prop of value.namedChildren) {
      if (prop.type === "shorthand_property_identifier") continue;
      const v = prop.type === "pair" ? prop.childForFieldName("value") : prop;
      if (v && v.type !== "identifier") count(v);
    }
  };
  count(root);
  return { imports: supportFor(parsed.language).extractImports(root), names };
}
