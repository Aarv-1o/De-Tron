import type { Node } from "web-tree-sitter";
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

export type LineRule = (context: FileContext) => LineFinding[];

export function* walk(node: Node): Generator<Node> {
  yield node;
  for (const child of node.namedChildren) yield* walk(child);
}

export const lineOf = (node: Node) => node.startPosition.row + 1;
