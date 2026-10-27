import type { Node } from "web-tree-sitter";
import { HOLE } from "../rules/crossStack/paths.ts";
import { emptyApi, HTTP_METHODS, type FileApi } from "../rules/crossStack/types.ts";
import { stringValues } from "./jsValues.ts";
import { descendants, unquote } from "./nodes.ts";

// Express routes and mounts, Next.js file routes, and fetch/axios calls in one JS/TS file.

const METHOD_NAMES = new Set([...HTTP_METHODS.map((m) => m.toLowerCase()), "all"]);
// When a router isn't created in the file (it's a parameter), go by its name.
const ROUTER_NAME = /^(app|server|router|\w+Router)$/;
// HTTP clients: axios, and instances named like one. `api.get("/users")` is a call, not a route.
const CLIENT_NAME = /^(axios|api|http|client|\w+Api|\w+Client|\$)$/;
// Your own wrapper around fetch: apiFetch("/users"). It may add a base URL we can't see.
const WRAPPER_NAME = /^(\w*(fetch|request)\w*|api\w*|\w+Api)$/i;

const args = (call: Node) => call.childForFieldName("arguments")?.namedChildren.filter((a) => a.type !== "comment") ?? [];

// express(), express.Router(), Router(): the variables routes are declared on.
function findRouters(root: Node, api: FileApi): void {
  for (const node of descendants(root)) {
    if (node.type !== "variable_declarator") continue;
    const value = node.childForFieldName("value");
    const callee = value?.type === "call_expression" ? value.childForFieldName("function")?.text : undefined;
    const name = node.childForFieldName("name")?.text;
    if (!name || !callee) continue;
    if (callee === "express") api.routers.set(name, { prefix: "", isApp: true });
    else if (/^(express\.)?Router$/.test(callee)) api.routers.set(name, { prefix: "", isApp: false });
  }
}

function findBindings(root: Node, api: FileApi): void {
  for (const node of descendants(root)) {
    if (node.type === "import_statement") {
      const source = node.childForFieldName("source");
      if (!source) continue;
      for (const part of descendants(node)) {
        if (part.type === "import_clause") {
          const local = part.namedChildren.find((c) => c.type === "identifier");
          if (local) api.bindings.set(local.text, { source: unquote(source), name: "default" });
        } else if (part.type === "import_specifier") {
          const name = part.childForFieldName("name")?.text ?? part.text;
          api.bindings.set(part.childForFieldName("alias")?.text ?? name, { source: unquote(source), name });
        }
      }
    } else if (node.type === "variable_declarator") {
      // const x = require("./x"), const { a } = require("./x")
      const value = node.childForFieldName("value");
      const arg = value?.type === "call_expression" && value.childForFieldName("function")?.text === "require" ? args(value)[0] : undefined;
      if (arg?.type !== "string") continue;
      const pattern = node.childForFieldName("name");
      if (pattern?.type === "identifier") api.bindings.set(pattern.text, { source: unquote(arg), name: "default" });
      for (const p of pattern?.type === "object_pattern" ? pattern.namedChildren : []) {
        if (p.type === "shorthand_property_identifier_pattern") api.bindings.set(p.text, { source: unquote(arg), name: p.text });
      }
    }
  }
}

// What a mount points at: `authRouter`, `createAuthRouter(User)` or `require("./auth")`.
function mountTarget(node: Node): string | undefined {
  if (node.type === "identifier") return node.text;
  if (node.type !== "call_expression") return undefined;
  const fn = node.childForFieldName("function");
  const arg = args(node)[0];
  if (fn?.text === "require" && arg?.type === "string") return `require:${unquote(arg)}`;
  return fn?.type === "identifier" ? fn.text : undefined;
}

// `router.get("/x", h)` or `router.route("/x").get(h)`: the path and the router it's on.
function routeOf(object: Node, call: Node): { router: string; path: Node } | undefined {
  if (object.type === "identifier") {
    const path = args(call)[0];
    return path?.type === "string" || path?.type === "template_string" ? { router: object.text, path } : undefined;
  }
  if (object.type !== "call_expression") return undefined;
  const fn = object.childForFieldName("function");
  if (fn?.type !== "member_expression") return undefined;
  const inner = fn.childForFieldName("object");
  const prop = fn.childForFieldName("property")?.text;
  if (prop === "route" && inner?.type === "identifier") {
    const path = args(object)[0];
    return path?.type === "string" ? { router: inner.text, path } : undefined;
  }
  return inner && METHOD_NAMES.has(prop ?? "") ? routeOf(inner, object) : undefined; // .get(h).post(h)
}

