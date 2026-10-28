import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { dirname } from "node:path";
import type { HookInput, HookReply } from "../agent/hooks.ts";
import { Sessions, type AgentStatus } from "../agent/session.ts";
import { addressFor, buildId } from "./address.ts";
import type { Request, Response } from "./server.ts";

// Asks the repo's background Detron, starting it if it isn't running. If it can't start, the
// hook is answered right here, slower and without memory of the task.

const START_WAIT_MS = 20_000; // its first scan reads the whole repo
const POLL_MS = 150;

function ask(address: string, request: Request): Promise<Response> {
  return new Promise((done, fail) => {
    const socket = createConnection(address, () => socket.write(`${JSON.stringify(request)}\n`));
    let text = "";
    socket.on("data", (chunk) => (text += chunk));
    socket.on("end", () => (text ? done(JSON.parse(text) as Response) : fail(new Error("the background Detron closed without answering"))));
    socket.on("error", fail);
  });
}

// The same Detron that's running now (same Node flags and entry file), in the background.
function startBackground(root: string): void {
  // From Detron's own folder: Node flags like `--import tsx` resolve there, not in the repo.
  const child = spawn(process.execPath, [...process.execArgv, process.argv[1]!, "serve", root], { cwd: dirname(process.argv[1]!), detached: true, stdio: "ignore", windowsHide: true });
  child.unref();
}

const notRunning = (error: unknown) => ["ENOENT", "ECONNREFUSED", "EPIPE", "ECONNRESET"].includes((error as NodeJS.ErrnoException).code ?? "");

// The agent's task as the background Detron sees it, without starting one: undefined when no
// agent is working in this repo.
export async function agentStatus(root: string): Promise<AgentStatus | undefined> {
  try {
    const response = await ask(addressFor(root), { kind: "status" });
    return "status" in response ? (response.status ?? undefined) : undefined;
  } catch (error) {
    if (notRunning(error)) return undefined;
    throw error;
  }
}

export async function hookReply(root: string, input: HookInput): Promise<HookReply> {
  const address = addressFor(root);
  const request: Request = { kind: "hook", build: buildId(), input };
  let started = false;
  const deadline = Date.now() + START_WAIT_MS;
  for (;;) {
    let response: Response | undefined;
    try {
      response = await ask(address, request);
    } catch (error) {
      if (!notRunning(error)) throw error;
    }
    if (response && "reply" in response) return response.reply;
    if (response && "error" in response) throw new Error(`the background Detron failed: ${response.error}`);
    // Not running, or an older Detron that just stopped: start this one and try again.
    if (!started || (response && "restart" in response)) {
      startBackground(root);
      started = true;
    }
    if (Date.now() > deadline) break;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  return new Sessions(root).handle(input); // couldn't start it: answer here, without the task's history
}
