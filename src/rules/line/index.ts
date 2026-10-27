import { supportFor } from "../../languages/index.ts";
import type { ParsedFile } from "../../parse/parse.ts";
import { catchRules } from "./catches.ts";
import type { LineFinding, LineRule } from "./types.ts";

export type { LineFinding } from "./types.ts";

const RULES: LineRule[] = [catchRules];

export function runLineRules(parsed: ParsedFile, file: string, imports: string[]): LineFinding[] {
  const language = supportFor(parsed.language);
  const context = { parsed, file, syntax: language.syntax, frontend: language.runsInBrowser(file, imports) };
  return RULES.flatMap((rule) => rule(context));
}