function methodOption(options: Node | undefined): string | undefined {
  if (!options) return "GET";
  if (options.type !== "object") return undefined;
  const pair = options.namedChildren.find((p) => p.type === "pair" && p.childForFieldName("key")?.text.replace(/['"]/g, "") === "method");
  if (!pair) return options.namedChildren.some((p) => p.type === "spread_element") ? undefined : "GET";
  const value = pair.childForFieldName("value");
  return value?.type === "string" ? unquote(value).toUpperCase() : undefined;
}

function addCall(api: FileApi, urlNode: Node | undefined, method: string | undefined, line: number, wrapper = false): void {
  if (!urlNode) return;
  for (const value of stringValues(urlNode) ?? []) {
    const url = value.split(/[?#]/)[0]!;
    if (/[^/]\u0000$/.test(url)) continue; // ends in an unknown piece: `/api/items${suffix}`
    // A wrapper may add a base URL we can't see, so only the end of the path is known.
    if (wrapper && !url.startsWith("/")) continue;
    api.calls.push({ method, url: wrapper ? HOLE + url : url, line });
  }
}

function visitCall(node: Node, api: FileApi): void {
  const fn = node.childForFieldName("function");
  const [first, second] = args(node);
  const line = node.startPosition.row + 1;
  if (fn?.type === "identifier") {
    if (fn.text === "fetch") return addCall(api, first, methodOption(second), line);
    if (fn.text === "axios") return addCall(api, first, first?.type === "object" ? undefined : methodOption(second), line);
    // A wrapper named like fetch passes the options on: authFetch(url, { method: "PUT" }).
    if (WRAPPER_NAME.test(fn.text)) return addCall(api, first, /fetch/i.test(fn.text) ? methodOption(second) : undefined, line, true);
    return;
  }
  if (fn?.type !== "member_expression") return;
  const object = fn.childForFieldName("object");
  const prop = fn.childForFieldName("property")?.text ?? "";
  if (!object) return;
  const isRouter = object.type !== "identifier" || api.routers.has(object.text) || ROUTER_NAME.test(object.text);
  if (prop === "use" && isRouter && object.type === "identifier") {
    const all = args(node);
    const target = all.length ? mountTarget(all.at(-1)!) : undefined;
    const prefix = first?.type === "string" && all.length > 1 ? unquote(first) : "";
    if (target) api.mounts.push({ prefix, on: object.text, target, line });
    return;
  }
  // xhr.open("POST", url)
  if (prop === "open" && first?.type === "string" && METHOD_NAMES.has(unquote(first).toLowerCase())) {
    return addCall(api, second, unquote(first).toUpperCase(), line);
  }
  if (!METHOD_NAMES.has(prop)) return;
  if (object.type === "identifier" && CLIENT_NAME.test(object.text) && !api.routers.has(object.text)) {
    return addCall(api, first, prop === "all" ? undefined : prop.toUpperCase(), line, object.text !== "axios");
  }
  const route = isRouter ? routeOf(object, node) : undefined;
  if (route && args(node).length > (object.type === "identifier" ? 1 : 0)) {
    for (const path of stringValues(route.path) ?? []) {
      api.routes.push({ method: prop.toUpperCase(), path, router: route.router, line });
    }
  }
}

// Next.js: app/api/users/[id]/route.ts exporting GET, POST...; pages/api/users.ts.
const APP_ROUTE = /(?:^|\/)app\/(.*?)\/?route\.[cm]?[jt]sx?$/;
const PAGES_API = /(?:^|\/)pages\/(api\/.*?)(?:\/index)?\.[cm]?[jt]sx?$/;

function fileRoutes(root: Node, file: string, api: FileApi): void {
  const app = APP_ROUTE.exec(file);
  const pages = PAGES_API.exec(file);
  if (!app && !pages) return;
  const folders = (app?.[1] ?? pages![1]!).split("/").filter((f) => f && !/^\(.*\)$|^@/.test(f)); // (group), @slot
  const path = `/${folders.join("/")}`;
  api.routers.set("", { prefix: "", isApp: true });
  if (pages) return void api.routes.push({ method: "ALL", path, router: "", line: 1 });
  for (const node of root.namedChildren) {
    if (node.type !== "export_statement") continue;
    for (const n of descendants(node)) {
      const name = (n.type === "function_declaration" || n.type === "variable_declarator") ? n.childForFieldName("name")?.text : undefined;
      if (name && (HTTP_METHODS as readonly string[]).includes(name)) api.routes.push({ method: name, path, router: "", line: n.startPosition.row + 1 });
    }
  }
}

export function extractJsApi(root: Node, file: string): FileApi {
  const api = emptyApi();
  findRouters(root, api);
  findBindings(root, api);
  fileRoutes(root, file, api);
  for (const node of descendants(root)) {
    if (node.type === "call_expression") visitCall(node, api);
    else if (node.type === "new_expression" && node.childForFieldName("constructor")?.text === "EventSource") {
      const url = node.childForFieldName("arguments")?.namedChildren[0];
      addCall(api, url, "GET", node.startPosition.row + 1);
    }
  }
  return api;
}
