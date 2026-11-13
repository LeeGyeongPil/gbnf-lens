// A one-minute tour: run the CLI on the shipped examples and show what it finds.
// Nothing here needs a server or a model; always exits 0 so you can read the whole tour.
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(root, "dist", "cli.js");

function step(title, ...args) {
  console.log(`\n=== ${title}`);
  console.log(`$ gbnf-lens ${args.join(" ")}`);
  const r = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8", timeout: 20000, env: { ...process.env, GBNF_LENS_LANG: process.env.GBNF_LENS_LANG ?? "en" } });
  process.stdout.write(r.stdout);
  process.stderr.write(r.stderr);
  console.log(`(exit code ${r.status})`);
}

step("1. A clean grammar and a sample it accepts", "check", "examples/tool-call.gbnf", "--sample", "examples/tool-call.ok.txt");
step("2. A sample that stops matching (see where, and what was expected)", "check", "examples/tool-call.gbnf", "--sample", "examples/tool-call.bad.txt");
step("3. llama.cpp would refuse this: the repetition limit", "check", "examples/tool-call-too-many.gbnf");
step("4. Accepted, but not what it looks like", "check", "examples/silent.gbnf");
step("5. A syntax error with a line and column (llama.cpp prints none)", "check", "fixtures/bad/leading-pipe.gbnf");
