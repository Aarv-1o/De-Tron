import type { Node } from "web-tree-sitter";
import type { FileApi } from "../rules/crossStack/types.ts";
import { descendants } from "./nodes.ts";

// Django: urlpatterns lists of path()/re_path()/url(), include() of other apps' urls, and
// Django REST Framework routers (router.register("articles", ArticleViewSet)).

const PATTERN = "urlpatterns";
const DRF_ROUTER = /^(DefaultRouter|SimpleRouter|ExtendedSimpleRouter)$/;

function text(node: Node | undefined): string | undefined {
  if (node?.type !== "string") return undefined;
  const parts = node.namedChildren;
  if (parts.some((p) => p.type === "interpolation")) return undefined;
  return parts.filter((p) => p.type === "string_content").map((p) => p.text).join("");
}

// r"^articles/(?P<slug>[-\w]+)/?$" -> "articles/:slug". undefined for regexes we can't turn into a path.
export function regexToPath(regex: string): string | undefined {
  const path = regex
    .replace(/^\^/, "")
    .replace(/\$$/, "")
    .replace(/\/\?$/, "/")
    .replace(/\(\?P<(\w+)>(?:[^()]|\[[^\]]*\])*\)/g, ":$1");
  return /[\\[\]()*+?|^$]/.test(path) ? undefined : path;
}

const argsOf = (call: Node) => call.childForFieldName("arguments")?.namedChildren.filter((a) => a.type !== "comment") ?? [];

// include("app.urls") -> "require:app.urls"; include(router.urls) -> "router".
function includeTarget(view: Node): string | undefined {
  if (view.type !== "call" || view.childForFieldName("function")?.text !== "include") return undefined;
  const target = argsOf(view)[0];
  const module = text(target);
  if (module) return `require:${module}:${PATTERN}`; // that app's urlpatterns
  return target?.type === "attribute" && target.childForFieldName("attribute")?.text === "urls" ? target.childForFieldName("object")?.text : undefined;
}

function patternEntry(entry: Node, api: FileApi): void {
  const fn = entry.childForFieldName("function")?.text;
  if (fn !== "path" && fn !== "re_path" && fn !== "url") return;
  const [route, view] = argsOf(entry);
  const raw = text(route);
  if (raw === undefined || !view) return;
  const path = fn === "path" ? raw : regexToPath(raw);
  if (path === undefined) return;
  const line = entry.startPosition.row + 1;
  if (view.text === "admin.site.urls") return; // Django's admin: pages people open, not an API
  const target = includeTarget(view);
  if (target) api.mounts.push({ prefix: path, on: PATTERN, target, line });
  else api.routes.push({ method: "ALL", path, router: PATTERN, line }); // a view takes every method it handles
}

// urlpatterns = [...] and router = DefaultRouter()
function assignment(node: Node, api: FileApi): void {
  const left = node.childForFieldName("left")?.text;
  const right = node.childForFieldName("right");
  if (left === PATTERN && right?.type === "list") {
    // Never mounted: it's the root URLconf. Mounted: include() sets its prefix.
    api.routers.set(PATTERN, { prefix: "", isApp: true });
    for (const entry of right.namedChildren) if (entry.type === "call") patternEntry(entry, api);
  }
  const callee = right?.type === "call" ? right.childForFieldName("function")?.text.split(".").at(-1) : undefined;
  if (left && callee && DRF_ROUTER.test(callee)) api.routers.set(left, { prefix: "", isApp: false });
}

// router.register(r"articles", ArticleViewSet): a list route and a detail route.
function register(call: Node, api: FileApi): void {
  const fn = call.childForFieldName("function");
  const router = fn?.type === "attribute" ? fn.childForFieldName("object")?.text : undefined;
  const prefix = text(argsOf(call)[0]);
  if (!router || fn?.childForFieldName("attribute")?.text !== "register" || !api.routers.has(router) || prefix === undefined) return;
  const line = call.startPosition.row + 1;
  const base = regexToPath(prefix) ?? prefix;
  api.routes.push({ method: "ALL", path: base, router, line }, { method: "ALL", path: `${base}/:pk`, router, line });
}

export function djangoRoutes(root: Node, api: FileApi): void {
  for (const node of descendants(root)) {
    if (node.type === "assignment" || node.type === "augmented_assignment") assignment(node, api);
    else if (node.type === "call") register(node, api);
  }
}
