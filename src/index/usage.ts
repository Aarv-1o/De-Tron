import type { Node } from "web-tree-sitter";
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

function* walk(node: Node): Generator<Node> {
  yield node;
  for (const child of node.namedChildren) yield* walk(child);
}

// The text inside a string literal node: 'x', "x" and `x` all give x.
const unquote = (node: Node) => node.text.replace(/^['"`]|['"`]$/g, "");

function jsImports(root: Node): ImportInfo[] {
  const found: ImportInfo[] = [];
  for (const node of walk(root)) {
    const line = node.startPosition.row + 1;
    if (node.type === "import_statement" || (node.type === "export_statement" && node.childForFieldName("source"))) {
      const source = node.childForFieldName("source");
      if (!source) continue;
      const names = [...walk(node)]
        .filter((n) => n.type === "import_specifier" || n.type === "export_specifier")
        .map((n) => n.childForFieldName("name")?.text ?? n.text);
      found.push({ source: unquote(source), names, line });
    } else if (node.type === "call_expression") {
      // require("x"), require.resolve("x") and dynamic import("x")
      const fn = node.childForFieldName("function")?.text;
      const arg = node.childForFieldName("arguments")?.namedChildren[0];
      if ((fn === "require" || fn === "import" || fn === "require.resolve") && arg?.type === "string") {
        found.push({ source: unquote(arg), names: [], line });
      }
    }
  }
  return found;
}

function pyImports(root: Node): ImportInfo[] {
  const found: ImportInfo[] = [];
  for (const node of walk(root)) {
    const line = node.startPosition.row + 1;
    if (node.type === "import_statement") {
      // import a.b, c as d
      for (const child of node.namedChildren) {
        const name = child.type === "aliased_import" ? child.childForFieldName("name") : child;
        if (name) found.push({ source: name.text, names: [], line });
      }
    } else if (node.type === "import_from_statement") {
      // from .x import a, b as c
      const module = node.childForFieldName("module_name");
      if (!module) continue;
      const names = node.childrenForFieldName("name").map((n) =>
        (n.type === "aliased_import" ? n.childForFieldName("name") ?? n : n).text,
      );
      found.push({ source: module.text, names, line });
    }
  }
  return found;
}

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
  return { imports: parsed.language === "python" ? pyImports(root) : jsImports(root), names };
}
