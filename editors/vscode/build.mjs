// Builds the extension: the extension itself, and Detron (the language server) as one file with
// the tree-sitter grammars next to it, so the extension needs nothing else installed.
import { build } from "esbuild";
import { copyFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDetron } from "../../scripts/build.mjs";

const here = dirname(fileURLToPath(import.meta.url));

await build({ entryPoints: [join(here, "src/extension.ts")], outfile: join(here, "dist/extension.js"), bundle: true, platform: "node", format: "cjs", target: "node20", external: ["vscode"] });
await buildDetron(join(here, "dist/server.mjs"));
await copyFile(join(here, "../../LICENSE"), join(here, "LICENSE")); // the extension package needs its own copy
