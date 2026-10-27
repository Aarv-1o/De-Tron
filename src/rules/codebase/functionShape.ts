import { isTestFile } from "../../index/files.ts";
import type { FunctionInfo } from "../../index/functions.ts";
import type { LineFinding } from "../line/types.ts";

const DEEP_NESTING = 5;
const MANY_PARAMS = 5;
const IGNORED_PARAMS = new Set(["self", "cls"]);

// Trailing params only: removing one in the middle shifts every argument after it.
function unusedTrailing(fn: FunctionInfo): string[] {
  const unused = new Set(fn.unusedParams);
  const trailing: string[] = [];
  for (const p of [...fn.params].reverse()) {
    if (!unused.has(p) || p.startsWith("_") || IGNORED_PARAMS.has(p)) break;
    trailing.unshift(p);
  }
  return trailing;
}

export function findFunctionShapeIssues(functions: FunctionInfo[]): LineFinding[] {
  const found: LineFinding[] = [];
  for (const fn of functions) {
    if (isTestFile(fn.file)) continue;
    const at = { file: fn.file, line: fn.startLine };

    // Called by our own code only: a method, a handler, an export or a decorated function
    // may be called by something with a fixed signature.
    const ownCallsOnly = fn.kind === "function" && !fn.decorated && !fn.exported && !fn.passedAsValue;
    const trailing = unusedTrailing(fn);
    if (ownCallsOnly && trailing.length) {
      // JS ignores extra arguments, so dropping the param is safe; Python callers would break.
      const safe = fn.language !== "python";
      found.push({
        ...at, rule: "unused-param", confidence: safe ? "sure" : "likely",
        message: `${fn.name}: ${trailing.join(", ")} ${trailing.length > 1 ? "are" : "is"} never used.${safe ? "" : " Remove it and the argument at each call."}`,
      });
    }
    if (fn.nesting >= DEEP_NESTING) {
      found.push({ ...at, rule: "deep-nesting", confidence: "likely", message: `${fn.name}: ${fn.nesting} levels deep. Return early to flatten it.` });
    }
    const params = fn.params.filter((p) => !IGNORED_PARAMS.has(p) && !p.startsWith("*"));
    if (params.length >= MANY_PARAMS) {
      found.push({ ...at, rule: "long-params", confidence: "maybe", message: `${fn.name}: ${params.length} parameters (${params.join(", ")}). Easy to pass in the wrong order: pass one object with named fields.` });
    }
  }
  return found;
}
