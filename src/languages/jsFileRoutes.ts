import type { Node } from "web-tree-sitter";
import { HTTP_METHODS, type FileApi } from "../rules/crossStack/types.ts";
import { args } from "./jsRoutes.ts";
import { descendants, unquote } from "./nodes.ts";

// Frameworks whose routes come from where the code sits, not from method calls:
// Next.js (the file's path) and NestJS (decorators on a controller class).

// Next.js: app/api/users/[id]/route.ts exporting GET, POST...; pages/api/users.ts.
const APP_ROUTE = /(?:^|\/)app\/(.*?)\/?route\.[cm]?[jt]sx?$/;
const PAGES_API = /(?:^|\/)pages\/(api\/.*?)(?:\/index)?\.[cm]?[jt]sx?$/;

export function nextRoutes(root: Node, file: string, api: FileApi): void {
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

const NEST_METHODS: Record<string, string> = { Get: "GET", Post: "POST", Put: "PUT", Patch: "PATCH", Delete: "DELETE", All: "ALL" };

// @Get(":id") -> { name: "Get", path: ":id" }. @Controller({ path: "x" }) works too.
function decoratorCall(decorator: Node): { name: string; path: string } | undefined {
  const call = decorator.namedChildren[0];
  if (call?.type !== "call_expression") return undefined;
  const name = call.childForFieldName("function")?.text ?? "";
  const arg = args(call)[0];
  if (!arg) return { name, path: "" };
  if (arg.type === "string") return { name, path: unquote(arg) };
  const pathPair = arg.type === "object" ? arg.namedChildren.find((p) => p.childForFieldName("key")?.text === "path") : undefined;
  const value = pathPair?.childForFieldName("value");
  return value?.type === "string" ? { name, path: unquote(value) } : undefined; // a path from a variable: can't place it
}

// The decorators right before a node: class decorators sit on it (or its export), member
// decorators are the class body's children just before the method.
function decoratorsBefore(node: Node): Node[] {
  const own = [...node.namedChildren, ...(node.parent?.type === "export_statement" ? node.parent.namedChildren : [])];
  const found = own.filter((c) => c.type === "decorator");
  for (let prev = node.previousNamedSibling; prev?.type === "decorator"; prev = prev.previousNamedSibling) found.push(prev);
  return found;
}

// app.setGlobalPrefix("api") in main.ts: every controller's routes start with it.
export function nestGlobalPrefix(prop: string, call: Node, api: FileApi): boolean {
  if (prop !== "setGlobalPrefix") return false;
  const arg = args(call)[0];
  if (arg?.type === "string") api.globalPrefix = unquote(arg);
  return true;
}

export function nestRoutes(root: Node, api: FileApi): void {
  for (const cls of descendants(root)) {
    if (cls.type !== "class_declaration") continue;
    const controller = decoratorsBefore(cls).map(decoratorCall).find((d) => d?.name === "Controller");
    const name = cls.childForFieldName("name")?.text;
    if (!controller || !name) continue;
    api.routers.set(name, { prefix: controller.path, isApp: true, global: true });
    for (const member of cls.childForFieldName("body")?.namedChildren ?? []) {
      if (member.type !== "method_definition") continue;
      for (const d of decoratorsBefore(member).map(decoratorCall)) {
        const method = d && NEST_METHODS[d.name];
        if (method) api.routes.push({ method, path: d.path, router: name, line: member.startPosition.row + 1, handler: member.childForFieldName("name")?.text ?? "" });
      }
    }
  }
}
