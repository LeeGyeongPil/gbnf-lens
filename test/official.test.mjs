import assert from "node:assert/strict";
import { test } from "node:test";
import { fixture, lib, read } from "./helpers.mjs";

// One sentence each official grammar must accept.
const SAMPLES = {
  "json.gbnf": '{"a": [1, 2.5, "x\\n"], "b": null}',
  "json_arr.gbnf": '[\n{"a":1},\n{"b":[true]}]',
  "arithmetic.gbnf": "1+2*(3-4)=x\n",
  "chess.gbnf": "1. e4 e5\n2. Nf3 Nc6\n",
  "c.gbnf": "int main(){return 0;}",
  "list.gbnf": "- apples\n- pears\n",
  "english.gbnf": "Hello world.",
  "japanese.gbnf": "こんにちは。",
};

test("official llama.cpp grammars: no diagnostics and sample accepted", () => {
  assert.equal(Object.keys(SAMPLES).length, 8);
  for (const [file, sample] of Object.entries(SAMPLES)) {
    const text = fixture(`grammars/${file}`);
    assert.deepEqual(lib.lintGrammar(text), [], `${file} should have no diagnostics`);
    assert.equal(lib.matchSample(text, sample).status, "accept", `${file} should accept its sample`);
  }
});

test("false positives: valid grammars written in many styles stay clean", () => {
  const valid = [
    // multi-line group with leading '|' inside parentheses (allowed because newlines are ok there)
    'root ::= (\n  "a"\n  | "b"\n)\n',
    // comments, CRLF line ends, no final newline
    '# comment\r\nroot ::= "a" # trailing\r\nitem ::= "b"\r\nroot2 ::= item',
    // escapes, ranges, negated classes, any char
    'root ::= "\\x41\\u00e9\\U0001F600\\t" [^"\\\\\\]]+ [a-z0-9_\\-]{2,} .\n',
    // bounded repetitions with a sensible size
    'root ::= ([a-z]{1,8} " "){0,20} ("x" | "y"){2}\n',
    // right recursion and mutual recursion are fine
    'root ::= list\nlist ::= "a" list | "a"\n',
    'root ::= a\na ::= "x" b | "x"\nb ::= "y" a\n',
    // a rule that may be empty used outside loops
    'root ::= ws "a" ws\nws ::= [ \\t]*\n',
    // names with digits and dashes, spaces around ::=
    "root ::= my-rule-2\nmy-rule-2   ::=   \"ok\"\n",
    // two optional items in a row are fine; only longer chains are flagged
    'root ::= "a"? "a"? "b"\n',
  ];
  for (const text of valid) {
    const found = lib.lintGrammar(text).filter((d) => d.code !== "unused-rule" || !text.includes("root2"));
    assert.deepEqual(found.filter((d) => d.severity !== "info"), [], JSON.stringify(text));
  }
  // The shipped example is also clean.
  assert.deepEqual(lib.lintGrammar(read("examples", "tool-call.gbnf")), []);
});
