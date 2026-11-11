import assert from "node:assert/strict";
import { test } from "node:test";
import { fixture, lib } from "./helpers.mjs";

test("reports where a sample stops matching", () => {
  const json = fixture("grammars/json.gbnf");
  const bad = lib.matchSample(json, '{"a": 1,}');
  assert.equal(bad.status, "reject");
  assert.equal(bad.reason, "unexpected-char");
  assert.deepEqual([bad.at.line, bad.at.column, bad.at.offset], [1, 9, 8]);
  assert.deepEqual(bad.expected, ['" "', '"\\n"', '"\\""']);

  const chess = lib.matchSample(fixture("grammars/chess.gbnf"), "1. e4 e5\n");
  assert.equal(chess.status, "reject");
  assert.equal(chess.reason, "unexpected-end");
  assert.equal(chess.at.offset, 9);

  // Complete grammar followed by extra text: rejected at the first extra character.
  const extra = lib.matchSample('root ::= "ab"\n', "abc");
  assert.equal(extra.status, "reject");
  assert.equal(extra.at.offset, 2);
  assert.equal(extra.reason, "unexpected-char");
});

test("token terminals give inconclusive, other branches can still accept", () => {
  const tok = fixture("bad/token.gbnf");
  assert.deepEqual(lib.matchSample(tok, "<think>abc"), { status: "inconclusive", reason: "needs-vocab" });
  assert.equal(lib.matchSample('root ::= <think> "x" | "y"\n', "y").status, "accept");
});

test("grammar errors are returned, not thrown", () => {
  const r = lib.matchSample(fixture("bad/left-rec.gbnf"), "1+2");
  assert.equal(r.status, "grammar-error");
  assert.equal(r.diagnostics[0].code, "left-recursion");
  assert.equal(lib.matchSample("root ::= x\n", "a").status, "grammar-error");
  assert.equal(lib.matchSample('root ::= "a"\n', "a", { root: "start" }).status, "grammar-error");
  assert.equal(lib.matchSample('start ::= "a"\n', "a", { root: "start" }).status, "accept");
});

test("classes, escapes, any char and repetition counts", () => {
  assert.equal(lib.matchSample('root ::= [a-c]{2,3} [^0-9] .\n', "abz!").status, "accept");
  assert.equal(lib.matchSample('root ::= [a-c]{2,3} [^0-9] .\n', "ab5!").status, "reject");
  assert.equal(lib.matchSample('root ::= "\\x41\\u00e9\\U0001F600"\n', "Aé😀").status, "accept");
  assert.equal(lib.matchSample('root ::= "a"{2,}\n', "a").status, "reject");
  assert.equal(lib.matchSample('root ::= "a"{2,}\n', "aaaaaa").status, "accept");
  assert.equal(lib.matchSample('root ::= "a"{0}\n', "").status, "accept");
  assert.equal(lib.matchSample('root ::= ""\n', "").status, "accept");
});

test("the parsed grammar can be reused", () => {
  const parsed = lib.parseGrammar('root ::= "a"+\n');
  assert.equal(parsed.ok, true);
  assert.equal(lib.matchSample(parsed, "aaa").status, "accept");
  assert.equal(lib.matchSample(parsed, "b").status, "reject");
});
