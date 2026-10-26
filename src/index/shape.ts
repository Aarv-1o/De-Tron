import type { Node } from "web-tree-sitter";

const NAME_TYPES = new Set([
  "identifier", "property_identifier", "shorthand_property_identifier",
  "shorthand_property_identifier_pattern", "type_identifier", "statement_identifier",
]);

const LITERAL_TYPES = new Set(["number", "regex", "integer", "float"]);

// The text parts of strings. Strings themselves are walked into, because
// template strings and f-strings contain variable names.
const STRING_TEXT_TYPES = new Set(["string_fragment", "string_content", "escape_sequence"]);

// 'a', "a" and `a` should look the same.
const QUOTE_TYPES = new Set(["'", '"', "`", "string_start", "string_end"]);

export const LITERAL_PREFIX = "lit:";

// The body as a token list where names don't matter but structure and literals do.
// Two functions that differ only in what their variables are called get the same shape.
export function shapeOf(body: Node): string[] {
  const names = new Map<string, string>();
  const tokens: string[] = [];
  const visit = (node: Node): void => {
    if (node.type === "comment") return;
    if (LITERAL_TYPES.has(node.type) || STRING_TEXT_TYPES.has(node.type)) {
      tokens.push(LITERAL_PREFIX + node.text);
      return;
    }
    if (node.childCount === 0) {
      if (QUOTE_TYPES.has(node.type)) {
        tokens.push("q");
      } else if (NAME_TYPES.has(node.type)) {
        if (!names.has(node.text)) names.set(node.text, `$${names.size}`);
        tokens.push(names.get(node.text)!);
      } else {
        tokens.push(node.type);
      }
      return;
    }
    for (const child of node.children) visit(child);
  };
  visit(body);
  return tokens;
}
