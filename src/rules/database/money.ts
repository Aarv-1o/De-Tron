import type { Node } from "web-tree-sitter";
import type { Confidence } from "../confidence.ts";
import { lineOf, walk, type FileContext, type LineFinding } from "../line/types.ts";

// Money stored as a float (SQL Antipatterns, ch. 10 "Rounding Errors"): 59.95 can't be stored
// exactly in binary, so sums and comparisons drift. Floats are fine for ratings, scores and
// coordinates, so only money-named fields count.

const MONEY = new Set([
  "price", "cost", "amount", "balance", "fee", "fees", "salary", "wage", "wages", "payment", "revenue",
  "budget", "refund", "payout", "deposit", "subtotal", "earnings", "spend", "tax", "charge", "total",
]);
// Words that make it something else: priceCents is an integer, taxRate a percentage, totalCount a count.
const NOT_MONEY = new Set(["cents", "cent", "minor", "micros", "percent", "pct", "ratio", "rate", "rating", "count", "qty", "quantity", "score", "id", "ids", "type", "currency", "items", "pages"]);

export function isMoneyName(name: string): boolean {
  const words = name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/[\s_\-]+/);
  if (words.some((w) => NOT_MONEY.has(w))) return false;
  const money = words.filter((w) => MONEY.has(w));
  // "total" alone is often a count (total, totalUsed): it counts only next to another money word.
  return money.some((w) => w !== "total");
}

const SQL_FLOAT = /^(FLOAT|DOUBLE|REAL|DOUBLE PRECISION|DOUBLE_PRECISION)$/i;
// Just the fact: why it matters is the rule's to say, once.
const message = (field: string, type: string) => `${field}: money stored as ${type}`;

// Mongoose { price: Number } or { price: { type: Number } }; Sequelize DataTypes.FLOAT.
function jsField(pair: Node, mongoose: boolean): { type: string; confidence: Confidence } | undefined {
  let value = pair.childForFieldName("value");
  if (value?.type === "object") {
    const typePair = value.namedChildren.find((p) => p.type === "pair" && p.childForFieldName("key")?.text.replace(/['"]/g, "") === "type");
    value = typePair?.childForFieldName("value") ?? null;
  }
  const text = value?.text ?? "";
  const sequelize = /^(DataTypes|Sequelize)\.(\w+)/.exec(text)?.[2];
  if (sequelize && SQL_FLOAT.test(sequelize)) return { type: sequelize.toUpperCase(), confidence: "likely" };
  // MongoDB numbers are doubles. Whole amounts (a budget in dollars) are exact, so it's a hint.
  if (mongoose && /^(Number|Schema\.Types\.Number|mongoose\.Schema\.Types\.Number)$/.test(text)) return { type: "a Number (a double)", confidence: "maybe" };
  return undefined;
}

// TypeORM: @Column("float") price: number; or @Column({ type: "double" }).
function typeormField(field: Node): string | undefined {
  const decorators = [...field.namedChildren, ...(field.previousNamedSibling?.type === "decorator" ? [field.previousNamedSibling] : [])];
  for (const d of decorators.filter((n) => n.type === "decorator")) {
    if (!/^@Column\b/.test(d.text)) continue;
    const type = /["'](float|double|real|double precision)["']/i.exec(d.text)?.[1];
    if (type) return type.toUpperCase();
  }
  return undefined;
}

// Django models.FloatField(), SQLAlchemy Column(Float) / mapped_column(Float) / Mapped[float],
// SQLModel `price: float` in a table=True class.
function pythonField(statement: Node, sqlModelTable: boolean): string | undefined {
  const text = statement.text;
  if (/=\s*(models\.)?FloatField\(/.test(text)) return "FloatField";
  if (/=\s*(sa\.|sqlalchemy\.)?(Column|mapped_column)\(\s*(sa\.|sqlalchemy\.)?(Float|REAL|DOUBLE|Double)\b/.test(text)) return "Float";
  if (/:\s*Mapped\[\s*(Optional\[)?float/.test(text)) return "Float";
  if (sqlModelTable && /^\w+\s*:\s*(Optional\[)?float\b|^\w+\s*:\s*float\s*\|/.test(text)) return "float";
  return undefined;
}

const nameOf = (node: Node | null) => node?.text.replace(/['"]/g, "");

export function moneyRules({ parsed, file }: FileContext): LineFinding[] {
  const found: LineFinding[] = [];
  const add = (node: Node, field: string, type: string, confidence: Confidence) =>
    found.push({ rule: "money-float", file, line: lineOf(node), confidence, message: message(field, type) });
  const source = parsed.source;
  const mongoose = /\bmongoose\b|\bnew Schema\(/.test(source);
  for (const node of walk(parsed.tree.rootNode)) {
    if (node.type === "pair") {
      const field = nameOf(node.childForFieldName("key"));
      const hit = field && isMoneyName(field) ? jsField(node, mongoose) : undefined;
      if (hit) add(node, field!, hit.type, hit.confidence);
    } else if (node.type === "public_field_definition") {
      const field = nameOf(node.childForFieldName("name"));
      const type = field && isMoneyName(field) ? typeormField(node) : undefined;
      if (type) add(node, field!, type, "likely");
    } else if (node.type === "expression_statement" && parsed.language === "python") {
      const field = /^(\w+)\s*[:=]/.exec(node.text)?.[1];
      const table = /class\s+\w+\([^)]*table\s*=\s*True/.test(source);
      const type = field && isMoneyName(field) ? pythonField(node, table) : undefined;
      if (type) add(node, field!, type, "likely");
    }
  }
  return found;
}

// Prisma schemas and SQL files aren't parsed: `price Float` and `price FLOAT` by line.
export function moneyInSchemaText(file: string, text: string): LineFinding[] {
  const pattern = file.endsWith(".prisma") ? /^\s*(\w+)\s+(Float)\b/ : /^\s*["`]?(\w+)["`]?\s+(FLOAT|REAL|DOUBLE(?: PRECISION)?)\b/i;
  return text.split("\n").flatMap((line, i) => {
    const m = pattern.exec(line);
    return m && isMoneyName(m[1]!) ? [{ rule: "money-float", file, line: i + 1, confidence: "likely" as const, message: message(m[1]!, m[2]!.toUpperCase()) }] : [];
  });
}
