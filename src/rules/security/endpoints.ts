import type { FunctionInfo } from "../../index/functions.ts";
import type { Confidence } from "../confidence.ts";
import type { FullRoute } from "../crossStack/resolve.ts";
import type { LineFinding } from "../line/types.ts";

// Every endpoint, checked for what AI-built apps most often get wrong (broken access control is
// the #1 critical class in 2025-2026 scans): no auth on a route that changes data, an admin route
// any logged-in user can call, records fetched by id without checking who owns them, and login
// routes anyone can hammer.

// Middleware, dependencies and decorators that authenticate.
const AUTH_GUARD = /auth|protect|require_?(login|user|session|admin)|ensure_?(auth|logged|login)|logged_?in|is_?authenticated|verify_?(token|jwt|user|session)|jwt|passport|login_required|current_\w*user|currentuser|superuser|permission|guard|session|clerk|bearer/i;
// Checks written inside the handler.
const AUTH_INLINE = /jwt\.verify|verify_?token|verifyIdToken|getServerSession|getSession\(|\bauth\(\)|currentUser\(|getToken\(|headers\.authorization|headers\[["']authorization|supabase\.auth\.getUser|request\.user\b|req\.user\b|ctx\.state\.user|get_current_user|current_user/i;
const ADMIN = /admin|role|staff|superuser|Roles\(/i;
// Explicitly public: a decision, not an oversight.
const PUBLIC_MARK = /AllowAny|@?Public\(|permitAll|allow_?anonymous|skip_?auth/i;
// Routes meant to be called without logging in.
const PUBLIC_PATH = /\/(login|log-in|signin|sign-in|signup|sign-up|register|logout|forgot|reset|verify|confirm|callback|oauth|webhooks?|health|healthz|status|ping|public|contact|subscribe|newsletter|waitlist|track|docs|openapi|robots|sitemap|feed|rss|tick|cron|token|refresh|google|github|magic-link|otp)(\/|$)/i;
// Reads that are private data when they're open.
const PRIVATE_READ = /\/(users?|admin|orders?|payments?|invoices?|messages?|export|accounts?|customers?|me|profile|settings|keys|tokens|secrets|billing|transactions?)(\/|$)/i;
const LOGIN_PATH = /\/(login|log-in|signin|sign-in|signup|sign-up|register|forgot|reset|otp|verify|magic-link|password)(\/|$|-)/i;
const RATE_LIMIT = /limit|throttl|slow_?down|brute/i;
// A record fetched by an id from the URL.
const BY_ID = /\.(findById|findByIdAndUpdate|findByIdAndDelete|findByIdAndRemove|findByPk|findUnique|findOne|findFirst|get|delete|update|destroy)\w*\(\s*[^)]*(req\.params|params\.\w+|params\[|\bid\b|_id\b|item_id|\w+_id\b)/;
// Signs the lookup is scoped to the caller: their id in the query, or a check after it.
const SCOPED = /req\.user|req\.userId|userId|user_id|owner|current_user|currentUser|session\.user|ctx\.state\.user|request\.user|author|createdBy|created_by|tenant|org(anization)?_?id|account_?id|isAdmin|is_superuser|role/;

const WRITE = new Set(["POST", "PUT", "PATCH", "DELETE", "ALL"]);

export interface EndpointInput {
  routes: FullRoute[];
  functions: FunctionInfo[];
  texts: Map<string, string>; // source of the files, for named handlers
  rateLimitLibrary: boolean; // express-rate-limit, slowapi... imported somewhere
  allFiles: string[]; // to tell apps apart in a repo of several (examples, monorepos)
}

// The app a file belongs to: the deepest folder above it with a package.json or Python project file.
function appOf(files: string[]): (file: string) => string {
  const roots = files
    .filter((f) => /(^|\/)(package\.json|pyproject\.toml|requirements\.txt|manage\.py)$/.test(f))
    .map((f) => (f.includes("/") ? f.slice(0, f.lastIndexOf("/") + 1) : ""))
    .sort((a, b) => b.length - a.length);
  return (file) => roots.find((r) => file.startsWith(r)) ?? "";
}

// The code that handles a route: inline, or the named function (controller) it points at.
function handlerCode(route: FullRoute, functions: FunctionInfo[], texts: Map<string, string>): string {
  if (route.body) return route.body;
  const name = route.handler?.split(".").at(-1);
  if (!name) return "";
  const fn = functions.find((f) => f.name === name && f.file === route.file) ?? functions.find((f) => f.name === name);
  if (fn) return texts.get(fn.file)?.split("\n").slice(fn.startLine - 1, fn.endLine).join("\n") ?? "";
  // Wrapped handlers aren't functions by name: const getOrder = asyncHandler(async (req, res) => {...}).
  // Take the declaration up to the next line that starts at column 0.
  const declared = new RegExp(`^(export\\s+)?(const|let|var)\\s+${name}\\s*=`);
  for (const text of texts.values()) {
    const lines = text.split("\n");
    const start = lines.findIndex((l) => declared.test(l));
    if (start === -1) continue;
    const end = lines.findIndex((l, i) => i > start && /^\S/.test(l) && !/^[)}\]]/.test(l));
    return lines.slice(start, end === -1 ? undefined : end + 1).join("\n");
  }
  return "";
}

const hasParam = (route: FullRoute) => route.path.segments.includes("*");

export function findEndpointIssues({ routes, functions, texts, rateLimitLibrary, allFiles }: EndpointInput): LineFinding[] {
  const found: LineFinding[] = [];
  const add = (route: FullRoute, rule: string, confidence: Confidence, message: string) =>
    found.push({ rule, file: route.file, line: route.line, confidence, message });
  const code = new Map(routes.map((r) => [r, handlerCode(r, functions, texts)]));
  const authed = (r: FullRoute) => r.guards.some((g) => AUTH_GUARD.test(g)) || AUTH_INLINE.test(code.get(r)!);
  // "Other routes check auth" only counts within the same app.
  const app = appOf(allFiles);
  const appsWithAuth = new Set(routes.filter(authed).map((r) => app(r.file)));
  const appHasAuthFor = (r: FullRoute) => appsWithAuth.has(app(r.file));
  // Files where some handler scopes records to the caller: there, one that doesn't is an oversight.
  const unparam = (text: string) => text.replace(/\b(req|request)\.params\b/g, "");
  const scopingFiles = new Set(routes.filter((r) => SCOPED.test(unparam(code.get(r)!))).map((r) => r.file));
  const label = (r: FullRoute) => `${r.method} ${r.path.text}`;

  for (const route of routes) {
    if (route.path.unknownPrefix && route.path.segments.length < 2) continue;
    const body = code.get(route)!;
    // POST /users (no id) is sign-up in REST style: public, but it needs a rate limit.
    const signUp = route.method === "POST" && /\/(users|accounts|members)$/i.test(route.path.text);
    const isPublic = signUp || PUBLIC_PATH.test(route.path.text) || route.guards.some((g) => PUBLIC_MARK.test(g)) || PUBLIC_MARK.test(body);
    const isAuthed = authed(route);
    const isAdmin = /\/admin(\/|$)/i.test(route.path.text);

    if (!isAuthed && !isPublic && appHasAuthFor(route)) {
      if (WRITE.has(route.method)) add(route, "unauthenticated-route", "likely", `${label(route)} changes data, and nothing checks who's calling (other routes do)`);
      else if (PRIVATE_READ.test(route.path.text) || isAdmin) add(route, "unauthenticated-route", "likely", `${label(route)} returns private data, and nothing checks who's calling (other routes do)`);
    }
    if (isAdmin && isAuthed && !route.guards.some((g) => ADMIN.test(g)) && !/\b(role|isAdmin|is_admin|is_staff|is_superuser|admin)\b/.test(body)) {
      add(route, "admin-without-role", "likely", `${label(route)} checks that the caller is logged in, not that they're an admin`);
    }
    const adminOnly = isAdmin || route.guards.some((g) => ADMIN.test(g));
    if (isAuthed && !adminOnly && hasParam(route) && body && BY_ID.test(body) && !SCOPED.test(unparam(body))) {
      const confidence = scopingFiles.has(route.file) ? "likely" : "maybe";
      add(route, "missing-ownership-check", confidence, `${label(route)} loads a record by the id in the URL without checking it belongs to the caller`);
    }
    // Only what anyone can call: a logged-in route can't be brute-forced by strangers.
    if (route.method !== "GET" && !isAuthed && (signUp || LOGIN_PATH.test(route.path.text)) && !route.guards.some((g) => RATE_LIMIT.test(g))) {
      add(route, "auth-without-rate-limit", rateLimitLibrary ? "maybe" : "likely", `${label(route)} has no rate limit: passwords and codes can be guessed by brute force`);
    }
  }
  // Once per app with no auth at all.
  const reported = new Set<string>();
  for (const r of routes) {
    if (appHasAuthFor(r) || !WRITE.has(r.method) || PUBLIC_PATH.test(r.path.text) || reported.has(app(r.file))) continue;
    reported.add(app(r.file));
    add(r, "no-auth-at-all", "maybe", `No route in this app checks who's calling: anyone can call every endpoint`);
  }
  return found;
}
