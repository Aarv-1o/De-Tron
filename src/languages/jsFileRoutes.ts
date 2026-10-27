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
  // Checks inside the handler (getServerSession(), auth()) are its guards: keep its code.
  const body = (n: Node) => n.text.slice(0, MAX_BODY);
  if (pages) {
    const handler = root.namedChildren.find((n) => n.type === "export_statement" && n.children.some((c) => c.type === "default"));
    return void api.routes.push({ method: "ALL", path, router: "", line: 1, guards: [], ...(handler ? { body: body(handler) } : {}) });
  }
  for (const node of root.namedChildren) {
    if (node.type !== "export_statement") continue;
    for (const n of descendants(node)) {
      const name = (n.type === "function_declaration" || n.type === "variable_declarator") ? n.childForFieldName("name")?.text : undefined;
      if (name && (HTTP_METHODS as readonly string[]).includes(name)) {
        api.routes.push({ method: name, path, router: "", line: n.startPosition.row + 1, guards: [], body: body(n) });
      }
    }
  }
}

const MAX_BODY = 4000;
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
// app.useGlobalGuards(new AuthGuard()): every route is guarded.
export function nestGlobalPrefix(prop: string, call: Node, api: FileApi): boolean {
  if (prop === "useGlobalGuards") {
    api.globalGuards.push(...args(call).map((a) => a.text.slice(0, 80)));
    return true;
  }
  if (prop !== "setGlobalPrefix") return false;
  const arg = args(call)[0];
  if (arg?.type === "string") api.globalPrefix = unquote(arg);
  return true;
}

// NestJS middleware applied in a module: consumer.apply(...) then forRoutes() with paths, a
// { path, method } object, or a controller class.
export function nestMiddleware(root: Node, api: FileApi): void {
  for (const node of descendants(root)) {
    if (node.type !== "call_expression" || !/\.forRoutes$/.test(node.childForFieldName("function")?.text ?? "")) continue;
    const applied = /\.apply\(([^)]*)\)/.exec(node.childForFieldName("function")!.text)?.[1];
    if (!applied) continue;
    const names = applied.split(",").map((s) => s.trim()).filter(Boolean);
    for (const arg of args(node)) {
      if (arg.type === "object") {
        const path = /path\s*:\s*["'`]([^"'`]*)/.exec(arg.text)?.[1];
        const method = /RequestMethod\.(\w+)/.exec(arg.text)?.[1] ?? "ALL";
        if (path !== undefined) api.pathGuards.push({ path, method, names });
      } else if (arg.type === "string") api.pathGuards.push({ path: unquote(arg), method: "ALL", names });
      else api.pathGuards.push({ path: `controller:${arg.text}`, method: "ALL", names });
    }
  }
}

// { provide: APP_GUARD, useClass: JwtAuthGuard } in a module: a global guard too.
export function nestAppGuards(root: Node, api: FileApi): void {
  for (const node of descendants(root)) {
    if (node.type !== "object" || !/\bprovide\s*:\s*APP_GUARD\b/.test(node.text)) continue;
    const use = /useClass\s*:\s*(\w+)/.exec(node.text)?.[1];
    api.globalGuards.push(use ?? "APP_GUARD");
  }
}

// @UseGuards(AuthGuard("jwt"), RolesGuard) and @Roles("admin"): what guards a controller or method.
const guardsOf = (decorators: Node[]) =>
  decorators.map((d) => d.namedChildren[0]).filter((c) => c && /^(UseGuards|Roles|Public|SetMetadata)\b/.test(c.text)).map((c) => c!.text.slice(0, 80));

export function nestRoutes(root: Node, api: FileApi): void {
  for (const cls of descendants(root)) {
    if (cls.type !== "class_declaration") continue;
    const controller = decoratorsBefore(cls).map(decoratorCall).find((d) => d?.name === "Controller");
    const name = cls.childForFieldName("name")?.text;
    if (!controller || !name) continue;
    api.routers.set(name, { prefix: controller.path, isApp: true, global: true });
    const classGuards = guardsOf(decoratorsBefore(cls));
    for (const member of cls.childForFieldName("body")?.namedChildren ?? []) {
      if (member.type !== "method_definition") continue;
      const decorators = decoratorsBefore(member);
      const guards = [...classGuards, ...guardsOf(decorators)];
      for (const d of decorators.map(decoratorCall)) {
        const method = d && NEST_METHODS[d.name];
        if (method) {
          api.routes.push({
            method, path: d.path, router: name, line: member.startPosition.row + 1,
            handler: member.childForFieldName("name")?.text ?? "", guards, body: member.text.slice(0, MAX_BODY),
          });
        }
      }
    }
  }
}
