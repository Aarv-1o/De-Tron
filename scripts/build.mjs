// Builds Detron into one file, dist/detron.mjs, with the tree-sitter grammars in dist/wasm next
// to it. That's what hooks run (plain `node`, no TypeScript loader, from any folder), and what
// the editor extension ships as its server.
import { build } from "esbuild";
import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "package.json"));
const WASM = ["web-tree-sitter/web-tree-sitter.wasm", "tree-sitter-javascript/tree-sitter-javascript.wasm", "tree-sitter-typescript/tree-sitter-typescript.wasm", "tree-sitter-typescript/tree-sitter-tsx.wasm", "tree-sitter-python/tree-sitter-python.wasm"];

export async function buildDetron(outFile) {
  await build({
    entryPoints: [join(root, "src/cli/bin.ts")], outfile: outFile, bundle: true, platform: "node", format: "esm", target: "node20",
    banner: {
      js: [
        "#!/usr/bin/env node",
        // Bundled CommonJS packages call require(): give ESM one.
        "import { createRequire as __detronRequire } from 'node:module'; const require = __detronRequire(import.meta.url);",
        // The grammars sit next to this file.
        "import { fileURLToPath as __detronPath } from 'node:url'; process.env.DETRON_WASM_DIR ??= __detronPath(new URL('./wasm', import.meta.url));",
      ].join("\n"),
    },
  });
  await mkdir(join(dirname(outFile), "wasm"), { recursive: true });
  for (const wasm of WASM) await copyFile(require.resolve(wasm), join(dirname(outFile), "wasm", basename(wasm)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await buildDetron(join(root, "dist/detron.mjs"));
