import { supportFor } from "../../languages/index.ts";
import type { ParsedFile } from "../../parse/parse.ts";
import { isTestFile } from "../../index/files.ts";
import { catchRules } from "./catches.ts";
import { databaseRules } from "../database/index.ts";
import { securityRules } from "../security/index.ts";
import { commentRules } from "./comments.ts";
import type { LineFinding, LineRule } from "./types.ts";

export type { LineFinding } from "./types.ts";

// Tests hold example attacks and fake keys on purpose: security rules skip them.
const RULES: LineRule[] = [catchRules, commentRules, databaseRules, (c) => (isTestFile(c.file) ? [] : securityRules(c))];

export async function runLineRules(parsed: ParsedFile, file: string, imports: string[]): Promise<LineFinding[]> {
  const language = supportFor(parsed.language);
  const context = { parsed, file, syntax: language.syntax, frontend: language.runsInBrowser(file, imports) };
  return (await Promise.all(RULES.map((rule) => rule(context)))).flat();
}
