import { readFile } from "node:fs/promises";
import { join } from "node:path";

// .detron/config.json, written by the person (or `detron init`): how strict hooks are.

export interface Config {
  // suggest: tell the agent, never stop it. block: also stop a task from finishing while it
  // has added security or crash problems.
  mode: "suggest" | "block";
  checkInEvery: number; // edits between check-ins
}

const DEFAULTS: Config = { mode: "suggest", checkInEvery: 10 };

export async function loadConfig(root: string): Promise<Config> {
  let text: string;
  try {
    text = await readFile(join(root, ".detron/config.json"), "utf8");
  } catch {
    return DEFAULTS; // no config file: the defaults
  }
  const read = JSON.parse(text) as Partial<Config>;
  return {
    mode: read.mode === "block" ? "block" : "suggest",
    checkInEvery: Number.isInteger(read.checkInEvery) && read.checkInEvery! > 0 ? read.checkInEvery! : DEFAULTS.checkInEvery,
  };
}
