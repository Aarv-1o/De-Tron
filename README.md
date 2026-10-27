# Detron

Detron stops AI coding agents from making a mess of your codebase.

It watches what your agent writes, catches duplicate code, dead code and bloat,
gets the agent to clean it up, proves nothing broke, and explains what changed.

> Status: early build. Not on npm yet. Works today: copied code, dead code, frontend/backend
> mismatches, code hygiene and hotspots.

## Try it

Needs Node 22+. From a clone of this repo:

```
npm install
npm run detron -- scan path/to/your/repo
```

- `--all` also shows hints (less certain findings)
- `--json` prints machine-readable output for agents and scripts

It finds:

- **Copies:** exact and drifted copies of functions (with what differs), including the same logic in JS and Python
- **Dead code:** unused packages (with sizes), unused files, functions nothing calls
- **Frontend and backend:** calls to API routes that don't exist (and the route it likely meant),
  calls with the wrong method, routes nothing calls. Express, Next.js, FastAPI and Flask
- **Hotspots:** complex files that change often (from git history), so you know where to
  clean first. Needs a git clone, not a downloaded zip
- **Code hygiene:** errors that are ignored or only logged, commented-out code, comments that
  repeat the code, unused parameters, deep nesting

Supports JavaScript, TypeScript (incl. JSX/TSX) and Python.

- What V1 will do: [SPEC.md](SPEC.md)
- Rules for anyone (human or agent) working on this repo: [AGENTS.md](AGENTS.md)
- Research behind the decisions: [docs/research.md](docs/research.md)
