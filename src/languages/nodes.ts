import type { Node } from "web-tree-sitter";
import type { FunctionInfo } from "../index/functions.ts";
import { shapeOf } from "../index/shape.ts";
import type { LanguageId } from "./types.ts";

export function* descendants(node: Node): Generator<Node> {
  for (const child of node.namedChildren) {
    yield child;
    yield* descendants(child);
  }
}

export function enclosingClass(node: Node, classType: string): string | undefined {
  for (let p = node.parent; p; p = p.parent) {
    if (p.type === classType) return p.childForFieldName("name")?.text;
  }
  return undefined;
}

// The text inside a string literal node: 'x', "x" and `x` all give x.
export const unquote = (node: Node) => node.text.replace(/^['"`]|['"`]$/g, "");

// The parts of a FunctionInfo that every language fills in the same way.
export function commonInfo(node: Node, name: string, file: string, language: LanguageId) {
  return {
    name,
    file,
    language,
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
    async: node.children.some((c) => c.type === "async"),
    shape: shapeOf(node.childForFieldName("body") ?? node),
  } satisfies Partial<FunctionInfo>;
}
