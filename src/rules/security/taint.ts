import type { Node } from "web-tree-sitter";
import { walk } from "../line/types.ts";

// Does a value come from the user? Directly (req.body.url), or through a variable set from
// user input in the same function (const { url } = req.query; ... fetch(url)).

// Not req.files: an upload's path is the server's temp file, not something the user picked.
const JS_INPUT = /\b(req|request)\.(body|query|params|headers|cookies)\b|\bctx\.(request\.body|query|params)\b|\bsearchParams\.get\(|\bevent\.(body|queryStringParameters|pathParameters)\b|\bformData\.get\(/;
const PY_INPUT = /\brequest\.(args|form|json|values|data|GET|POST|query_params|path_params|cookies|headers|get_json\(\))\b/;

const PASSTHROUGH = /^(path\.(join|resolve|normalize)|os\.path\.join|String|str|decodeURIComponent|decodeURI|unquote|parseInt|int|Number|URL|new URL)$|\.(trim|toString|toLowerCase|toUpperCase|replace|strip|lower|format|join)$/;
// Reading from the request: request.args.get("next"), url.searchParams.get("q"), await request.json().
const INPUT_GETTER = /^(req|request|ctx\.request|url\.searchParams|searchParams|formData)(\.\w+)*\.(get|getAll|get_json|json|formData|text)$/;
const FUNCTIONS = new Set(["arrow_function", "function_expression", "function_declaration", "method_definition", "function_definition", "lambda", "function"]);

export const isUserInput = (text: string, python: boolean) => (python ? PY_INPUT : JS_INPUT).test(text);

function enclosingFunction(node: Node): Node | undefined {
  for (let p = node.parent; p; p = p.parent) if (FUNCTIONS.has(p.type)) return p;
  return undefined;
}

// Names assigned from user input in a function: `const { url } = req.query`, `q = request.args.get("q")`.
function taintedNames(fn: Node, python: boolean): Set<string> {
  const names = new Set<string>();
  // Two passes, so `const b = a` after `const a = req.body.x` counts too.
  for (let pass = 0; pass < 2; pass++) {
    for (const n of walk(fn)) {
      const target = n.type === "variable_declarator" ? n.childForFieldName("name") : n.type === "assignment" || n.type === "assignment_expression" ? n.childForFieldName("left") : null;
      const value = n.childForFieldName(n.type === "variable_declarator" ? "value" : "right");
      if (!target || !value) continue;
      // A call's result (a database record, an API response) isn't user input, except for
      // functions that pass their input through (path.join, String, trim...).
      const inner = value.type === "await_expression" ? value.namedChildren[0] : value;
      const callee = inner && (inner.type === "call_expression" || inner.type === "call") ? inner.childForFieldName("function")?.text ?? "" : "";
      if (callee && !PASSTHROUGH.test(callee) && !INPUT_GETTER.test(callee)) continue;
      const fromInput = isUserInput(value.text, python) || [...names].some((name) => new RegExp(`\\b${name}\\b`).test(value.text));
      if (!fromInput) continue;
      for (const id of walk(target)) {
        if (id.type === "identifier" || id.type === "shorthand_property_identifier_pattern") names.add(id.text);
      }
    }
  }
  // FastAPI / Flask handler parameters are user input too (def get(q: str), (id: int)).
  if (python && /@\w+\.(get|post|put|patch|delete|route)\(/.test(fn.parent?.text.slice(0, 300) ?? "")) {
    for (const p of fn.childForFieldName("parameters")?.namedChildren ?? []) {
      const name = (p.childForFieldName("name") ?? p.namedChildren[0] ?? p).text;
      if (name && !/^(self|session|db|current_user|request)$/.test(name) && !/Depends\(|Session|CurrentUser/.test(p.text)) names.add(name);
    }
  }
  return names;
}

const cache = new Map<number, Set<string>>(); // by node id: node objects are fresh wrappers

// How user input reaches `node`: "req.body.url", "url (from req.query)", or undefined.
export function userInputIn(node: Node, python: boolean): string | undefined {
  const direct = (python ? PY_INPUT : JS_INPUT).exec(node.text);
  if (direct) return direct[0];
  const fn = enclosingFunction(node);
  if (!fn) return undefined;
  let names = cache.get(fn.id);
  if (!names) cache.set(fn.id, (names = taintedNames(fn, python)));
  for (const id of walk(node)) {
    if (id.type === "identifier" && names.has(id.text)) return `${id.text} (from user input)`;
  }
  return undefined;
}
