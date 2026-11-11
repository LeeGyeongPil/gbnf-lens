import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { cliPath, root } from "./helpers.mjs";

const run = (...args) => spawnSync(process.execPath, [cliPath, ...args], { cwd: root, encoding: "utf8", timeout: 20000 });

test("reports where a sample stops matching: CLI output", () => {
  const r = run("check", "fixtures/grammars/json.gbnf", "--sample-text", '{"a": 1,}');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /sample rejected at 1:9 \(offset 8\): unexpected '\}'/);
  assert.ok(r.stdout.includes('expected one of " ", "\\n", "\\""'), r.stdout);
  assert.match(r.stdout, /\n {2}\{"a": 1,\}\n {10}\^\n/); // source line and caret under the brace

  const end = run("check", "fixtures/grammars/chess.gbnf", "--sample-text", "1. e4 e5\n");
  assert.equal(end.status, 1);
  assert.match(end.stdout, /unexpected end of input.*\(offset 9\)|\(offset 9\): unexpected end of input/);

  const vocab = run("check", "fixtures/bad/token.gbnf", "--sample-text", "<think>abc");
  assert.equal(vocab.status, 0);
  assert.match(vocab.stdout, /inconclusive: needs vocab/);
  assert.equal(run("check", "fixtures/bad/token.gbnf", "--sample-text", "<think>abc", "--strict").status, 1);
});

test("sample files are read as they are", () => {
  const ok = run("check", "examples/tool-call.gbnf", "--sample", "examples/tool-call.ok.txt");
  assert.equal(ok.status, 0, ok.stdout);
  assert.match(ok.stdout, /sample accepted/);
  const bad = run("check", "examples/tool-call.gbnf", "--sample", "examples/tool-call.bad.txt");
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /sample rejected at 1:39/);
});

test("exit codes and --json schema", () => {
  assert.equal(run("check", "fixtures/grammars/json.gbnf").status, 0);
  assert.equal(run("check", "fixtures/bad/leading-pipe.gbnf").status, 1);
  assert.equal(run("check", "fixtures/bad/clamp.gbnf").status, 0); // warnings only
  assert.equal(run("check", "fixtures/bad/clamp.gbnf", "--strict").status, 1);

  // usage and file errors
  assert.equal(run("check", "fixtures/nope.gbnf").status, 2);
  assert.match(run("check", "fixtures/nope.gbnf").stderr, /cannot read/);
  assert.equal(run("check").status, 2);
  assert.equal(run().status, 2);
  assert.equal(run("check", "x.gbnf", "--bogus").status, 2);
  assert.equal(run("check", "x.gbnf", "--sample").status, 2);
  assert.equal(run("check", "x.gbnf", "--max-steps", "abc").status, 2);
  assert.equal(run("check", "x.gbnf", "--sample", "a", "--sample-text", "b").status, 2);
  assert.equal(run("frobnicate").status, 2);
  assert.equal(run("check", "fixtures/grammars/json.gbnf", "--sample", "fixtures/nope.txt").status, 2);
  // one unreadable file among good ones still gives 2
  assert.equal(run("check", "fixtures/grammars/json.gbnf", "fixtures/nope.gbnf").status, 2);

  assert.equal(run("--help").status, 0);
  assert.match(run("--version").stdout, /^\d+\.\d+\.\d+/);

  const json = run("check", "fixtures/bad/loops.gbnf", "fixtures/bad/undefined.gbnf", "--json");
  assert.equal(json.status, 1);
  const parsed = JSON.parse(json.stdout);
  assert.ok(Array.isArray(parsed) && parsed.length >= 5);
  for (const d of parsed) {
    assert.deepEqual(Object.keys(d).sort(), ["code", "column", "endColumn", "endLine", "file", "line", "message", "severity"]);
    assert.equal(typeof d.line, "number");
    assert.ok(["error", "warning", "info"].includes(d.severity));
  }
  assert.ok(parsed.some((d) => d.code === "undefined-rule" && d.file.endsWith("undefined.gbnf") && d.line === 1 && d.column === 23));
  assert.deepEqual(JSON.parse(run("check", "fixtures/grammars/json.gbnf", "--json").stdout), []);
});
