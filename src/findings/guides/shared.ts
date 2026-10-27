import type { Finding } from "../types.ts";

export type Guide = Pick<Finding, "category" | "why" | "fix" | "safety" | "verify"> & { name: string };

export const RESCAN = "Run `detron scan` again: this finding is gone.";
export const TESTS = "Tests and the type check still pass";
