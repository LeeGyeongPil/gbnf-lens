import assert from "node:assert/strict";
import { test } from "node:test";
import { fixture, lib } from "./helpers.mjs";

const first = (file) => lib.lintGrammar(fixture(`bad/${file}`)).find((d) => d.severity === "error");

test("syntax errors carry line:column", () => {
  const pipe = first("leading-pipe.gbnf");
  assert.equal(pipe.code, "parse");
  assert.deepEqual([pipe.start.line, pipe.start.column], [2, 1]);
  assert.match(pipe.message, /^expecting name/);
  assert.match(pipe.message, /put '\|' at the end of the previous line/);
  assert.match(pipe.llamaMessage, /^expecting name at \|/);

  const underscore = first("underscore.gbnf");
  assert.equal(underscore.code, "parse");
  assert.deepEqual([underscore.start.line, underscore.start.column], [1, 12]);
  assert.match(underscore.message, /expecting newline or end/);
  assert.match(underscore.message, /'_' is not allowed/);

  const escape = first("bad-escape.gbnf");
  assert.equal(escape.code, "parse");
  assert.deepEqual([escape.start.line, escape.start.column], [1, 12]);
  assert.match(escape.message, /unknown escape '\\q'/);

  const undef = first("undefined.gbnf");
  assert.equal(undef.code, "undefined-rule");
  assert.deepEqual([undef.start.line, undef.start.column], [1, 23]);
  assert.match(undef.message, /'name'/);
  assert.equal(undef.llamaMessage, "Undefined rule identifier 'name'");
});

test("other syntax errors are reported where they happen", () => {
  const cases = [
    ['root ::= "abc', "parse", 1, 10, /never closed/],
    ["root ::= [a-z", "parse", 1, 10, /never closed/],
    ["root ::= (\"a\"", "parse", 1, 10, /expecting '\)'/],
    ["root ::= \"a\" )", "parse", 1, 14, /no matching/],
    ["root ::= *", "parse", 1, 10, /before/],
    ["root ::= \"a\"{x}", "parse", 1, 14, /number after/],
    ["root ::= \"a\"{1;", "parse", 1, 15, /','/],
    ['root ::= "\\x4"', "parse", 1, 11, /hex digits/],
    ["root = \"a\"", "parse", 1, 6, /::=/],
    ["root ::= !x", "parse", 1, 11, /'<'/],
    ["root ::= <[12>", "parse", 1, 14, /']'/],
  ];
  for (const [text, code, line, column, message] of cases) {
    const d = lib.lintGrammar(text).find((x) => x.severity === "error");
    assert.ok(d, `expected an error for ${JSON.stringify(text)}`);
    assert.equal(d.code, code, text);
    assert.deepEqual([d.start.line, d.start.column], [line, column], text);
    assert.match(d.message, message, text);
  }
});

test("offsets are code points and lines handle CRLF", () => {
  const text = 'root ::= "😀" my_rule\r\n';
  const d = lib.lintGrammar(text).find((x) => x.severity === "error");
  // "😀" is one code point, so the underscore is at column 16, not 17.
  assert.deepEqual([d.start.line, d.start.column, d.start.offset], [1, 16, 15]);
  assert.deepEqual(lib.offsetToPosition("a\r\nb\rc", 3), { offset: 3, line: 2, column: 1 });
  assert.deepEqual(lib.offsetToPosition("a\r\nb\rc", 5), { offset: 5, line: 3, column: 1 });
});

test("bad arguments throw TypeError, bad grammars never throw", () => {
  assert.throws(() => lib.lintGrammar(42), TypeError);
  assert.throws(() => lib.parseGrammar(null), TypeError);
  assert.throws(() => lib.matchSample("root ::= \"a\"", 1), TypeError);
  assert.throws(() => lib.matchSample(undefined, "a"), TypeError);
  assert.throws(() => lib.parseValidatorOutput(5), TypeError);
  for (const junk of ["", "\u0000", "::=", "root ::=", "((((", "{", "\\", "root ::= | | |"]) {
    assert.doesNotThrow(() => lib.lintGrammar(junk), JSON.stringify(junk));
  }
});

test("llama.cpp limits: nesting depth and repetition minimum", () => {
  const ok = lib.lintGrammar(fixture("bad/nesting-256.gbnf"));
  assert.deepEqual(ok.filter((d) => d.severity === "error"), []);
  const deep = first("nesting-257.gbnf");
  assert.equal(deep.code, "nesting-depth");
  const min = first("min-too-large.gbnf");
  assert.equal(min.code, "repetition-min-too-large");
  const range = first("rep-range.gbnf");
  assert.equal(range.code, "repetition-range");
});

test("a repetition count above 2^64-1 is a parse error that keeps the digits", () => {
  const r = lib.lintGrammar('root ::= "a"{0,99999999999999999999}\n');
  const d = r.find((x) => x.severity === "error");
  assert.ok(d, "expected an error");
  assert.equal(d.code, "parse");
  assert.match(d.message, /99999999999999999999 is too large/);
  assert.equal(d.start.line, 1);
  // 2^64-1 itself is accepted by the number reader (and then just clamped).
  const edge = lib.lintGrammar('root ::= "a"{0,18446744073709551615}\n');
  assert.ok(edge.every((x) => x.severity !== "error"));
  assert.ok(edge.some((x) => x.code === "max-clamped"));
  const min = lib.lintGrammar('root ::= "a"{99999999999999999999,}\n');
  assert.ok(min.some((x) => x.severity === "error" && x.code === "parse"));
});

test("an unclosed parenthesis points at the opening one as line:column", () => {
  const r = lib.lintGrammar('root ::= a\na ::= "x"\nb ::= ( "y" | "z"\n');
  const d = r.find((x) => x.severity === "error");
  assert.ok(d);
  assert.match(d.message, /opened at 3:7$/);
  assert.deepEqual([d.start.line, d.start.column], [3, 7]);
});
