import { supportFor } from "../../languages/index.ts";
import type { ParsedFile } from "../../parse/parse.ts";
import { catchRules } from "./catches.ts";
import { commentRules } from "./comments.ts";
import type { LineFinding, LineRule } from "./types.ts";

export type { LineFinding } from "./types.ts";

const RULES: LineRule[] = [catchRules, commentRules];

export async function runLineRules(parsed: ParsedFile, file: string, imports: string[]): Promise<LineFinding[]> {
  const language = supportFor(parsed.language);
  const context = { parsed, file, syntax: language.syntax, frontend: language.runsInBrowser(file, imports) };
  return (await Promise.all(RULES.map((rule) => rule(context)))).flat();
}
