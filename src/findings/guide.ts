import type { Finding } from "./types.ts";

// Per rule: why it matters, how to fix it, whether it's safe to do on its own, and how to
// check. One place, so every output says the same thing.

type Guide = Pick<Finding, "category" | "why" | "fix" | "safety" | "verify"> & { name: string };

const RESCAN = "Run `detron scan` again: this finding is gone.";
const TESTS = "Tests and the type check still pass";

export const GUIDES: Record<string, Guide> = {
  "exact-copy": {
    name: "Exact copies",
    category: "copies", safety: "ask-first",
    why: "A fix made in one copy won't reach the others, so they drift apart.",
    fix: ["Keep the copy in the most shared place (a utils module).", "Import it everywhere else and delete the other copies.", "Keep this in its own commit, apart from feature work."],
    verify: `${TESTS}, and ${RESCAN.toLowerCase()}`,
  },
  "similar-copy": {
    name: "Copies that drifted apart",
    category: "copies", safety: "ask-first",
    why: "These do the same job but already behave differently: one of them is probably a bug.",
    fix: ["Read the differences listed: decide which behavior is right.", "Ask before changing behavior: callers may depend on the difference.", "Then keep one version and import it everywhere."],
    verify: `${TESTS}; the callers of every copy still get the behavior they need.`,
  },
  "cross-language-copy": {
    name: "Same logic in two languages",
    category: "copies", safety: "ask-first",
    why: "The same logic in the frontend and the backend must be changed in both, every time.",
    fix: ["Decide which side owns it (usually the backend).", "Have the other side get the result from it (an API field) instead of computing it again."],
    verify: `${TESTS}; the page shows the same values as before.`,
  },
  "similar-hint": {
    name: "Could share a helper",
    category: "copies", safety: "ask-first",
    why: "Same structure, different values: they could share one helper with a parameter.",
    fix: ["Only if you're already changing one of them: extract the shared part, pass the values in."],
    verify: TESTS + ".",
  },
  "unused-package": {
    name: "Unused packages",
    category: "dead-code", safety: "safe",
    why: "Unused packages slow installs and builds and widen the attack surface.",
    fix: ["Uninstall it with the command shown.", "Remove its config, if any is left."],
    verify: `The app builds and ${TESTS.toLowerCase()}.`,
  },
  "unused-file": {
    name: "Unused files",
    category: "dead-code", safety: "ask-first",
    why: "A file nothing uses still gets read, searched and \"fixed\", and confuses the next change.",
    fix: ["Check it isn't started by hand (a script, a cron job, a Procfile).", "If not, delete it. Git keeps the history."],
    verify: `The app starts and ${TESTS.toLowerCase()}.`,
  },
  "dead-function": {
    name: "Dead functions",
    category: "dead-code", safety: "safe",
    why: "Code nobody calls still has to be read and kept working.",
    fix: ["Delete the function, and its tests if only tests use it.", "Delete imports that only it needed."],
    verify: `${TESTS}, and ${RESCAN.toLowerCase()}`,
  },
  "missing-route": {
    name: "Calls to routes that don't exist",
    category: "frontend-backend", safety: "ask-first",
    why: "This call fails at runtime: the server has no route for it.",
    fix: ["If the route it likely meant is right, change the call to that path.", "If the route should exist, add it on the server.", "Ask if unsure which side is wrong."],
    verify: `The call succeeds when you use that feature, and ${RESCAN.toLowerCase()}`,
  },
  "wrong-method": {
    name: "Calls with the wrong method",
    category: "frontend-backend", safety: "ask-first",
    why: "This call fails at runtime: the route exists, but not for this method.",
    fix: ["Change the call's method to the one the route takes, or add the method on the server."],
    verify: `The call succeeds when you use that feature, and ${RESCAN.toLowerCase()}`,
  },
  "unused-route": {
    name: "Routes nothing calls",
    category: "frontend-backend", safety: "ask-first",
    why: "A route nothing calls is code to maintain and an endpoint to secure, for nothing.",
    fix: ["Ask whether anything outside this repo calls it (a mobile app, a webhook, a script).", "If not, delete the route and its handler."],
    verify: `${TESTS}, and the app's pages still work.`,
  },
  "empty-catch": {
    name: "Errors silently ignored",
    category: "hygiene", safety: "ask-first",
    why: "The error disappears: when this fails, nobody will know why.",
    fix: ["Handle the error, or let it go up to a place that can.", "If ignoring it really is right, add a comment saying why."],
    verify: TESTS + ".",
  },
  "catch-only-logs": {
    name: "Errors only logged",
    category: "hygiene", safety: "ask-first",
    why: "In browser code the user never sees the log: the action just silently does nothing.",
    fix: ["Show the user that it failed (an error message, a toast), or rethrow."],
    verify: "Make the call fail on purpose: the user sees it.",
  },
  "catch-returns-default": {
    name: "Errors turned into default values",
    category: "hygiene", safety: "ask-first",
    why: "Callers get a normal-looking value and can't tell the call failed.",
    fix: ["Return or throw an error callers can check.", "If the default is a deliberate fail-safe, add a comment saying so."],
    verify: TESTS + ".",
  },
  "catch-rethrow": {
    name: "Catch blocks that do nothing",
    category: "hygiene", safety: "safe",
    why: "A catch that only rethrows the same error does nothing but add a level.",
    fix: ["Remove the try/catch and keep the body."],
    verify: TESTS + ".",
  },
  "commented-out-code": {
    name: "Commented-out code",
    category: "hygiene", safety: "safe",
    why: "Old code in comments confuses readers and agents, and goes stale. Git keeps the history.",
    fix: ["Delete the commented-out lines."],
    verify: RESCAN,
  },
  "unused-param": {
    name: "Unused parameters",
    category: "hygiene", safety: "safe",
    why: "An unused parameter makes callers pass values that do nothing.",
    fix: ["Remove the parameter, and the argument at each call listed."],
    verify: `${TESTS}.`,
  },
  "deep-nesting": {
    name: "Deeply nested functions",
    category: "hygiene", safety: "ask-first",
    why: "Deeply nested code is where bugs hide: every level is another condition to keep in mind.",
    fix: ["Return early for the error and edge cases, so the main path isn't nested.", "Pull a nested block into its own function if it has a clear name.", "Write a test for the current behavior first, then change it."],
    verify: `${TESTS}, and the nesting level is lower on a new scan.`,
  },
  "comment-repeats-code": {
    name: "Comments that repeat the code",
    category: "hygiene", safety: "safe",
    why: "A comment that says what the next line says adds reading and goes stale.",
    fix: ["Delete it, or replace it with why the code does this."],
    verify: RESCAN,
  },
  "long-params": {
    name: "Long parameter lists",
    category: "hygiene", safety: "ask-first",
    why: "Many positional parameters are easy to pass in the wrong order.",
    fix: ["Only if you're changing this function anyway: pass one object with named fields.", "Update every caller listed in the same commit."],
    verify: `${TESTS}; every caller listed was updated.`,
  },
  hotspot: {
    name: "Hotspots",
    category: "hotspot", safety: "warning",
    why: "Files that change often and are complex: changes there break things most often.",
    fix: [
      "Don't refactor it as a task of its own.",
      "When a task changes this file: write a test for the part you change first, then make the change.",
      "Keep any cleanup in a separate commit from the feature.",
    ],
    verify: "The tests you added pass before and after your change.",
  },
};
