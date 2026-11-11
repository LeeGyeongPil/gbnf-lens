import assert from "node:assert/strict";
import { test } from "node:test";
import { fixture, lib } from "./helpers.mjs";

const lint = (file) => lib.lintGrammar(fixture(`bad/${file}`));
const at = (d) => `${d.start.line}:${d.start.column}`;
const find = (ds, code, where) => ds.find((d) => d.code === code && (where === undefined || at(d) === where));

test("warns where llama.cpp silently changes meaning", () => {
  const loops = lint("loops.gbnf");
  assert.equal(find(loops, "duplicate-rule", "5:1").severity, "warning");
  assert.match(find(loops, "duplicate-rule").message, /silently keeps the last definition/);
  assert.ok(find(loops, "unused-rule", "2:1"));
  assert.ok(find(loops, "unused-rule", "3:1"));
  assert.equal(find(loops, "optional-chain", "4:19").severity, "warning");
  assert.equal(loops.filter((d) => d.severity === "error").length, 0);

  const clamp = lint("clamp.gbnf");
  assert.equal(find(clamp, "max-clamped", "1:10").severity, "warning");
  assert.match(find(clamp, "max-clamped").message, /max > 2000 as unbounded/);
  assert.equal(clamp.filter((d) => d.severity === "error").length, 0);

  const nullable = lint("nullable.gbnf");
  assert.equal(find(nullable, "nullable-loop", "1:10").severity, "warning");
  assert.equal(nullable.filter((d) => d.severity === "error").length, 0);

  const leftRec = lint("left-rec.gbnf");
  const lr = find(leftRec, "left-recursion");
  assert.equal(lr.severity, "error");
  assert.match(lr.message, /root -> expr -> expr/);
});

test("missing and undefined rules", () => {
  const noRoot = find(lint("no-root.gbnf"), "no-root");
  assert.equal(noRoot.severity, "error");
  const undef = lint("undefined.gbnf");
  assert.equal(find(undef, "undefined-rule").severity, "error");
  assert.equal(find(undef, "unused-rule", "3:1").severity, "warning");
});

test("left recursion is found through nullable prefixes and indirect cycles", () => {
  const indirect = lib.lintGrammar('root ::= a\na ::= b "x"\nb ::= a "y" | "z"\n');
  assert.match(find(indirect, "left-recursion").message, /root -> a -> b -> a/);
  const viaNullable = lib.lintGrammar('root ::= ws root "x" | "y"\nws ::= " "?\n');
  assert.ok(find(viaNullable, "left-recursion"));
  const rightRec = lib.lintGrammar('root ::= "x" root | "y"\n');
  assert.equal(find(rightRec, "left-recursion"), undefined);
});

test("token terminals are reported as info", () => {
  const ds = lint("token.gbnf");
  assert.equal(ds.filter((d) => d.code === "token-needs-vocab" && d.severity === "info").length, 2);
  assert.deepEqual(lib.lintGrammar(fixture("bad/token.gbnf"), { includeInfo: false }), []);
});

test("every diagnostic code is documented in the public list", () => {
  const all = [
    ...["bad-escape", "big-rep", "clamp", "leading-pipe", "left-rec", "loops", "min-too-large", "nesting-257", "no-root", "nullable", "rep-2000", "rep-range", "token", "undefined", "underscore"].flatMap((f) => lint(`${f}.gbnf`)),
  ];
  for (const d of all) assert.ok(lib.DIAGNOSTIC_CODES.includes(d.code), d.code);
  for (const code of ["parse", "undefined-rule", "no-root", "left-recursion", "repetition-threshold", "repetition-min-too-large", "nesting-depth", "duplicate-rule", "max-clamped", "nullable-loop", "optional-chain", "unused-rule", "large-repetition", "token-needs-vocab"]) {
    assert.ok(all.some((d) => d.code === code), `fixtures should trigger ${code}`);
  }
});
