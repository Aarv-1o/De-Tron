import { posix } from "node:path";
import type { Node } from "web-tree-sitter";
import type { FunctionInfo } from "../index/functions.ts";
import type { ImportInfo } from "../index/usage.ts";
import { commonInfo, descendants, enclosingClass, unquote } from "./nodes.ts";
import type { LanguageSupport } from "./types.ts";

const FUNCTION_TYPES = new Set([
  "function_declaration", "generator_function_declaration", "function_expression",
  "arrow_function", "method_definition",
]);

// Anonymous callbacks return undefined: they can't be reused by name.
function nameOf(node: Node): string | undefined {
  const own = node.childForFieldName("name");
  if (own) return own.text;
  const parent = node.parent;
  if (parent?.type === "variable_declarator") return parent.childForFieldName("name")?.text;
  if (parent?.type === "pair") return parent.childForFieldName("key")?.text;
  return undefined;
}

function paramsOf(node: Node): string[] {
  const params = node.childForFieldName("parameters") ?? node.childForFieldName("parameter");
  if (!params) return [];
  if (params.type === "identifier") return [params.text];
  return params.namedChildren
    .filter((p) => p.type !== "comment")
    .map((p) => (p.childForFieldName("pattern") ?? p.childForFieldName("left") ?? p).text);
}

// Names exported via `export { a, b }`, `export default a`, `module.exports = { a }` or `exports.a = ...`.
function exportedNames(root: Node): Set<string> {
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

function exportAncestor(node: Node): Node | undefined {
  for (let p = node.parent, depth = 0; p && depth < 4; p = p.parent, depth++) {
    if (p.type === "export_statement") return p;
  }
  return undefined;
}

// `export default function X` or `export default X`
function defaultExportName(root: Node): string | undefined {
  for (const node of root.namedChildren) {
    if (node.type !== "export_statement" || !node.children.some((c) => c.type === "default")) continue;
    const value = node.childForFieldName("value");
    if (value?.type === "identifier") return value.text;
  }
  return undefined;
}

export const javascript: LanguageSupport = {
  family: "js",
  label: "JS/TS",
  grammars: {
    ".js": { id: "javascript", wasm: "tree-sitter-javascript/tree-sitter-javascript.wasm" },
    ".jsx": { id: "javascript", wasm: "tree-sitter-javascript/tree-sitter-javascript.wasm" },
    ".mjs": { id: "javascript", wasm: "tree-sitter-javascript/tree-sitter-javascript.wasm" },
    ".cjs": { id: "javascript", wasm: "tree-sitter-javascript/tree-sitter-javascript.wasm" },
    ".ts": { id: "typescript", wasm: "tree-sitter-typescript/tree-sitter-typescript.wasm" },
    ".mts": { id: "typescript", wasm: "tree-sitter-typescript/tree-sitter-typescript.wasm" },
    ".cts": { id: "typescript", wasm: "tree-sitter-typescript/tree-sitter-typescript.wasm" },
    ".tsx": { id: "tsx", wasm: "tree-sitter-typescript/tree-sitter-tsx.wasm" },
  },

  extractFunctions(root, file, id) {
    const exported = exportedNames(root);
    const defaultName = defaultExportName(root);
    const found: FunctionInfo[] = [];
    for (const node of descendants(root)) {
      if (!FUNCTION_TYPES.has(node.type)) continue;
      const name = nameOf(node);
      if (!name) continue;
      const className = enclosingClass(node, "class_declaration");
      const exportNode = exportAncestor(node);
      const property = node.parent?.type === "pair" || (node.type === "method_definition" && !className);
      found.push({
        ...commonInfo(node, name, file, id),
        params: paramsOf(node),
        className,
        kind: className ? "method" : property ? "property" : "function",
        decorated: false,
        defaultExport: !!exportNode?.children.some((c) => c.type === "default") || (!className && name === defaultName),
        exported: !className && (!!exportNode || exported.has(name)),
      });
    }
    return found;
  },

  extractImports(root) {
    const found: ImportInfo[] = [];
    for (const node of descendants(root)) {
      const line = node.startPosition.row + 1;
      if (node.type === "import_statement" || (node.type === "export_statement" && node.childForFieldName("source"))) {
        const source = node.childForFieldName("source");
        if (!source) continue;
        const names = [...descendants(node)]
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
  },

  // "./util.js" -> util (TS ESM imports .ts files as .js), "./auth.service" keeps its dot.
  importedModules(imp) {
    const last = posix.basename(imp.source.replace(/\/+$/, "")).replace(/\.[cm]?[jt]sx?$/, "");
    return last ? [last] : [];
  },

  entryKind: () => undefined,
  unusedExportReason: "Exported, but nothing uses it.",

  syntax: {
    catchClause: "catch_clause",
    catchBody: (clause) => clause.childForFieldName("body") ?? undefined,
    catchVariable: (clause) => clause.childForFieldName("parameter")?.text,
    throwStatement: "throw_statement",
    emptyStatement: undefined,
    nesting: ["if_statement", "for_statement", "for_in_statement", "while_statement", "do_statement", "try_statement", "switch_statement"],
    logCall: /^(console|logger|log)\.\w+\(/,
    commentText: (comment) => comment.replace(/^\/\/+|^\/\*+|\*+\/$/g, "").trim(),
    looksLikeCode:
      /^(const |let |var |if ?\(|for ?\(|return\b|import |export |await |console\.|\}|[\w.[\]'"]+\(.*\);?$|[\w.[\]]+ ?= ?[^=].*;$|<\/?[A-Z]\w*)/,
  },
};
