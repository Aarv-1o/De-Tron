import { run } from "./run.ts";

process.exitCode = await run(process.argv.slice(2), (text) => process.stdout.write(text));
