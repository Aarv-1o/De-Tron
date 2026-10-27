import { isTestFile } from "../../index/files.ts";
import type { ImportInfo } from "../../index/usage.ts";
import type { FileContext, LineFinding } from "../line/types.ts";
import { moneyRules } from "./money.ts";
import { queryInLoopRule } from "./queryInLoop.ts";
import { rawSqlRules } from "./rawSql.ts";

export { moneyInSchemaText } from "./money.ts";

// Database checks run per file, like the line rules, but report in their own section.
export const DATABASE_RULES = new Set([
  "money-float", "query-in-loop", "tree-walk-queries", "insert-without-columns", "select-star", "order-by-random", "leading-wildcard-search",
]);

// Tests hold example SQL and loops over fixtures on purpose.
export const databaseRules = (context: FileContext): LineFinding[] =>
  isTestFile(context.file) ? [] : [...moneyRules(context), ...queryInLoopRule(context), ...rawSqlRules(context)];

// Database libraries: without one, "no database issues" would claim a check that didn't happen.
const DB_LIBRARY = /^(mongoose|mongodb|sequelize|typeorm|@prisma\/client|prisma|knex|pg|mysql2?|sqlite3|better-sqlite3|drizzle-orm|@mikro-orm\/\w+|sqlalchemy|sqlmodel|django(\.db)?|pymongo|motor|psycopg2?|asyncpg|peewee|tortoise|sqlite3|databases)(\/|\.|$)/;

export const usesDatabase = (imports: Iterable<ImportInfo[]>, files: string[]) =>
  [...imports].some((list) => list.some((i) => DB_LIBRARY.test(i.source))) || files.some((f) => /\.(prisma|sql)$/i.test(f));
