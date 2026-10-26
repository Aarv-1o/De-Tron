import type { Node } from "web-tree-sitter";
import type { LanguageId, ParsedFile } from "../parse/parse.ts";

export interface FunctionInfo {
  name: string;
  file: string;
  language: LanguageId;
  startLine: number; // 1-based
  endLine: number;
  params: string[]; // names, or the raw text for destructured params
  className: string | undefined;
  exported: boolean; // JS/TS: exported from the module. Python: public top-level name.
  async: boolean;
}

const JS_FUNCTIONS = new Set([
  "function_declaration", "generator_function_declaration", "function_expression",
  "arrow_function", "method_definition",
]);

function* descendants(node: Node): Generator<Node> {
  for (const child of node.namedChildren) {
    yield child;
    yield* descendants(child);
  }
}

// Anonymous callbacks return undefined: they can't be reused by name.
function jsName(node: Node): string | undefined {
  const own = node.childForFieldName("name");
  if (own) return own.text;
  const parent = node.parent;
  if (parent?.type === "variable_declarator") return parent.childForFieldName("name")?.text;
  if (parent?.type === "pair") return parent.childForFieldName("key")?.text;
  return undefined;
}

function jsParams(node: Node): string[] {
  const params = node.childForFieldName("parameters") ?? node.childForFieldName("parameter");
  if (!params) return [];
  if (params.type === "identifier") return [params.text];
  return params.namedChildren
    .filter((p) => p.type !== "comment")
    .map((p) => (p.childForFieldName("pattern") ?? p.childForFieldName("left") ?? p).text);
}

function pyParams(node: Node): string[] {
  const params = node.childForFieldName("parameters");
  if (!params) return [];
  // keyword_separator is the bare `*`, positional_separator the bare `/`: markers, not params.
  return params.namedChildren
    .filter((p) => !["comment", "keyword_separator", "positional_separator"].includes(p.type))
    .map((p) => {
      if (p.type === "identifier" || p.type.endsWith("splat_pattern")) return p.text; // keeps *args, **kwargs
      return (p.childForFieldName("name") ?? p.namedChildren[0] ?? p).text;
    });
}

function enclosingClass(node: Node, classType: string): string | undefined {
  for (let p = node.parent; p; p = p.parent) {
    if (p.type === classType) return p.childForFieldName("name")?.text;
  }
  return undefined;
}

// Names exported via `export { a, b }`, `export default a`, `module.exports = { a }` or `exports.a = ...`.
function jsExportedNames(root: Node): Set<string> {
  const names = new Set<string>();
  for (const node of descendants(root)) {
    if (node.type === "export_specifier") {
      names.add(node.childForFieldName("name")?.text ?? node.text);
    } else if (node.type === "export_statement") {
      const value = node.childForFieldName("value");
      if (value?.type === "identifier") names.add(value.text);
    } else if (node.type === "assignment_expression") {
      const left = node.childForFieldName("left")?.text ?? "";
      const right = node.childForFieldName("right");
      if (left === "module.exports" && right?.type === "object") {
        for (const prop of right.namedChildren) {
          const key = prop.type === "shorthand_property_identifier" ? prop : prop.childForFieldName("key");
          if (key) names.add(key.text);
        }
      } else if (left === "module.exports" && right?.type === "identifier") {
        names.add(right.text);
      } else {
        const m = /^(?:module\.)?exports\.(\w+)$/.exec(left);
        if (m?.[1]) names.add(m[1]);
      }
    }
  }
  return names;
}

function hasExportAncestor(node: Node): boolean {
  for (let p = node.parent, depth = 0; p && depth < 4; p = p.parent, depth++) {
    if (p.type === "export_statement") return true;
  }
  return false;
}

export function extractFunctions(parsed: ParsedFile, file: string): FunctionInfo[] {
  const root = parsed.tree.rootNode;
  const isPython = parsed.language === "python";
  const exportedNames = isPython ? new Set<string>() : jsExportedNames(root);
  const found: FunctionInfo[] = [];

  for (const node of descendants(root)) {
    const isFunction = isPython ? node.type === "function_definition" : JS_FUNCTIONS.has(node.type);
    if (!isFunction) continue;
    const name = isPython ? node.childForFieldName("name")?.text : jsName(node);
    if (!name) continue;

    const className = enclosingClass(node, isPython ? "class_definition" : "class_declaration");
    // Compare by type: web-tree-sitter hands out a new Node object on every access.
    const holder = node.parent?.type === "decorated_definition" ? node.parent.parent : node.parent;
    const topLevel = holder?.type === "module";

    found.push({
      name,
      file,
      language: parsed.language,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      params: isPython ? pyParams(node) : jsParams(node),
      className,
      exported: isPython
        ? topLevel && !name.startsWith("_")
        : !className && (hasExportAncestor(node) || exportedNames.has(name)),
      async: node.children.some((c) => c.type === "async"),
    });
  }
  return found;
}
