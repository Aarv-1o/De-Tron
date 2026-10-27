import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildIndex } from "../src/index/repo.ts";
import { findUnusedFiles } from "../src/rules/codebase/unusedFiles.ts";

async function unusedIn(files: Record<string, string>): Promise<string[]> {
  const root = await mkdtemp(join(tmpdir(), "detron-"));
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return (await findUnusedFiles(await buildIndex(root))).map((f) => `${f.confidence} ${f.file}`);
}

test("flags files nothing uses; one-off scripts only as maybe", async () => {
  assert.deepEqual(await unusedIn({
    "src/main.ts": 'import { a } from "./used";\n',
    "src/used.ts": "export const a = 1;\n",
    "src/old_version.ts": "export const a = 2;\n",
    "experiment.py": 'def go():\n    pass\n\nif __name__ == "__main__":\n    go()\n',
  }), ["maybe experiment.py", "likely src/old_version.ts"]);
});

test("does not flag files reached in other ways", async () => {
  assert.deepEqual(await unusedIn({
    "package.json": JSON.stringify({ dependencies: { next: "1" } }),
    "src/main.tsx": 'import { u } from "./util.js";\nimport { s } from "./auth.service";\nimport Button from "./components/Button";\nconst P = () => import("./pages/Lazy");\n',
    "src/util.ts": "export const u = 1;\n",
    "src/auth.service.ts": "export const s = 1;\n",
    "src/components/Button/index.tsx": "export default () => null;\n",
    "src/pages/Lazy.tsx": "export default () => null;\n",
    "pages/about.tsx": "export default () => null;\n",
    "vite.config.ts": "export default {};\n",
    "src/types.d.ts": "declare const x: number;\n",
    "run.py": 'import uvicorn\nuvicorn.run("app.main:app")\n',
    "app/main.py": "app = None\n",
    "agents/__init__.py": "from . import chatbot\n",
    "agents/chatbot.py": "def chat():\n    pass\n",
    "agents/planner.py": "def plan():\n    pass\n",
    "worker.py": "from agents.planner import plan\n",
    "index.html": '<script src="/static/js/chat.js"></script>\n',
    "static/js/chat.js": "console.info(1);\n",
    "tests/test_plan.py": "def test_plan():\n    pass\n",
  }), ["likely worker.py"]); // worker.py itself: imports others, but nothing reaches it
});
