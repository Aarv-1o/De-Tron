# Research behind Detron

## The problem is real

- **GitClear:** with AI, code is written ~20% faster, but churn is ~50% higher,
  duplication ~30% higher, and refactoring ~80% lower.
- **CodeRabbit:** AI PRs had ~1.7x more issues than human PRs (10.83 vs 6.45),
  with readability the biggest gap.
- **Stack Overflow 2025:** 66% say AI code is "almost right, but not quite".
  45% say debugging it takes longer.
- **METR:** experienced devs expected AI to make them 24% faster. They were 19% slower.

## What existing tools miss

- AI reviewers (CodeRabbit, Qodo...) are noisy. Developers start ignoring all comments.
- Slop detectors (slopfighter, Distyll, deep-slop) only **report**. None prove a fix is safe,
  none explain changes, and none learn.
- Spec tools (Spec Kit, Kiro) plan well, but stop governing the code after the first generation.

## Lessons from the books

- **Fowler, *Refactoring*:** smells catalog (Lazy Element, Speculative Generality,
  Middle Man, Duplicated Code). Code used only by tests is dead: delete both.
  "Two Hats": never add features and refactor at the same time.
- **Ousterhout, *A Philosophy of Software Design*:** pass-through methods, shallow modules,
  "comment repeats code". Warns that functions split too small become hard to read.
  Too many exceptions add complexity, but masking errors is sometimes right.
- **Beck, *Tidy First?*:** delete dead code (git keeps it). Explaining variables
  often *help*. Keep tidying separate from behavior changes, in small batches.
- **Feathers, *Working Effectively with Legacy Code*:** write characterization tests
  (record what the code does now) before changing untested code.
  Without tests, preserve signatures and lean on the compiler.
- **Tornhill, *Your Code as a Crime Scene*:** hotspots = change frequency × complexity.
  Change history predicts defects better than complexity alone.
  Indentation is a cheap complexity measure that works in any language.

## Baseline scan (Oct 2026)

Repos: Escrows-AI (30k lines, JS/TS), Travscape (3.4k, Python + JS), BlogManager (600, Python + JS).

### Real problems found

- `timeAgo` written **7 times** in Escrows-AI. 4 exact copies, 3 that behave differently.
- `formatSize` and `formatFileSize`: identical.
- `_strip_json_state` (Python) and `stripJsonState` (JS): the same logic in two languages.
- 2 dead orchestrator files in Travscape (477 lines, ~19% of its Python).
- `blog.py` and `api.py` in BlogManager are near-copies (29% duplication).
- 5 unused packages in Escrows-AI (three.js + react-three: 43 MB), 19 unused exports.
- 43 catch blocks that only log. On the frontend the user never sees the failure.
- `InboxPage.tsx`: 2,252 lines, 12 revisions, the #1 hotspot.

### Hand-check results (real issues in a sample)

| Rule | Real | Result |
|---|---|---|
| Duplicate functions | almost all | keep, top priority, needs fuzzy matching |
| Commented-out code | 7/8 | keep |
| Unused trailing params | 2/3 | keep, skip framework signatures |
| Comment repeats code | ~9/12 | keep as batch suggestion |
| Log-only catch | ~4/6 | keep, mainly frontend |
| Default return on error | ~3/6 | warn only (some are correct fail-closed checks) |
| Pass-through wrapper | 1/4 | low value |
| Empty catch | 42 of 45 had a "why" comment | only flag ones with no comment |
| Async without await | ~1/8 | dropped |
| Tiny single-use helper | 0/3 | dropped |
| Assign-then-return | 0/6 | dropped |

### Known false alarms to avoid (use as must-not-flag fixtures)

- Pydantic model fields reported as "unused variables".
- FastAPI route functions reported as "unused functions".
- Webhooks and OAuth callbacks reported as "routes nothing calls".
- API paths built from constants (`${API}/usage`) missed by naive string matching.
- LangGraph node functions whose `state` param is required by the framework.
- `async` handlers that must return a promise to match an interface.

## Duplicate detection v1 results (Oct 2026)

Hand-checked on the 3 repos:

- **Sure (exact copies):** 11 of 11 real. Includes `escapeRegex` ×7 and `timeAgo` ×4.
- **Likely (similar + shared wording):** ~14 of 17 real. Found all 7 `timeAgo`
  versions, including the 3 drifted ones. False alarms: data templates, symmetric
  pairs like enroll/unenroll.
- **Maybe (same structure, different values):** "could share a helper" hints,
  e.g. fetchClients / fetchItems. Not checked for precision; never sent to agents automatically.

What made the difference:
- Comparing structure with every name blanked out (not just renamed).
- Requiring shared *wording* ("just now", error messages), not shared one-word codes.
- Judging how rare a value is relative to repo size: a value copied 10 times is the signal.
- Skipping icons, whole pages, module factories (120+ lines) and nested helpers.

## Dead code detection v1 results (Oct 2026)

- **Unused packages:** Escrows-AI: three, @react-three/drei, @react-three/fiber,
  @types/three, openai (51.5 MB). 5 of 5 real, same as knip. Detron itself: none,
  after fixing a false alarm (grammar packages loaded through a runtime path string).
- **Unused files:** Travscape: both leftover orchestrator files. Escrows-AI and
  BlogManager: none.
- **Dead functions:** Escrows-AI: planAllows, getStorageLimitMB, brokerKillSwitch,
  stopScheduler. 4 of 4 real (only mentioned in a comment, or nowhere).
