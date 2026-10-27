import { HOLE } from "./paths.ts";
import { definedIn, type Repo } from "./resolve.ts";
import type { ApiCall } from "./types.ts";

// A call's full URL, once everything in the repo is known: the base URL of the client it's
// made on (maybe created in another file) and the dev-server proxy it goes through.

const isFullUrl = (url: string) => /^\w+:\/\//.test(url);
const join = (base: string, path: string) => `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;

function clientBase(file: string, name: string, repo: Repo): string | undefined {
  const local = repo.apis.get(file)?.clients.get(name);
  if (local !== undefined) return local;
  const from = definedIn(file, name, repo);
  return from ? repo.apis.get(from.file)?.clients.get(from.name ?? "default") : undefined;
}

// Vite's proxy: "/api/users" may reach the backend as "/users".
function throughProxy(url: string, repo: Repo): string {
  if (isFullUrl(url) || url.startsWith(HOLE)) return url;
  for (const api of repo.apis.values()) {
    for (const { prefix, to } of api.proxies) {
      if (url === prefix || url.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`)) return to + url.slice(prefix.length);
    }
  }
  return url;
}

// undefined: not a call to this app after all (a method on some other object).
export function callUrl(call: ApiCall, file: string, repo: Repo): string | undefined {
  let url = call.url;
  if (call.via && !isFullUrl(url)) {
    const base = clientBase(file, call.via.name, repo);
    if (base !== undefined) url = join(base, url);
    else if (call.via.client && url.startsWith("/")) url = HOLE + url; // a client made somewhere we can't see
    else return undefined;
  }
  return throughProxy(url, repo);
}
