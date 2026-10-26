import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { extname } from "node:path";
import { Language, Parser, type Tree } from "web-tree-sitter";

export type LanguageId = "javascript" | "typescript" | "tsx" | "python";

export interface ParsedFile {
  path: string;
  language: LanguageId;
  source: string;
  // web-tree-sitter trees live in WASM memory: call tree.delete() when done.
  tree: Tree;
}

const EXTENSIONS: Record<string, LanguageId> = {
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".ts": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".tsx": "tsx",
  ".py": "python",
};

const WASM_FILES: Record<LanguageId, string> = {
  javascript: "tree-sitter-javascript/tree-sitter-javascript.wasm",
  typescript: "tree-sitter-typescript/tree-sitter-typescript.wasm",
  tsx: "tree-sitter-typescript/tree-sitter-tsx.wasm",
  python: "tree-sitter-python/tree-sitter-python.wasm",
};

const require = createRequire(import.meta.url);
const parsers = new Map<LanguageId, Promise<Parser>>();

export function detectLanguage(path: string): LanguageId | undefined {
  return EXTENSIONS[extname(path).toLowerCase()];
}

// One parser per language, created on first use and then reused.
function getParser(language: LanguageId): Promise<Parser> {
  let parser = parsers.get(language);
  if (!parser) {
    parser = (async () => {
      await Parser.init();
      const grammar = await Language.load(require.resolve(WASM_FILES[language]));
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
  const language = detectLanguage(path);
  if (!language) return undefined;
  const source = await readFile(path, "utf8");
  return { path, language, source, tree: await parseSource(source, language) };
}
