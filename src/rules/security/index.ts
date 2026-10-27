import type { FileContext, LineFinding } from "../line/types.ts";
import { crashRules } from "./crash.ts";
import { injectionRules } from "./injection.ts";
import { secretRules } from "./secrets.ts";
import { webRules } from "./web.ts";

export { committedEnvFiles } from "./secrets.ts";

// Per-file security checks; the endpoint checks (endpoints.ts) run on the whole route table.
export const SECURITY_RULES = new Set([
  "sql-injection", "nosql-injection", "command-injection", "code-eval", "ssrf", "open-redirect", "path-traversal",
  "mass-assignment", "hardcoded-secret", "secret-fallback", "client-exposed-secret", "env-file-in-repo", "xss",
  "cors-any-origin-with-credentials", "error-leak", "debug-mode", "weak-password-hash", "plaintext-password",
  "jwt-not-verified", "insecure-random",
]);
export const CRASH_RULES = new Set(["async-handler-no-catch", "unguarded-json-parse", "exit-in-handler"]);

export const securityRules = (context: FileContext): LineFinding[] => [
  ...injectionRules(context), ...secretRules(context), ...webRules(context), ...crashRules(context),
];
