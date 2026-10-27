import type { Node } from "web-tree-sitter";
import { collector, walk, type FileContext, type LineFinding } from "../line/types.ts";
import { userInputIn } from "./taint.ts";

// User input reaching something that runs it, fetches it, opens it or stores it as-is
// (OWASP Injection; Alice & Bob ch. 4 "Untrusted Data"; SQL Antipatterns ch. 21).

const SQL_TEXT = /\b(SELECT\s[\s\S]*\bFROM|INSERT\s+INTO|UPDATE\s+\S+\s+SET|DELETE\s+FROM)\b/i;
const CALLS = new Set(["call_expression", "call"]);

const calleeOf = (call: Node) => call.childForFieldName("function")?.text.replace(/\s+/g, "") ?? "";
const argsOf = (call: Node) => call.childForFieldName("arguments")?.namedChildren.filter((a) => a.type !== "comment" && a.type !== "keyword_argument") ?? [];
// A tagged template (sql`...`, prisma.$queryRaw`...`) passes values as parameters: safe.
const isTagged = (node: Node) => node.parent?.type === "call_expression" && node.parent.childForFieldName("arguments")?.id === node.id;

// Strings built from values: `...${x}`, f"...{x}", "..." + x, "...%s" % x, "...{}".format(x).
function builtString(node: Node): Node[] | undefined {
  if (node.type === "template_string" && !isTagged(node)) {
    const subs = node.namedChildren.filter((c) => c.type === "template_substitution");
    return subs.length ? subs : undefined;
  }
  if (node.type === "string" && node.namedChildren.some((c) => c.type === "interpolation")) return node.namedChildren.filter((c) => c.type === "interpolation");
  if (node.type === "binary_expression" || node.type === "binary_operator") {
    const op = node.childForFieldName("operator")?.text;
    const parts = [node.childForFieldName("left"), node.childForFieldName("right")].filter((p): p is Node => !!p);
    if ((op === "+" || op === "%") && parts.some((p) => p.type !== "string" && p.type !== "template_string" && !builtString(p))) return parts.filter((p) => p.type !== "string");
  }
  if (node.type === "call" && /\.format$/.test(calleeOf(node)) && node.childForFieldName("function")?.childForFieldName("object")?.type === "string") return argsOf(node);
  return undefined;
}

// Values that are constants (TABLE_NAME, SORT_COLUMNS[i]) aren't user input.
const onlyConstants = (parts: Node[]) => parts.every((p) => /^[\s${}()]*[A-Z][A-Z0-9_]*(\[[^\]]*\])?[\s}]*$/.test(p.text.replace(/^\$\{|\}$/g, "")));

interface Sink {
  rule: string;
  callee: RegExp;
  arg?: (call: Node) => Node | undefined;
  message: (callee: string, input: string) => string;
}

const first = (call: Node) => argsOf(call)[0];
const SINKS: Sink[] = [
  { rule: "command-injection", callee: /^(child_process\.)?(exec|execSync|spawnSync|spawn|execFileSync)$|^(os\.system|os\.popen|subprocess\.\w+)$/, message: (c, i) => `${c}() runs a shell command built from ${i}` },
  { rule: "code-eval", callee: /^(eval|Function|exec|vm\.runInNewContext|vm\.runInThisContext)$/, message: (c, i) => `${c}() runs code from ${i}` },
  { rule: "ssrf", callee: /^(fetch|axios|axios\.(get|post|put|delete|request)|got|got\.\w+|http\.get|https\.get|request|needle|requests\.(get|post|put|delete|request)|httpx\.(get|post)|urllib\.request\.urlopen|urlopen)$/, message: (c, i) => `${c}() fetches a URL from ${i}: the server can be made to call internal services` },
  { rule: "open-redirect", callee: /^(res\.redirect|reply\.redirect|redirect|HttpResponseRedirect|RedirectResponse|NextResponse\.redirect)$/, arg: (call) => argsOf(call).at(-1), message: (c, i) => `${c}() sends the user to a URL from ${i}: phishing links can bounce through your domain` },
  { rule: "path-traversal", callee: /^(fs\.)?(readFile|readFileSync|createReadStream|writeFile|writeFileSync|unlink|unlinkSync|rm|rmSync)$|^(fs\.promises|fsp)\.\w+$|^(res\.sendFile|res\.download|reply\.sendFile|open|send_file|send_from_directory|FileResponse|os\.remove|shutil\.rmtree)$/, message: (c, i) => `${c}() opens a path from ${i}: "../" can reach any file` },
];

