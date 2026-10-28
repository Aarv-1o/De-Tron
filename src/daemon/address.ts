import { createHash } from "node:crypto";
import { mkdirSync, realpathSync, statSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";

// Where one repo's background Detron listens: a named pipe on Windows, a socket in a folder
// only this user can open elsewhere. Named after the repo, so each repo gets its own.

export function addressFor(root: string): string {
  const id = createHash("sha256").update(realpathSync(root)).digest("hex").slice(0, 16);
  const user = userInfo().username.replace(/[^\w.-]/g, "_");
  if (process.platform === "win32") return `\\\\.\\pipe\\detron-${user}-${id}`;
  // Socket paths have a short length limit (about 100 characters on macOS): stay short.
  const base = tmpdir().length > 40 ? "/tmp" : tmpdir();
  const dir = join(base, `detron-${user}`);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return join(dir, `${id}.sock`);
}

// Which Detron is running: a background Detron from before an update must not answer.
export function buildId(): string {
  const entry = process.argv[1] ?? "";
  return `${entry}:${statSync(entry, { throwIfNoEntry: false })?.mtimeMs ?? 0}`;
}
