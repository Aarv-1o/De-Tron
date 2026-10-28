// Builds the extension: the extension itself, and Detron's language server as one file with the
// tree-sitter grammars next to it, so the extension needs nothing else installed.
import { build } from "esbuild";
import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const detron = join(here, "../..");
const require = createRequire(join(detron, "package.json"));

await build({ entryPoints: [join(here, "src/extension.ts")], outfile: join(here, "dist/extension.js"), bundle: true, platform: "node", format: "cjs", target: "node20", external: ["vscode"] });
await build({
  entryPoints: [join(detron, "src/cli/bin.ts")], outfile: join(here, "dist/server.mjs"), bundle: true, platform: "node", format: "esm", target: "node20",
  // Bundled CommonJS packages call require(): give ESM one.
  banner: { js: "import { createRequire as __detronRequire } from 'node:module'; const require = __detronRequire(import.meta.url);" },
});
await copyFile(join(detron, "LICENSE"), join(here, "LICENSE")); // the extension package needs its own copy
await mkdir(join(here, "dist/wasm"), { recursive: true });
for (const wasm of ["web-tree-sitter/web-tree-sitter.wasm", "tree-sitter-javascript/tree-sitter-javascript.wasm", "tree-sitter-typescript/tree-sitter-typescript.wasm", "tree-sitter-typescript/tree-sitter-tsx.wasm", "tree-sitter-python/tree-sitter-python.wasm"]) {
  await copyFile(require.resolve(wasm), join(here, "dist/wasm", basename(wasm)));
}
