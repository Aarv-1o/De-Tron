import type { Confidence } from "../confidence.ts";
import { hasParams, isCatchAll, parsePath, reaches, type ApiPath } from "./paths.ts";
import { fullRoutes, type FullRoute } from "./resolve.ts";
import type { ImportInfo } from "../../index/usage.ts";
import type { ApiCall, FileApi } from "./types.ts";

// Frontend and backend drift apart: the frontend calls a route that was renamed or never
// written, or the backend keeps routes nothing calls any more.

export interface MissingRoute {
  kind: "missing-route" | "wrong-method";
  confidence: Confidence;
  file: string;
  line: number;
  method: string | undefined;
  path: ApiPath;
  closest?: FullRoute; // missing-route: the route it most likely meant; wrong-method: the one with that path
}

export interface UnusedRoute {
  confidence: Confidence;
  route: FullRoute;
}

export interface CrossStack {
  routes: number;
  calls: number;
  missing: MissingRoute[];
  unused: UnusedRoute[];
}

// Called from outside the app (Stripe, Google, cron, uptime checks, browser redirects), never by its own frontend.
const CALLED_FROM_OUTSIDE = /webhook|callback|oauth|redirect|health|status|ping|cron|tick|docs|openapi|metrics|verify|stream/i;

const methodFits = (call: string | undefined, route: string) => !call || route === "ALL" || call === route;

// The route a call probably meant: same length, most segments in common, at least half.
function closestRoute(path: ApiPath, routes: FullRoute[]): FullRoute | undefined {
  let best: FullRoute | undefined;
  let bestScore = 0;
  for (const route of routes) {
    if (route.path.unknownPrefix || route.path.segments.length !== path.segments.length) continue;
    const score = route.path.segments.filter((s, i) => s === path.segments[i]).length;
    if (score > bestScore && score >= path.segments.length / 2) [best, bestScore] = [route, score];
  }
  return best;
}

// The routes a call reaches. A literal segment beats a parameter: `${id}` only stands in for
// "/export" when no route takes a parameter there.
function routesFor(path: ApiPath, routes: FullRoute[]): FullRoute[] {
  const strict = routes.filter((r) => reaches(path, r.path, "strict"));
  return strict.length ? strict : routes.filter((r) => reaches(path, r.path));
}

function checkCall(call: ApiCall & { file: string }, hits: FullRoute[], path: ApiPath, routes: FullRoute[]): MissingRoute | undefined {
  if (hits.some((r) => methodFits(call.method, r.method))) return undefined;
  const base = { file: call.file, line: call.line, method: call.method, path };
  if (hits.length) return { kind: "wrong-method", confidence: "likely", ...base, closest: hits[0]! };
  // Sure of the namespace (it's under /api like the real routes)? Then likely; otherwise it
  // may go to a server that isn't in this repo.
  const namespace = path.segments[0];
  const sameNamespace = !path.unknownPrefix && routes.some((r) => !r.path.unknownPrefix && r.path.segments[0] === namespace);
  const closest = closestRoute(path, routes);
  return { kind: "missing-route", confidence: sameNamespace ? "likely" : "maybe", ...base, ...(closest ? { closest } : {}) };
}

// `imports`: each file's imports, to follow routers mounted from other files.
export function findCrossStack(
  apis: Map<string, FileApi>, imports: Map<string, ImportInfo[]>, extraCalls: (ApiCall & { file: string })[] = [],
): CrossStack {
  const routes = fullRoutes(apis, imports).filter((r) => !isCatchAll(r.path));
  const calls = [...[...apis].flatMap(([file, api]) => api.calls.map((c) => ({ ...c, file }))), ...extraCalls]
    .map((call) => ({ call, path: parsePath(call.url) }))
    .filter((c): c is { call: ApiCall & { file: string }; path: ApiPath } => !!c.path);
  // No backend in the repo, or no frontend calling it: nothing to compare.
  if (!routes.length || !calls.length) return { routes: routes.length, calls: calls.length, missing: [], unused: [] };

  const reached = calls.map(({ call, path }) => ({ call, path, hits: routesFor(path, routes) }));
  const missing = reached.flatMap(({ call, path, hits }) => checkCall(call, hits, path, routes) ?? []);
  // A page a form posts back to (GET /login) is opened by a link, not a call: any call to the same
  // fixed path counts.
  const page = (r: FullRoute) => r.method === "GET" && !hasParams(r.path);
  const mentioned = new Set(
    [...apis.values()].flatMap((api) => api.mentions.flatMap((m) => {
      const path = parsePath(m);
      return path ? routes.filter((r) => reaches(path, r.path, "exact")) : [];
    })),
  );
  const uses = (r: FullRoute) =>
    reached.some(({ call, hits }) => hits.includes(r) && (methodFits(call.method, r.method) || page(r))) ||
    ((r.method === "GET" || r.method === "ALL") && mentioned.has(r));
  const unused = routes
    .filter((r) => !r.path.unknownPrefix && r.path.segments.length && !CALLED_FROM_OUTSIDE.test(r.path.text))
    .filter((r) => !uses(r))
    .map((route): UnusedRoute => {
      // The frontend uses other routes from the same file, just not this one: likely left behind.
      // A file nothing calls at all may serve another client (a mobile app, a script).
      const siblingsUsed = routes.some((r) => r.file === route.file && r !== route && uses(r));
      return { confidence: siblingsUsed ? "likely" : "maybe", route };
    });
  return { routes: routes.length, calls: calls.length, missing, unused };
}
