import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { run } from "./cli.js";

/** Read one line from the terminal without echoing it (API keys are secrets). */
async function readHidden(prompt: string): Promise<string> {
  let muted = false;
  const output = new Writable({
    write(chunk, encoding, cb) {
      if (!muted) process.stderr.write(chunk, encoding);
      cb();
    },
  });
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  try {
    const answer = rl.question(prompt);
    muted = true;
    return await answer;
  } finally {
    rl.close();
    process.stderr.write("\n");
  }
}

const code = await run(process.argv.slice(2), {
  out: (s) => process.stdout.write(s + "\n"),
  err: (s) => process.stderr.write(s + "\n"),
  env: process.env,
  cwd: process.cwd(),
  fetch: globalThis.fetch.bind(globalThis),
  readLine: process.stdin.isTTY ? readHidden : undefined,
});
process.exitCode = code;