- **Dogfooding:** Detron found `listSourceFiles` dead in its own code (only tests
  used it). Removed.

Known gaps:
- A file whose name is a common word (`blog.py`) counts as "mentioned" almost
  everywhere, so it's never reported. Safe, but it misses some dead files.
- Two functions with the same name hide each other: if one is used, both look used.

## First blind test: AgentinFlow (Oct 2026)

An Astro marketing site I hadn't tuned on. Detron reported "no copies, no dead code"
after reading only 3 of 19 code files: the other 16 were `.astro`. A clean report
on a repo you mostly didn't read is the worst kind of false confidence, so scans now
list what they skipped.

Checked by hand: all 11 components are used, every CSS/JS file is referenced, both
packages are used, and the inline scripts don't repeat each other. So the repo really
is clean, but Detron got that right by luck.

Lesson for adding Astro/Vue/Svelte: their imports end in `.astro`/`.vue`/`.svelte`.
A quick trial that ignored this produced 10 false "unused file" alarms.

## Line rules v1 results (Oct 2026)

| Rule | Escrows-AI | Travscape | Checked by hand |
|---|---|---|---|
| Errors only logged (browser) | 22 | 3 | real: the user never sees the failure |
| Errors silently ignored | 16 | 3 (maybe: named Python errors) | 13 of Escrows' 16 are `catch { /* ignore */ }` |
| Errors turned into default values | 7 (maybe) | 4 (maybe) | about half are correct fail-closed checks: hint only |
| Commented-out code | 0 | 2 blocks + 1 line | all real, after requiring it to parse as code |
| Unused parameters | 1 | 0 | real; LangGraph/Gradio false alarms gone |
| Deep nesting (5+) | 3 | 4 | real (processEnrollment: 6 levels, CCN 81) |
| Comments that repeat the code | 30 | 12 | ~9 of 12 real |

What made the difference:
- **Parse to confirm commented-out code.** "html=True enables serving index.html" looks
  like code but doesn't parse.
- **Who calls a function decides if its params can go.** A function passed as a value
  (route handler, LangGraph node, Gradio callback) has a fixed signature.
- **A reason in a comment counts; "/* ignore */" doesn't.**
- **Browser vs server.** An error only logged in the browser is one the user never sees.

## Cross-stack check v1 results (Oct 2026)

Reads Express (routers, `app.use` mounts across files, `router.route()`), Next.js route
files, FastAPI (`APIRouter(prefix=)`, `include_router`) and Flask (blueprints). Calls:
fetch, axios, EventSource, `xhr.open`, your own fetch wrappers, inline `fetch` in HTML,
and `<form action>`. URLs built from constants in the same file are worked out
(`${API}/${id}` with `const API = "/api/clients"`).

| Repo | Calls / routes | Found | Checked by hand |
|---|---|---|---|
| Escrows-AI | 114 / 95 | 5 routes nothing calls | 5 of 5 real (`/api/billing/plans`, `/sequences/blocks`...) |
| Travscape, BlogManager | 2 / 3, 2 / 4 | nothing | right |
| Blind: proshop_mern, mern-skeleton, mern-mediastream, MERN-Template | 23/24, 7/7, 14/15, 3/4 | nothing (after 2 fixes) | right |
| proshop with 2 routes renamed on purpose | | 1 of 2 caught, with the right "did you mean" | see gaps |

What made the difference:
- **A literal segment beats a parameter.** `POST /api/users/${id}` was "reaching"
  `POST /api/users/export`, which hid a dead route and a wrong-method call.
- **Unknown base URL? Match the end only.** `${BASE}/users` can still be checked.
- **LAN dev servers are local.** A blind repo called `http://172.24.147.103:1337/auth/...`.
- **URLs in JSX count as uses** (`<ReactPlayer url={"/api/media/video/" + id}>`), but never
  as calls: `/dashboard` in a link may be a frontend page.

Known gaps:
- A renamed literal route behind a parameter route isn't caught: Express itself sends
  `/api/products/top` to `/:id`, so the call still "reaches" a route.
- Routes called from outside the repo (mobile apps, webhooks) look unused. Names like
  webhook/callback/health are skipped; other routes are only "likely" when the frontend
  uses other routes from the same file.
- Base URLs from another file (an axios instance with `baseURL` in `api.js`) aren't followed;
  those calls are matched on the end of the path.

Dogfooding: the self-scan flagged the route reader's second copy of the Python import
walk (fixed by recording bindings in the import reader), a 5-level function and two
5-parameter functions. It also flagged two comments that showed example code
(`// xhr.open("POST", url)`) as commented-out code: a false alarm worth remembering.

## Hotspots v1 results (Oct 2026)

Changes per file (git log, merges left out) × total indentation in the file's own indent
step. Text inside multi-line strings doesn't count: Travscape's `prompts.py` ranked #1 on
prompt text alone, and dropped out once strings were skipped.

- Escrows-AI (47 commits): #1 `InboxPage.tsx` (12 changes, 2,149 lines, 19 findings),
  #2 `InventoryPage.tsx` (7, 1,123, 12). Same #1 as the baseline hand check.
- Travscape (22 commits): `agents/utils.py`, then `agents/orchestrator.py`.
- Detron itself: `src/cli/run.ts` was #2, because every new check changed it. Split into
  running the checks and printing them; now #6.

The ranking is relative, so every repo has a #1. It says where to start, not that a file
is bad. Under 10 commits, it's skipped.
