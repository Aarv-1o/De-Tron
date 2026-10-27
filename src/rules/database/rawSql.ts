import type { Node } from "web-tree-sitter";
import type { Confidence } from "../confidence.ts";
import { lineOf, walk, type FileContext, type LineFinding } from "../line/types.ts";

// Raw SQL in strings, and search filters in ORM calls (SQL Antipatterns ch. 16, 17, 19).

const STRINGS = new Set(["string", "template_string"]);

interface SqlRule {
  rule: string;
  confidence: Confidence;
  test: RegExp;
  message: string;
}

const SQL_RULES: SqlRule[] = [
  // Breaks, or silently fills the wrong columns, when the table changes (ch. 19).
  { rule: "insert-without-columns", confidence: "likely", test: /\bINSERT\s+INTO\s+[\w."`]+\s+VALUES\b/i, message: "INSERT without a column list: it depends on the table's column order" },
  // Fine for ad hoc queries; in app code it fetches columns nobody uses (ch. 19).
  { rule: "select-star", confidence: "maybe", test: /\bSELECT\s+(\w+\.)?\*\s+FROM\b/i, message: "SELECT * in app code: fetches every column, and breaks code that reads columns by position" },
  // Sorts the whole table to pick one row; fine on small tables (ch. 16).
  { rule: "order-by-random", confidence: "maybe", test: /\bORDER\s+BY\s+(RAND|RANDOM|NEWID)\s*\(\s*\)/i, message: "ORDER BY RAND(): sorts every row to pick a few" },
  // A leading wildcard can't use an index: every search reads every row (ch. 17).
  { rule: "leading-wildcard-search", confidence: "maybe", test: /\bI?LIKE\s+(['"]%|CONCAT\(\s*['"]%|['"]%['"]\s*\|\|)/i, message: "LIKE search with a leading %: no index can help, so every search reads every row" },
];

const isSql = (text: string) => /\b(SELECT|INSERT|UPDATE|DELETE)\b[\s\S]*\b(FROM|INTO|SET)\b/i.test(text);

// Django `name__icontains=q`, Mongo `{ $regex: q }`: the ORM spelling of LIKE '%q%'.
function ormSearch(node: Node): boolean {
  if (node.type === "keyword_argument") return /__(i?contains|i?regex)$/.test(node.childForFieldName("name")?.text ?? "");
  if (node.type === "pair") {
    const key = node.childForFieldName("key")?.text.replace(/['"]/g, "");
    return key === "$regex" && node.childForFieldName("value")?.type !== "regex";
  }
  return false;
}

export function rawSqlRules({ parsed, file }: FileContext): LineFinding[] {
  const found: LineFinding[] = [];
  for (const node of walk(parsed.tree.rootNode)) {
    if (STRINGS.has(node.type) && !STRINGS.has(node.parent?.type ?? "") && isSql(node.text)) {
      for (const r of SQL_RULES) {
        if (r.test.test(node.text)) found.push({ rule: r.rule, file, line: lineOf(node), confidence: r.confidence, message: r.message });
      }
    } else if (ormSearch(node)) {
      found.push({ rule: "leading-wildcard-search", file, line: lineOf(node), confidence: "maybe", message: `Substring search (${node.text.split(/[=:]/)[0]!.trim()}): no index can help, so every search reads every row` });
    }
  }
  return found;
}
