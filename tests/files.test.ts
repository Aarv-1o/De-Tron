import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { isSource, listRepoFiles } from "../src/index/files.ts";

const sourceFiles = async (root: string) => (await listRepoFiles(root)).filter(isSource);

async function makeRepo(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "detron-"));
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return root;
}

const FILES = {
  "src/app.ts": "",
  "src/ui/Page.tsx": "",
  "server/main.py": "",
  "README.md": "",
  "public/vendor.min.js": "",
  "node_modules/lib/index.js": "",
  "dist/bundle.js": "",
};

test("outside git: walks the folder and skips junk folders", async () => {
  const root = await makeRepo(FILES);
  assert.deepEqual(await sourceFiles(root), ["server/main.py", "src/app.ts", "src/ui/Page.tsx"]);
});

test("inside git: follows .gitignore, including untracked files", async () => {
  const root = await makeRepo({ ...FILES, ".gitignore": "dist/\nnode_modules/\ngenerated/\n", "generated/api.ts": "" });
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["add", "src/app.ts"], { cwd: root });
  assert.deepEqual(await sourceFiles(root), ["server/main.py", "src/app.ts", "src/ui/Page.tsx"]);
});
