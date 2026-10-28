import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, join } from "node:path";
import { Language, Parser, type Tree } from "web-tree-sitter";
import { grammarForFile, wasmFor, type LanguageId } from "../languages/index.ts";

export type { LanguageId } from "../languages/index.ts";

export interface ParsedFile {
  path: string;
  language: LanguageId;
  source: string; // what was parsed: for Astro, the code with the template blanked out
  original?: string; // the file as written, when `source` differs from it
  // web-tree-sitter trees live in WASM memory: call tree.delete() when done.
  tree: Tree;
}

const require = createRequire(import.meta.url);
const parsers = new Map<LanguageId, Promise<Parser>>();

export function detectLanguage(path: string): LanguageId | undefined {
  return grammarForFile(path)?.id;
}

// One parser per language, created on first use and then reused.
function getParser(language: LanguageId): Promise<Parser> {
  let parser = parsers.get(language);
  if (!parser) {
    parser = (async () => {
      // Bundled (the editor extension): the .wasm files sit in one folder, named by DETRON_WASM_DIR.
      const dir = process.env.DETRON_WASM_DIR;
      await Parser.init(dir ? { locateFile: (file: string) => join(dir, file) } : undefined);
      const grammar = await Language.load(dir ? join(dir, basename(wasmFor(language))) : require.resolve(wasmFor(language)));
      const p = new Parser();
      p.setLanguage(grammar);
      return p;
    })();
    parsers.set(language, parser);
  }
  return parser;
}

export async function parseSource(source: string, language: LanguageId): Promise<Tree> {
  const tree = (await getParser(language)).parse(source);
  if (!tree) throw new Error(`tree-sitter returned no tree for ${language} source`);
  return tree;
}

// Returns undefined for files in a language Detron doesn't support yet.
export async function parseFile(path: string): Promise<ParsedFile | undefined> {
  const grammar = grammarForFile(path);
  if (!grammar) return undefined;
  const raw = await readFile(path, "utf8");
  const source = grammar.preprocess ? grammar.preprocess(raw) : raw;
  const tree = await parseSource(source, grammar.id);
  return { path, language: grammar.id, source, ...(source !== raw ? { original: raw } : {}), tree };
}
