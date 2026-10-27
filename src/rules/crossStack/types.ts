// What one file says about the HTTP API: the routes it serves and the calls it makes.
// Each language adapter fills this in; the cross-stack check joins all files together.

export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

export interface Route {
  method: string; // GET, POST... or ALL
  path: string; // as written, before any prefix from where its router is mounted
  router: string; // the variable it's declared on: "app", "router"
  line: number;
  handler?: string;
}

// `app.use("/api/auth", authRouter)`, `app.include_router(router, prefix="/v1")`
export interface Mount {
  prefix: string;
  on: string; // the app or router it's mounted on
  target: string; // as written: "authRouter", "createAuthRouter", "chat.router"
  line: number;
}

// A local name that comes from another file: `import { router as chatRouter } from "./chat"`.
export interface Binding {
  source: string; // "./chat", "app.api.chat"
  name: string; // the name in that file: "router", "default"
}

export interface ApiCall {
  method: string | undefined; // undefined: set by a value Detron can't read
  url: string; // with HOLE where a value couldn't be worked out
  line: number;
}

export interface FileApi {
  routes: Route[];
  mounts: Mount[];
  // Routers and apps created in this file, with their own prefix: APIRouter(prefix="/api") -> "/api".
  // `isApp` for the top level (express(), FastAPI(), Flask()): it isn't mounted anywhere.
  routers: Map<string, { prefix: string; isApp: boolean }>;
  bindings: Map<string, Binding>;
  calls: ApiCall[];
}

export const emptyApi = (): FileApi => ({ routes: [], mounts: [], routers: new Map(), bindings: new Map(), calls: [] });
