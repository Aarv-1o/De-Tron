import type { Node } from "web-tree-sitter";
import { subtree } from "../../languages/nodes.ts";
import type { Syntax } from "../../languages/types.ts";
import type { ParsedFile } from "../../parse/parse.ts";
import type { Confidence } from "../confidence.ts";

export interface LineFinding {
  rule: string; // e.g. "catch-only-logs"
  file: string;
  line: number;
  confidence: Confidence;
  message: string; // what's wrong, in one line
}

export interface FileContext {
  parsed: ParsedFile;
  file: string;
  syntax: Syntax;
  // Code that runs in the browser: there, an error that's only logged is one the user never sees.
  frontend: boolean;
}

export type LineRule = (context: FileContext) => LineFinding[] | Promise<LineFinding[]>;

export function* walk(node: Node): Generator<Node> {
  yield* subtree(node);
}

export const lineOf = (node: Node) => node.startPosition.row + 1;

// Findings for one file, and how rules add to them: add(node, rule, confidence, message).
export function collector(file: string) {
  const found: LineFinding[] = [];
  const add = (node: Node, rule: string, confidence: Confidence, message: string) =>
    void found.push({ rule, file, line: lineOf(node), confidence, message });
  return { found, add };
}
