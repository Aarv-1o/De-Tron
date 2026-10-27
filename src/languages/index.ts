import { extname } from "node:path";
import { astro } from "./astro.ts";
import { javascript } from "./javascript.ts";
import { python } from "./python.ts";
import type { LanguageId, LanguageSupport } from "./types.ts";

export type { LanguageId, LanguageSupport } from "./types.ts";

// To add a language: write its LanguageSupport and add it here.
const LANGUAGES: LanguageSupport[] = [javascript, python, astro];

const byExtension = new Map(
  LANGUAGES.flatMap((lang) => Object.entries(lang.grammars).map(([ext, grammar]) => [ext, { lang, ...grammar }] as const)),
);
const byId = new Map([...byExtension.values()].map((g) => [g.id, g]));

export function grammarForFile(path: string) {
  return byExtension.get(extname(path).toLowerCase());
}

export function supportFor(id: LanguageId): LanguageSupport {
  return byId.get(id)!.lang;
}

export function wasmFor(id: LanguageId): string {
  return byId.get(id)!.wasm;
}
