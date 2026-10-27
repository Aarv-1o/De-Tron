import type { Node } from "web-tree-sitter";
import { parseSource } from "../../parse/parse.ts";
import { lineOf, walk, type FileContext, type LineFinding } from "./types.ts";

// Tool directives and notes look like code but are meant to stay.
const DIRECTIVE = /^(eslint|@ts-|ts-|noqa|type:|pylint|prettier|istanbul|c8|fmt:|TODO|FIXME|NOTE|HACK|XXX|!|-\*-)/i;
// A comment that explains why isn't repeating the code, even if it shares its words.
const EXPLAINS_WHY = /\b(because|why|note|hack|workaround|must|don't|do not|avoid|otherwise|ensure|since|so that|unless|careful|important|instead)\b/i;
// Section headers (// ─── Rate Limiting ───) are for finding your way in a long file.
const DIVIDER = /[─━═]|[-=*#]{3,}/;
const STOPWORDS = new Set("the a an to of and or for in on is it this that with be by as from at we our if then into set get new use".split(" "));

const words = (text: string) => (text.match(/[A-Za-z]{3,}/g) ?? []).map((w) => w.toLowerCase()).filter((w) => !STOPWORDS.has(w));
const stem = (word: string) => word.replace(/(ing|ed|es|s)$/, "");
// Code words: split identifiers like fetchClients / fetch_clients into fetch + clients.
const codeWords = (code: string) => new Set(words(code.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ")).map(stem));

const isLineComment = (node: Node, lines: string[]) =>
  node.startPosition.row === node.endPosition.row && lines[node.startPosition.row]!.trim().startsWith(node.text.slice(0, 2));

export async function commentRules({ parsed, file, syntax }: FileContext): Promise<LineFinding[]> {
  const found: LineFinding[] = [];
  const lines = parsed.source.split("\n");
  const comments = [...walk(parsed.tree.rootNode)].filter((n) => n.type === "comment" && isLineComment(n, lines));

  // Commented-out code: looks like code, and really parses as code. Prose like
  // "html=True enables serving index.html" looks like code but doesn't parse.
  const codeRows: number[] = [];
  for (const c of comments) {
    const text = syntax.commentText(c.text);
    if (DIRECTIVE.test(text) || !syntax.looksLikeCode.test(text)) continue;
    const tree = await parseSource(text, parsed.language);
    if (!tree.rootNode.hasError) codeRows.push(c.startPosition.row);
    tree.delete();
  }
  // Grouped into blocks; blank lines between commented lines don't break a block.
  const onlyBlankBetween = (a: number, b: number) => lines.slice(a + 1, b).every((l) => !l.trim());
  for (let i = 0; i < codeRows.length; ) {
    let j = i;
    while (j + 1 < codeRows.length && onlyBlankBetween(codeRows[j]!, codeRows[j + 1]!)) j++;
    const count = j - i + 1;
    found.push({
      rule: "commented-out-code",
      file,
      line: codeRows[i]! + 1,
      // One commented line could be an example in prose; a block of them is old code.
      confidence: count >= 2 ? "sure" : "likely",
      message: `${count === 1 ? "A line" : `${count} lines`} of commented-out code. Git keeps the history: delete it.`,
    });
    i = j + 1;
  }

  // Comments that only restate the next line: `// Initialize Firebase` above initializeApp(...).
  const codeRowSet = new Set(codeRows);
  for (const comment of comments) {
    const row = comment.startPosition.row;
    if (codeRowSet.has(row)) continue;
    const text = syntax.commentText(comment.text);
    const next = lines.slice(row + 1).find((l) => l.trim())?.trim() ?? "";
    if (!next || next.startsWith(comment.text.slice(0, 1)) || DIRECTIVE.test(text) || EXPLAINS_WHY.test(text) || DIVIDER.test(comment.text)) continue;
    const said = words(text);
    if (said.length < 2 || text.split(/\s+/).length > 8) continue;
    const code = codeWords(next);
    const repeated = said.filter((w) => code.has(stem(w))).length;
    if (repeated / said.length >= 0.6) {
      found.push({ rule: "comment-repeats-code", file, line: lineOf(comment), confidence: "likely", message: "Comment repeats what the next line says. Delete it, or say why instead." });
    }
  }
  return found;
}
