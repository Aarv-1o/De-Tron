import assert from "node:assert/strict";
import { test } from "node:test";
import { buildIndex } from "../src/index/repo.ts";
import { astroToTs } from "../src/languages/astro.ts";
import { findDeadFunctions } from "../src/rules/codebase/deadFunctions.ts";
import { findUnusedFiles } from "../src/rules/codebase/unusedFiles.ts";
import { makeRepo } from "./helpers.ts";

const PAGE = `---
import Card from "../components/Card.astro";
import { formatDate } from "../utils/date";
const posts = await getPosts();
---
<html>
  <head><script type="application/ld+json" set:html={JSON.stringify(ld)} /></head>
  <body>
    {/* the form's id stays the same */}
    {links.map((l) => <a href="https://example.com/x">{l}</a>)}
    {posts.map((p) => <Card title={p.title} date={formatDate(p.date)} />)}
    <script>
      document.querySelector("button")?.addEventListener("click", () => fetch("/api/like"));
    </script>
  </body>
</html>
`;

test("astroToTs: frontmatter and scripts stay on their lines, the template is blanked, its names kept", () => {
  const ts = astroToTs(PAGE).split("\n");
  assert.equal(ts.length, PAGE.split("\n").length + 1);
  assert.equal(ts[1], 'import Card from "../components/Card.astro";');
  assert.equal(ts[10]!.trim(), "");
  assert.match(ts[12]!, /fetch\("\/api\/like"\)/);
  assert.equal(ts[13]!.trim(), "");
  assert.match(ts.at(-1)!, /^void \[Card, JSON, ld, links, l, posts, p, formatDate\];$/);
});

test("Astro: components and helpers used only in the template aren't dead", async () => {
  const index = await buildIndex(await makeRepo({
    "package.json": JSON.stringify({ dependencies: { astro: "4.0.0" } }),
    "src/pages/index.astro": PAGE,
    "src/components/Card.astro": `---\nconst { title } = Astro.props;\n---\n<h2>{title}</h2>\n`,
    "src/components/Old.astro": `---\n---\n<p>old</p>\n`,
    "src/utils/date.ts": `export function formatDate(d: Date) { return d.toISOString(); }\nexport function unused() { return 1; }\n`,
  }));
  assert.deepEqual((await findUnusedFiles(index)).map((f) => f.file), ["src/components/Old.astro"]);
  assert.deepEqual((await findDeadFunctions(index)).map((d) => d.fn.name), ["unused"]);
});
