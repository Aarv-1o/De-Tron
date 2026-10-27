import type { Node } from "web-tree-sitter";
import { HOLE } from "../rules/crossStack/paths.ts";
import { HTTP_METHODS, type FileApi } from "../rules/crossStack/types.ts";
import { stringValues } from "./jsValues.ts";
import { descendants, unquote } from "./nodes.ts";

// Routes and mounts for the frameworks that declare routes as method calls:
// Express, Koa (koa-router), Hono and Fastify. They differ in how routers are made and mounted.

export const METHOD_NAMES = new Set([...HTTP_METHODS.map((m) => m.toLowerCase()), "all"]);
// When a router isn't created in the file (it's a parameter, like a Fastify plugin's), go by its name.
export const ROUTER_NAME = /^(app|server|router|fastify|instance|\w+Router)$/;

export const args = (call: Node) => call.childForFieldName("arguments")?.namedChildren.filter((a) => a.type !== "comment") ?? [];

export function objectProp(object: Node | undefined, key: string): Node | undefined {
  if (object?.type !== "object") return undefined;
  const pair = object.namedChildren.find((p) => p.type === "pair" && p.childForFieldName("key")?.text.replace(/['"]/g, "") === key);
  return pair?.childForFieldName("value") ?? undefined;
}

const stringProp = (object: Node | undefined, key: string) => {
  const value = objectProp(object, key);
  return value?.type === "string" ? unquote(value) : undefined;
};

// What creates a router or app: express(), Router(), new Router({ prefix }), new Hono().basePath("/api"), Fastify().
function routerOf(value: Node): { prefix: string; isApp: boolean } | undefined {
  let node = value;
  let prefix = "";
  if (node.type === "call_expression") {
    const fn = node.childForFieldName("function");
    if (fn?.type === "member_expression" && fn.childForFieldName("property")?.text === "basePath") {
      const arg = args(node)[0];
      prefix = arg?.type === "string" ? unquote(arg) : "";
      node = fn.childForFieldName("object")!;
    }
  }
  const callee = (node.type === "new_expression" ? node.childForFieldName("constructor") : node.childForFieldName("function"))?.text;
  if (node.type !== "call_expression" && node.type !== "new_expression") return undefined;
  if (callee === "express" || /^[Ff]astify$/.test(callee ?? "") || callee === "Koa") return { prefix, isApp: true };
  // A Hono instance is an app until something mounts it.
  if (callee === "Hono") return { prefix, isApp: true };
  if (/^(express\.)?Router$/.test(callee ?? "")) {
    return { prefix: stringProp(args(node)[0], "prefix") ?? "", isApp: false };
  }
  return undefined;
}

export function findRouters(root: Node, api: FileApi): void {
  for (const node of descendants(root)) {
    if (node.type !== "variable_declarator") continue;
    const value = node.childForFieldName("value");
    const name = node.childForFieldName("name")?.text;
    const router = value && name ? routerOf(value) : undefined;
    if (router) api.routers.set(name!, router);
  }
}

// What a mount points at: `authRouter`, `createAuthRouter(User)`, `require("./auth")`,
// `import("./auth")` (Fastify) or `users.routes()` (Koa).
function mountTarget(node: Node): string | undefined {
  if (node.type === "identifier") return node.text;
  if (node.type === "await_expression") return node.namedChildren[0] ? mountTarget(node.namedChildren[0]) : undefined;
  if (node.type !== "call_expression") return undefined;
  const fn = node.childForFieldName("function");
  const arg = args(node)[0];
  if ((fn?.text === "require" || fn?.type === "import") && arg?.type === "string") return `require:${unquote(arg)}`;
  if (fn?.type === "member_expression" && /^(routes|middleware)$/.test(fn.childForFieldName("property")?.text ?? "")) {
    const object = fn.childForFieldName("object");
    return object?.type === "identifier" ? object.text : undefined;
  }
  return fn?.type === "identifier" ? fn.text : undefined;
}

// Mounting a router: use() (Express, Koa), route() with a path and a sub-app (Hono), or
// register() with a prefix option (Fastify).
export function mountOf(on: string, prop: string, call: Node, api: FileApi): boolean {
  const all = args(call);
  const line = call.startPosition.row + 1;
  if (prop === "use") {
    const target = all.length ? mountTarget(all.at(-1)!) : undefined;
    const prefix = all[0]?.type === "string" && all.length > 1 ? unquote(all[0]) : "";
    if (target) api.mounts.push({ prefix, on, target, line });
    return true;
  }
  if (prop === "route" && all.length === 2 && all[0]?.type === "string") {
    const target = mountTarget(all[1]!);
    if (target) api.mounts.push({ prefix: unquote(all[0]), on, target, line });
    return true;
  }
  if (prop === "register" && all[0]) {
    const target = mountTarget(all[0]);
    // A prefix from a variable: HOLE, so only the rest of the path is known.
    const prefix = objectProp(all[1], "prefix") ? (stringProp(all[1], "prefix") ?? HOLE) : "";
    if (target) api.mounts.push({ prefix, on, target, line });
    return true;
  }
  return false;
}

// The router at the start of a chain: `router.get(...).post(...)` -> router.
function chainRoot(node: Node): Node | undefined {
  if (node.type === "identifier") return node;
  const fn = node.type === "call_expression" ? node.childForFieldName("function") : undefined;
  const object = fn?.type === "member_expression" ? fn.childForFieldName("object") : undefined;
  return object ? chainRoot(object) : undefined;
}

// The path for `.get(h)` in `router.route("/x").get(h).post(h)` (Express).
function routePathOf(chain: Node): Node | undefined {
  const fn = chain.type === "call_expression" ? chain.childForFieldName("function") : undefined;
  if (fn?.type !== "member_expression") return undefined;
  if (fn.childForFieldName("property")?.text === "route") return args(chain)[0];
  return routePathOf(fn.childForFieldName("object")!);
}

const isPath = (n: Node | undefined) => n?.type === "string" || n?.type === "template_string";

// `router.get("/x", h)`, Koa chains `router.get("/a", h).post("/b", h)`, Express
// `router.route("/x").get(h)`, Fastify `app.route({ method, url })`.
export function routesOf(object: Node, prop: string, call: Node, api: FileApi): void {
  const root = chainRoot(object);
  if (!root) return;
  const line = call.startPosition.row + 1;
  const [first, second] = args(call);
  if (prop === "route" && first?.type === "object") {
    const url = objectProp(first, "url");
    const method = objectProp(first, "method");
    const methods = method?.type === "array" ? method.namedChildren.map(unquote) : method?.type === "string" ? [unquote(method)] : ["ALL"];
    for (const path of url ? stringValues(url) ?? [] : []) {
      for (const m of methods) api.routes.push({ method: m.toUpperCase(), path, router: root.text, line });
    }
    return;
  }
  if (!METHOD_NAMES.has(prop)) return;
  // Its own path needs a handler after it; otherwise the path comes from .route("/x").
  const path = isPath(first) && second ? first : object.type === "identifier" ? undefined : routePathOf(object);
  if (!isPath(path)) return;
  for (const value of stringValues(path!) ?? []) api.routes.push({ method: prop.toUpperCase(), path: value, router: root.text, line });
}
