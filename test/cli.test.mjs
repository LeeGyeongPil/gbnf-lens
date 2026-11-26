import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { cleanEnv, cliPath, root } from "./helpers.mjs";

const run = (...args) => spawnSync(process.execPath, [cliPath, ...args], { cwd: root, encoding: "utf8", timeout: 20000, env: cleanEnv() });

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

const runStdin = (input, ...args) =>
  spawnSync(process.execPath, [cliPath, ...args], { cwd: root, encoding: "utf8", timeout: 20000, env: cleanEnv(), input });

test("check - reads the grammar from standard input", () => {
  const ok = runStdin('root ::= "a"\n', "check", "-");
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /<stdin>: ok/);

  const bom = runStdin('﻿root ::= "a"\n', "check", "-", "--sample-text", "a");
  assert.equal(bom.status, 0, bom.stdout);
  assert.match(bom.stdout, /sample accepted/);

  const bad = runStdin("root ::= undefined-rule\n", "check", "-");
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /^<stdin>:1:/);

  const json = JSON.parse(runStdin("root ::= undefined-rule\n", "check", "-", "--json").stdout);
  assert.ok(json.length > 0 && json.every((d) => d.file === "<stdin>"));

  const rejected = runStdin('root ::= "a"\n', "check", "-", "--sample-text", "b");
  assert.equal(rejected.status, 1);
});

test("check - misuse of standard input is a usage error", () => {
  const twice = runStdin('root ::= "a"\n', "check", "-", "-");
  assert.equal(twice.status, 2);
  assert.match(twice.stderr, /only once/);
  const ko = runStdin('root ::= "a"\n', "--lang", "ko", "check", "-", "-");
  assert.match(ko.stderr, /한 번만/);
  const both = runStdin('root ::= "a"\n', "check", "-", "--sample", "-");
  assert.equal(both.status, 2);
  assert.match(both.stderr, /both the grammar and the sample/);
});

test("./- is still a file path", () => {
  const r = runStdin('root ::= "a"\n', "check", "./-");
  assert.equal(r.status, 2);
  assert.match(r.stderr, /cannot read '\.\/-'/);
});

test("trailing newline rejection adds a hint; other rejections do not", async () => {
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const d = mkdtempSync(join(tmpdir(), "gl-nl-"));
  const g = join(d, "yn.gbnf");
  writeFileSync(g, 'root ::= "yes" | "no"\n');
  const sample = (name, text) => { const f = join(d, name); writeFileSync(f, text); return f; };
  const nl = sample("a.txt", "yes\n");
  for (const lang of ["en", "ko"]) {
    const r = run("check", g, "--sample", nl, "--lang", lang);
    assert.equal(r.status, 1);
    assert.match(r.stdout + r.stderr, lang === "en" ? /Hint: the trailing newline/ : /힌트: 파일 끝의 줄바꿈/);
  }
  const j = run("check", g, "--sample", nl, "--lang", "en", "--json");
  assert.equal(j.status, 1);
  assert.match(j.stdout, /Hint: the trailing newline/);
  assert.match(j.stdout, /sample-rejected/);
  for (const t of ["yex", "yes"]) {
    const r = run("check", g, "--sample", sample("b.txt", t), "--lang", "en");
    assert.doesNotMatch(r.stdout + r.stderr, /Hint: the trailing newline/);
  }
  const r2 = run("check", g, "--sample", sample("c.txt", "yes\r\n"), "--lang", "en");
  assert.doesNotMatch(r2.stdout + r2.stderr, /Hint: the trailing newline/);
});
