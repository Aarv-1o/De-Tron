import { readFile } from "node:fs/promises";
import { join, posix } from "node:path";
import type { RepoIndex } from "../../index/repo.ts";
import type { Confidence } from "../confidence.ts";

export interface UnusedFile {
  file: string;
  lines: number;
  confidence: Confidence; // never "sure": deleting a file is not a call to make automatically
  reason: string;
}

// Files that run on their own or are loaded by tools, so nothing needs to import them.
const ENTRY = new RegExp(
  [
    String.raw`(^|/)(main|index|app|server|run|cli|manage|setup|wsgi|asgi|conftest|__init__|__main__)\.\w+$`,
    String.raw`\.config\.\w+$`, String.raw`(^|/)\.\w+rc\.\w+$`, String.raw`\.d\.ts$`,
    String.raw`(^|/)(__tests__|tests?|spec|migrations|scripts|bin)/`, String.raw`\.(test|spec)\.\w+$`,
    String.raw`(^|/)test_[^/]*\.py$`, String.raw`_test\.py$`,
  ].join("|"),
);
// With file-based routing, pages are loaded by the framework.
const ROUTING_FRAMEWORKS = ["next", "nuxt", "@remix-run/react", "@sveltejs/kit", "astro", "expo-router"];
const ROUTED = /(^|\/)(pages|app|routes)\//;
const BINARY = /\.(png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|eot|mp[34]|wav|pdf|zip|gz|pem|lock)$|package-lock\.json$/i;

const stemOf = (file: string) => posix.basename(file).replace(/\.[^.]+$/, "");
// An index file is imported by its folder name: "./components/Button" -> components/Button/index.tsx.
const importNameOf = (file: string) => (stemOf(file) === "index" ? posix.basename(posix.dirname(file)) : stemOf(file));

export async function findUnusedFiles(index: RepoIndex): Promise<UnusedFile[]> {
  // Every name an import could point at, and which files import it.
  const importers = new Map<string, Set<string>>();
  const note = (name: string, by: string) => importers.set(name, new Set([...(importers.get(name) ?? []), by]));
  for (const [file, usage] of index.usage) {
    for (const imp of usage.imports) {
      // "./util.js" -> util (TS ESM imports .ts files as .js); "agents.planner" -> planner
      const last = imp.source.includes("/")
        ? posix.basename(imp.source.replace(/\/+$/, "")).replace(/\.[cm]?[jt]sx?$/, "") // keeps auth.service
        : imp.source.split(".").filter(Boolean).pop();
      if (last) note(last, file);
      if (imp.source.startsWith(".") || !imp.source.includes("/")) for (const n of imp.names) note(n, file); // from . import x
    }
  }

  const read = (f: string) => readFile(join(index.root, f), "utf8").catch(() => "");
  const texts = new Map<string, string>();
  for (const f of index.allFiles) if (!BINARY.test(f)) texts.set(f, await read(f));
  const rootManifest = texts.get("package.json") ?? "";
  const routed = ROUTING_FRAMEWORKS.some((fw) => rootManifest.includes(`"${fw}"`));

  // Referenced by path in HTML, scripts, Dockerfiles, notebooks, or strings like "app.main:app".
  const mentionedElsewhere = (file: string): boolean => {
    const noExt = file.replace(/\.[^.]+$/, "");
    const needles = [noExt, posix.basename(file), noExt.replaceAll("/", ".")];
    for (const [other, text] of texts) {
      if (other !== file && needles.some((n) => text.includes(n))) return true;
    }
    return false;
  };

  const unused: UnusedFile[] = [];
  for (const file of index.files) {
    if (ENTRY.test(file) || (routed && ROUTED.test(file))) continue;
    const by = importers.get(importNameOf(file));
    if (by && [...by].some((f) => f !== file)) continue;
    if (mentionedElsewhere(file)) continue;
    const text = texts.get(file) ?? "";
    const lines = text.split("\n").length;
    // A runnable script may be run by hand, but agents leave a lot of one-off experiment scripts behind.
    if (file.endsWith(".py") && /__name__\s*==\s*["']__main__["']/.test(text)) {
      unused.push({ file, lines, confidence: "maybe", reason: "A runnable script nothing refers to. Still needed?" });
    } else {
      unused.push({ file, lines, confidence: "likely", reason: "Nothing imports or mentions this file." });
    }
  }
  return unused;
}
