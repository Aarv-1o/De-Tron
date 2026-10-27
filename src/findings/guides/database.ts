import { TESTS, type Guide } from "./shared.ts";

// Database checks, from SQL Antipatterns (Karwin).

export const DATABASE_GUIDES: Record<string, Guide> = {
  "money-float": {
    name: "Money stored as a float",
    category: "database", safety: "ask-first",
    why: "Floats can't store most decimal amounts exactly (59.95 is stored as 59.950000762...), so sums, taxes and comparisons drift (SQL Antipatterns, ch. 10).",
    fix: [
      "Store whole cents in an integer field (priceCents), or use an exact decimal type: DECIMAL/NUMERIC(12,2) in SQL, Decimal128 in MongoDB, Prisma Decimal, Django DecimalField.",
      "This changes the schema: ask first, and write a migration that converts existing rows.",
      "Do the arithmetic in cents (or a decimal library), and format only for display.",
    ],
    verify: "A test that adds 0.10 + 0.20 through the model gets exactly 0.30; existing rows still read the same amounts.",
  },
  "query-in-loop": {
    name: "Queries inside loops (N+1)",
    category: "database", safety: "ask-first",
    why: "One database round trip per item: fine with 10 test rows, slow with 10,000 real ones.",
    fix: [
      "Fetch everything the loop needs in one query before it: WHERE id IN (...), { $in: ids }, Prisma `in`, Django select_related/prefetch_related.",
      "Look items up in memory inside the loop (a Map by id).",
      "For writes, use a bulk call (insertMany, bulk_create, createMany) instead of one per item.",
    ],
    verify: "Same results as before, with one query instead of one per item (check the query log, or a test that counts queries).",
  },
  "tree-walk-queries": {
    name: "Tree walked one query per level",
    category: "database", safety: "ask-first",
    why: "Each level is another round trip, and the depth can grow; fine for shallow trees (SQL Antipatterns, ch. 3 \"Naive Trees\").",
    fix: [
      "If trees stay a few levels deep: leave it.",
      "Otherwise fetch the whole path in one query: WITH RECURSIVE in PostgreSQL/MySQL 8/SQLite, $graphLookup in MongoDB.",
      "Only for deep trees read all the time: store the path (path enumeration) or a closure table. That's a schema change: ask first.",
    ],
    verify: "Same nodes returned, in the same order, with one query.",
  },
  "insert-without-columns": {
    name: "INSERT without a column list",
    category: "database", safety: "safe",
    why: "It depends on the table's column order: adding or reordering a column breaks it, or quietly writes values into the wrong columns (SQL Antipatterns, ch. 19).",
    fix: ["Name the columns: INSERT INTO t (a, b, c) VALUES (...), in the same order as the values."],
    verify: `${TESTS}; the row has the same values in the same columns as before.`,
  },
  "select-star": {
    name: "SELECT * in app code",
    category: "database", safety: "ask-first",
    why: "Fetches every column, including big ones nobody uses, and code that reads by position breaks when columns change (SQL Antipatterns, ch. 19).",
    fix: ["List the columns the code actually uses.", "Check every place that reads the result still gets what it needs."],
    verify: TESTS + ".",
  },
  "order-by-random": {
    name: "ORDER BY RAND()",
    category: "database", safety: "ask-first",
    why: "Sorts the whole table to pick a few rows: fine on a small table, slow as it grows (SQL Antipatterns, ch. 16).",
    fix: ["Only if the table can grow large: count the rows, pick a random offset in code, then fetch with LIMIT 1 OFFSET n (or MongoDB $sample)."],
    verify: "Still returns random rows; the query no longer sorts the whole table (check EXPLAIN).",
  },
  "leading-wildcard-search": {
    name: "Substring search (LIKE '%...%')",
    category: "database", safety: "ask-first",
    why: "No index can help a search that starts with a wildcard, so every search reads every row; it also matches inside words (\"one\" finds \"money\") (SQL Antipatterns, ch. 17).",
    fix: [
      "Fine for small tables or rare admin searches: leave it.",
      "For a real search feature: use the database's full-text search (PostgreSQL tsvector, MySQL FULLTEXT, a MongoDB text index) or a search engine.",
    ],
    verify: "Search returns the same results for whole words; it uses an index (check EXPLAIN).",
  },
};