// Model.create(req.body), new User(req.body), doc.update(req.body), Object.assign(doc, req.body):
// the user picks every field, including role, isAdmin or price.
const MASS_ASSIGN = /^(\w+\.)*(create|insert|insertOne|insertMany|update|updateOne|updateMany|findByIdAndUpdate|findOneAndUpdate|findOneAndReplace|upsert|save|bulkCreate|set|assign|objects\.create|objects\.update|update_or_create|get_or_create)$/;
const WHOLE_INPUT = /^(\.\.\.)?(req|request|ctx\.request)\.(body|query)$|^\{\s*\.\.\.(req|request)\.body\s*\}$|^\*\*(request\.(json|data|form|POST)|await request\.json\(\))$|^\{\s*data\s*:\s*(req|request)\.body\s*\}$/;

// The body was checked against a schema first: Fastify `schema: { body }`, a zod/joi parse, validate().
function validatedBody(node: Node): boolean {
  for (let p = node.parent; p; p = p.parent) {
    if (p.type === "call_expression" && /schema\s*:\s*\{[\s\S]{0,800}?\bbody\s*:/.test(p.text.slice(0, 2000))) return true;
    if (/^(arrow_function|function_expression|function_declaration|method_definition)$/.test(p.type)) {
      if (/\.(parse|safeParse|validate|validateAsync)\(\s*(req|request)\.body|validationResult\(|checkSchema|celebrate\(/.test(p.text)) return true;
    }
  }
  return false;
}

export function injectionRules({ parsed, file }: FileContext): LineFinding[] {
  const python = parsed.language === "python";
  const { found, add } = collector(file);
  for (const node of walk(parsed.tree.rootNode)) {
    // SQL built from values (SQL Antipatterns ch. 21: no legitimate use). Only the outermost
    // piece of "SELECT " + a + " FROM " + b, so it's reported once.
    const parts = SQL_TEXT.test(node.text.slice(0, 400)) ? builtString(node) : undefined;
    const outermost = !(node.parent && builtString(node.parent) && SQL_TEXT.test(node.parent.text.slice(0, 400)));
    if (parts && outermost && !onlyConstants(parts)) {
      const input = userInputIn(node, python);
      add(node, "sql-injection", input ? "likely" : "maybe", `SQL built from ${input ?? "a value"} instead of query parameters`);
    }
    if (CALLS.has(node.type) || node.type === "new_expression") {
      const callee = node.type === "new_expression" ? (node.childForFieldName("constructor")?.text ?? "") : calleeOf(node);
      const args = node.type === "new_expression" ? (node.childForFieldName("arguments")?.namedChildren ?? []) : argsOf(node);
      // A whole request body or query used as a MongoDB filter: { "$ne": null } logs anyone in.
      if (/\.(find|findOne|findOneAndUpdate|updateOne|updateMany|deleteOne|deleteMany|countDocuments|exists)$/.test(callee) && args[0] && /^(\{\s*\.\.\.)?(req|request|ctx\.request)\.(body|query)\s*\}?$/.test(args[0].text)) {
        add(node, "nosql-injection", "likely", `${callee}() takes ${args[0].text} as its filter: an object like { "$ne": null } matches any record`);
      }
      const whole = args.find((a) => WHOLE_INPUT.test(a.text.replace(/\s+/g, " ")));
      if (whole && (MASS_ASSIGN.test(callee) || node.type === "new_expression" || /^[A-Z]\w*$/.test(callee)) && !validatedBody(node)) {
        add(node, "mass-assignment", "likely", `${callee}() stores ${whole.text} as-is: the user can set any field, including role or isAdmin`);
      }
      for (const sink of SINKS) {
        if (!sink.callee.test(callee)) continue;
        if (sink.rule === "code-eval" && !python && callee === "exec") continue; // JS exec is child_process: covered above
        if (sink.rule === "command-injection" && callee === "exec" && python) continue; // Python exec is code-eval
        const arg = (sink.arg ?? first)(node);
        if (!arg || arg.type === "string" && !builtString(arg)) continue;
        // A URL whose host is written in the code can't be pointed elsewhere: only the path changes.
        if (sink.rule === "ssrf" && /^(["'`]|f["'])https?:\/\/[^/$"'`{]+\//.test(arg.text)) continue;
        const input = userInputIn(arg, python);
        if (input) add(node, sink.rule, "likely", sink.message(callee, input));
        else if (sink.rule === "code-eval" || (sink.rule === "command-injection" && builtString(arg))) add(node, sink.rule, "maybe", sink.message(callee, "a value built at runtime"));
      }
    }
  }
  return found;
}
