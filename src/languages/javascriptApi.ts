import type { Node } from "web-tree-sitter";
import { emptyApi, type FileApi } from "../rules/crossStack/types.ts";
import { findClients, findMentions, visitCallSite } from "./jsCalls.ts";
import { nestAppGuards, nestGlobalPrefix, nestMiddleware, nestRoutes, nextRoutes } from "./jsFileRoutes.ts";
import { findRouters, mountOf, ROUTER_NAME, routesOf } from "./jsRoutes.ts";
import { descendants, unquote } from "./nodes.ts";

// What one JS/TS file says about the HTTP API: routes it serves (Express, Koa, Hono, Fastify,
// NestJS, Next.js), calls it makes, and dev-server proxies (Vite).

function visitMember(node: Node, api: FileApi): void {
  const fn = node.childForFieldName("function");
  if (fn?.type !== "member_expression") return;
  const object = fn.childForFieldName("object");
  const prop = fn.childForFieldName("property")?.text ?? "";
  if (!object) return;
  const isRouter = object.type !== "identifier" || api.routers.has(object.text) || ROUTER_NAME.test(object.text);
  if (!isRouter) return;
  if (object.type === "identifier" && (mountOf(object.text, prop, node, api) || nestGlobalPrefix(prop, node, api))) return;
  routesOf(object, prop, node, api);
}

// vite.config: server.proxy { "/api": { target, rewrite: (p) => p.replace(/^\/api/, "") } }.
const VITE_CONFIG = /(^|\/)vite\.config\.[cm]?[jt]s$/;

function viteProxies(root: Node, api: FileApi): void {
  for (const node of descendants(root)) {
    if (node.type !== "pair" || node.childForFieldName("key")?.text !== "proxy") continue;
    const table = node.childForFieldName("value");
    for (const entry of table?.type === "object" ? table.namedChildren : []) {
      const key = entry.type === "pair" ? entry.childForFieldName("key") : null;
      if (key?.type !== "string") continue;
      const prefix = unquote(key);
      // A rewrite that strips the prefix: path.replace(/^\/api/, "")
      const replace = [...descendants(entry)].find((n) => n.type === "call_expression" && /\.replace$/.test(n.childForFieldName("function")?.text ?? ""));
      const [pattern, to] = replace?.childForFieldName("arguments")?.namedChildren ?? [];
      const strips = pattern?.type === "regex" && pattern.childForFieldName("pattern")?.text.replace(/\\\//g, "/") === `^${prefix}`;
      api.proxies.push({ prefix, to: strips && to?.type === "string" ? unquote(to) : prefix });
    }
  }
}

export function extractJsApi(root: Node, file: string): FileApi {
  const api = emptyApi();
  if (/(^|\/)autohooks\.[cm]?[jt]s$/.test(file)) api.autohooks = true;
  findRouters(root, api);
  findClients(root, api);
  nextRoutes(root, file, api);
  nestRoutes(root, api);
  nestAppGuards(root, api);
  nestMiddleware(root, api);
  if (VITE_CONFIG.test(file)) viteProxies(root, api);
  for (const node of descendants(root)) {
    if (node.type === "call_expression") {
      visitMember(node, api);
      visitCallSite(node, api);
    } else if (node.type === "new_expression") {
      visitCallSite(node, api);
    }
  }
  if (!api.routes.length && !api.mounts.length) findMentions(root, api);
  return api;
}
