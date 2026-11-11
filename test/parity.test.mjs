import assert from "node:assert/strict";
import { test } from "node:test";
import { fixture, lib } from "./helpers.mjs";

const recording = JSON.parse(fixture("llamacpp/cases.json"));

/** Our verdict for a grammar and a sample, in the same shape as parseValidatorOutput(). */
function ourVerdict(grammarText, sample) {
  const firstError = lib.lintGrammar(grammarText).find((d) => d.severity === "error");
  if (firstError) return { kind: "grammar-error", code: firstError.code };
  const result = lib.matchSample(grammarText, sample);
  if (result.status === "accept") return { kind: "valid" };
  if (result.status === "reject") return { kind: "invalid", reason: result.reason, offset: result.at.offset };
  return { kind: result.status };
}

test("agrees with recorded llama.cpp af6b524 verdicts", (t) => {
  assert.equal(recording.cases.length, 14);
  const mismatches = [];
  for (const c of recording.cases) {
    const llama = lib.parseValidatorOutput(c.output);
    const ours = ourVerdict(fixture(c.grammar), c.sample);
    const same =
      llama.kind === ours.kind &&
      (llama.kind === "valid" ||
        (llama.kind === "invalid" && llama.reason === ours.reason && llama.offset === ours.offset) ||
        (llama.kind === "grammar-error" && llama.code === ours.code));
    if (!same) mismatches.push(`${c.name}: llama.cpp ${JSON.stringify(llama)} vs gbnf-lens ${JSON.stringify(ours)}`);
  }
  t.diagnostic(`${recording.cases.length - mismatches.length}/${recording.cases.length} cases agree with the recording`);
  assert.deepEqual(mismatches, []);
});

test("parseValidatorOutput understands each kind of output", () => {
  assert.deepEqual(lib.parseValidatorOutput("Input string is valid according to the grammar.\n"), { kind: "valid" });
  assert.deepEqual(
    lib.parseValidatorOutput("\u001b[31mInput string is invalid according to the grammar.\u001b[0m\nError: Unexpected character '\n' at position 3\n"),
    { kind: "invalid", reason: "unexpected-char", offset: 3 },
  );
  assert.deepEqual(lib.parseValidatorOutput("Input string is invalid according to the grammar.\nError: Unexpected end of input at position 9"), {
    kind: "invalid",
    reason: "unexpected-end",
    offset: 9,
  });
  const g = lib.parseValidatorOutput("parse: error parsing grammar: expecting name at | \"b\"\nroot ::= a\n");
  assert.equal(g.kind, "grammar-error");
  assert.equal(g.code, "parse");
  assert.equal(lib.parseValidatorOutput("something unexpected\n").code, "unknown");
  assert.equal(lib.parseValidatorOutput("").code, "unknown");
});
