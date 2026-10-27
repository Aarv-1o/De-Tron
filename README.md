# Detron

Detron stops AI coding agents from making a mess of your codebase.

It watches what your agent writes, catches duplicate code, dead code and bloat,
gets the agent to clean it up, proves nothing broke, and explains what changed.

> Status: early build. Not on npm yet. Works today: finding copied code.

## Try it

Needs Node 22+. From a clone of this repo:

```
npm install
npm run detron -- scan path/to/your/repo
```

- `--all` also shows hints (same structure, different values)
- `--json` prints machine-readable output for agents and scripts

Supports JavaScript, TypeScript (incl. JSX/TSX) and Python.

- What V1 will do: [SPEC.md](SPEC.md)
- Rules for anyone (human or agent) working on this repo: [AGENTS.md](AGENTS.md)
- Research behind the decisions: [docs/research.md](docs/research.md)
