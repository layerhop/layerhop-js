import { run } from "./cli.js";

const code = await run(process.argv.slice(2), {
  out: (s) => process.stdout.write(s + "\n"),
  err: (s) => process.stderr.write(s + "\n"),
  env: process.env,
  cwd: process.cwd(),
  fetch: globalThis.fetch.bind(globalThis),
});
process.exitCode = code;
