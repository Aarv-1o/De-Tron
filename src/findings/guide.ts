import { CODE_GUIDES } from "./guides/code.ts";
import { DATABASE_GUIDES } from "./guides/database.ts";
import { SECURITY_GUIDES } from "./guides/security.ts";
import type { Guide } from "./guides/shared.ts";

// Per rule: its name, why it matters, how to fix it, whether it's safe to do on its own, and
// how to check. One place, so every output (text, --agent, --json, editor) says the same thing.
export const GUIDES: Record<string, Guide> = { ...CODE_GUIDES, ...SECURITY_GUIDES, ...DATABASE_GUIDES };
