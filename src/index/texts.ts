import { readFile } from "node:fs/promises";
import { join } from "node:path";

const BINARY = /\.(png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|eot|mp[34]|wav|pdf|zip|gz|pem|lock)$|package-lock\.json$/i;

// Text of the given repo files, skipping binaries. Unreadable files come back empty.
export async function readTexts(root: string, files: string[]): Promise<Map<string, string>> {
  const texts = new Map<string, string>();
  for (const file of files) {
    if (!BINARY.test(file)) texts.set(file, await readFile(join(root, file), "utf8").catch(() => ""));
  }
  return texts;
}

export const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
