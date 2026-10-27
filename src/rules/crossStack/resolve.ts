import { posix } from "node:path";
import { HOLE, joinPaths, parsePath, type ApiPath } from "./paths.ts";
import type { ImportInfo } from "../../index/usage.ts";
import type { FileApi } from "./types.ts";

// Joins every file's routes and mounts into full paths: a route "/signup" on a router mounted
// at "/api/auth" in another file is POST /api/auth/signup.

export interface FullRoute {
  method: string;
  path: ApiPath; // unknownPrefix when Detron couldn't find where its router is mounted
  file: string;
  line: number;
  handler?: string;
}

const JS_EXTENSIONS = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", "/index.ts", "/index.tsx", "/index.js"];

// The file an import points at, if it's in the repo. "./auth.js" may be auth.ts (TS ESM).
export function resolveModule(from: string, source: string, files: Set<string>): string | undefined {
  if (from.endsWith(".py")) return resolvePython(from, source, files);
  let base: string;
  if (source.startsWith(".")) base = posix.join(posix.dirname(from), source);
  else if (/^[@~]\//.test(source)) base = `src/${source.slice(2)}`;
  else return undefined; // a package
  const stem = base.replace(/\.[cm]?[jt]sx?$/, "");
  return [base, ...JS_EXTENSIONS.map((ext) => stem + ext)].find((f) => files.has(f));
}

function resolvePython(from: string, source: string, files: Set<string>): string | undefined {
  const dots = /^\.*/.exec(source)![0].length;
  const rest = source.slice(dots).replaceAll(".", "/");
  if (dots) {
    let dir = posix.dirname(from);
    for (let i = 1; i < dots; i++) dir = posix.dirname(dir);
    const path = posix.join(dir, rest);
    return [`${path}.py`, `${path}/__init__.py`].find((f) => files.has(f));
  }
  // Absolute: the repo may be scanned from a folder above the project, so match the end.
  const candidates = [`${rest}.py`, `${rest}/__init__.py`];
  return [...files]
    .filter((f) => candidates.some((c) => f === c || f.endsWith(`/${c}`)))
    .sort((a, b) => a.length - b.length)[0];
}

type Key = string; // "file#variable"
const keyOf = (file: string, name: string): Key => `${file}#${name}`;

export interface Repo {
  apis: Map<string, FileApi>;
  imports: Map<string, ImportInfo[]>;
  files: Set<string>;
}

// Where a name used in `file` comes from: `chatRouter` imported from "./chat" as `router`
// is { file: "routes/chat.ts", name: "router" }. `chat.router` (a module's attribute) works too.
export function definedIn(file: string, target: string, { imports, files }: Repo): { file: string; name: string | undefined } | undefined {
  // "require:./auth" (a module), or "require:app.urls:urlpatterns" (a name in it)
  const [, required, requiredName] = /^require:([^:]*)(?::(\w+))?$/.exec(target) ?? [];
  const [local, attribute] = target.split(".");
  let source: string;
  let name: string | undefined;
  if (required) [source, name] = [required, requiredName];
  else {
    const from = imports.get(file)?.find((i) => local! in i.bound);
    if (!from) return undefined;
    const bound = from.bound[local!]!;
    if (attribute) {
      // chat.router, after `from app.api import chat` or `import app.api.chat as chat`
      source = bound === "*" ? from.source : `${from.source}.${bound}`;
      name = attribute;
    } else [source, name] = [from.source, bound];
  }
  const into = resolveModule(file, source, files);
  return into ? { file: into, name } : undefined;
}

// The routers a mount points at: a router in this file, or an imported one (or a factory
// that makes one, or a plugin that's handed one: then the routers in that file).
function mountTargets(file: string, target: string, repo: Repo): Key[] {
  if (repo.apis.get(file)!.routers.has(target)) return [keyOf(file, target)];
  const from = definedIn(file, target, repo);
  const other = from && repo.apis.get(from.file);
  if (!other) return [];
  if (from.name && other.routers.has(from.name)) return [keyOf(from.file, from.name)];
  const routers = [...other.routers];
  const pick = routers.some(([, r]) => !r.isApp) ? routers.filter(([, r]) => !r.isApp) : routers;
  // A Fastify plugin declares routes on the instance it's given: `fastify.get(...)`.
  const names = pick.length ? pick.map(([n]) => n) : [...new Set(other.routes.map((r) => r.router))];
  return names.map((n) => keyOf(from.file, n));
}

export function fullRoutes(repo: Repo): FullRoute[] {
  const { apis } = repo;
  const globalPrefix = [...apis.values()].find((a) => a.globalPrefix !== undefined)?.globalPrefix ?? "";
  const mountedAt = new Map<Key, { on: Key; prefix: string }[]>();
  for (const [file, api] of apis) {
    for (const mount of api.mounts) {
      for (const target of mountTargets(file, mount.target, repo)) {
        const list = mountedAt.get(target) ?? [];
        list.push({ on: keyOf(file, mount.on), prefix: mount.prefix });
        mountedAt.set(target, list);
      }
    }
  }
  // Every full prefix a router is reachable at; undefined when it's never mounted anywhere we can see.
  const prefixes = (key: Key, seen = new Set<Key>()): string[] | undefined => {
    if (seen.has(key)) return undefined;
    seen.add(key);
    const [file, name] = [key.slice(0, key.lastIndexOf("#")), key.slice(key.lastIndexOf("#") + 1)];
    const router = apis.get(file)?.routers.get(name);
    const own = router?.global ? joinPaths(globalPrefix, router.prefix) : (router?.prefix ?? "");
    const parents = (mountedAt.get(key) ?? []).flatMap((m) =>
      (prefixes(m.on, new Set(seen)) ?? []).map((p) => joinPaths(joinPaths(p, m.prefix), own)),
    );
    if (parents.length) return parents;
    return router?.isApp || (!router && name === "app") ? [own] : undefined;
  };

  const routes: FullRoute[] = [];
  for (const [file, api] of apis) {
    for (const route of api.routes) {
      const found = prefixes(keyOf(file, route.router));
      // A prefix with an unknown part (a setting): only what comes after it is known.
      const raws = (found ?? [HOLE]).map((p) => (p.includes(HOLE) ? HOLE + joinPaths(p.split(HOLE).at(-1)!, route.path) : joinPaths(p, route.path)));
      for (const raw of raws) {
        const path = parsePath(raw);
        if (path) routes.push({ method: route.method, path, file, line: route.line, ...(route.handler ? { handler: route.handler } : {}) });
      }
    }
  }
  return routes;
}
