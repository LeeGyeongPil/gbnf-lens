import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { cliPath, fixture, lib, root } from "./helpers.mjs";

test("large repetitions stay within 64MB heap and 3s", () => {
  const started = Date.now();
  const run = spawnSync(
    process.execPath,
    ["--max-old-space-size=64", cliPath, "check", "fixtures/bad/big-rep.gbnf", "fixtures/bad/clamp.gbnf", "fixtures/bad/rep-2000.gbnf"],
    { cwd: root, encoding: "utf8", timeout: 3000 },
  );
  assert.equal(run.error, undefined, "the process must finish within 3 seconds");
  assert.equal(run.signal, null);
  assert.equal(run.status, 1, run.stderr);
  assert.match(run.stdout, /repetition-threshold: 3 rules x 1500 = 4500 > 2000/);
  assert.match(run.stdout, /max-clamped/);
  assert.match(run.stdout, /large-repetition/);
  assert.ok(Date.now() - started < 3000);
});

test("the matcher counts repetitions instead of expanding them", () => {
  // max > 2000 is unbounded in llama.cpp, so 5000 characters are fine.
  const clamped = '("a"|"b"){0,3000}';
  const input = "ab".repeat(2500);
  assert.equal(lib.matchSample(`root ::= ${clamped}\n`, input).status, "accept");

  // Exactly 2000 is a real limit: character 2001 is rejected at offset 2000.
  const bounded = lib.matchSample('root ::= "a"{0,2000}\n', "a".repeat(2001));
  assert.equal(bounded.status, "reject");
  assert.equal(bounded.at.offset, 2000);
  assert.equal(lib.matchSample('root ::= "a"{0,2000}\n', "a".repeat(2000)).status, "accept");

  // The largest allowed minimum works too.
  assert.equal(lib.matchSample('root ::= "a"{2000}\n', "a".repeat(2000)).status, "accept");
});

test("heap growth stays small for the biggest legal repetition", () => {
  global.gc?.();
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < 20; i++) {
    lib.lintGrammar(fixture("bad/rep-2000.gbnf"));
    lib.lintGrammar(fixture("bad/big-rep.gbnf"));
    lib.matchSample('root ::= ("a"|"b"){0,2000}\n', "ab".repeat(900));
  }
  const grown = process.memoryUsage().heapUsed - before;
  assert.ok(grown < 64 * 1024 * 1024, `heap grew by ${grown} bytes`);
});

test("samples beyond the budget are inconclusive and never hang", () => {
  const ambiguous = 'root ::= a+\na ::= "a" | "a" "a" | "a" "a" "a"\n';
  const started = Date.now();
  const r = lib.matchSample(ambiguous, "a".repeat(5000) + "!", { maxSteps: 1000 });
  assert.deepEqual(r, { status: "inconclusive", reason: "budget" });
  assert.deepEqual(lib.matchSample('root ::= "a"*\n', "a".repeat(11), { maxInputChars: 10 }), { status: "inconclusive", reason: "input-too-long", limit: 10 });
  // A very deep right recursion may exhaust the JS stack: also inconclusive, not a crash.
  const deep = lib.matchSample('root ::= "a" root | "a"\n', "a".repeat(90000));
  assert.ok(["accept", "inconclusive"].includes(deep.status));
  assert.ok(Date.now() - started < 10000);
});

test("loops over empty matches terminate", () => {
  assert.equal(lib.matchSample('root ::= ("" | "a"?)* "!"\n', "aaa!").status, "accept");
  assert.equal(lib.matchSample('root ::= ("" | "a"?)* "!"\n', "aaa?").status, "reject");
});

test("inconclusive messages name the real cause and a fix that works", () => {
  const dir = mkdtempSync(join(tmpdir(), "gbnf-lens-"));
  try {
    const run = (grammar, sample, ...extra) => {
      writeFileSync(join(dir, "g.gbnf"), grammar);
      writeFileSync(join(dir, "s.txt"), sample);
      return spawnSync(process.execPath, [cliPath, "check", join(dir, "g.gbnf"), "--sample", join(dir, "s.txt"), ...extra], { encoding: "utf8" }).stdout;
    };
    const long = run('root ::= "a"*\n', "a".repeat(20), "--max-input", "10");
    assert.match(long, /longer than 10 characters.*--max-input/);
    assert.doesNotMatch(long, /raise --max-steps/);

    const deepGrammar = 'root ::= item root | ""\nitem ::= "a"\n';
    const deep = run(deepGrammar, "a".repeat(50000), "--max-steps", "900000000");
    assert.match(deep, /recurses too deeply.*--max-steps will not help/);

    const budget = run('root ::= a+\na ::= "a" | "a" "a"\n', "a".repeat(5000) + "!", "--max-steps", "1000");
    assert.match(budget, /raise --max-steps/);
    assert.equal(lib.matchSample(deepGrammar, "a".repeat(50000)).reason, "stack-depth");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--max-input lets the CLI check a longer sample", () => {
  const args = ["check", "fixtures/grammars/json.gbnf", "--sample-text", " ".repeat(20) + "1", "--max-input"];
  const small = spawnSync(process.execPath, [cliPath, ...args, "10"], { cwd: root, encoding: "utf8" });
  assert.match(small.stdout, /--max-input/);
  const big = spawnSync(process.execPath, [cliPath, ...args, "100"], { cwd: root, encoding: "utf8" });
  assert.doesNotMatch(big.stdout, /inconclusive/);
});
