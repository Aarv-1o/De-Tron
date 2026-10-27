import { run } from "./run.ts";

// Piping into `head` or `more` closes the pipe early: that's not an error.
process.stdout.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});

process.exitCode = await run(process.argv.slice(2), (text) => process.stdout.write(text));
