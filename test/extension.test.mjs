import assert from "node:assert/strict";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { fixture, read, root } from "./helpers.mjs";

const features = await import(pathToFileURL(join(root, "extension", "dist", "features.mjs")).href);

test("extension features work without VS Code", () => {
  // Diagnostics: 0-based lines, UTF-16 columns. Japanese text first, then an emoji before the error.
  const text = `${fixture("grammars/japanese.gbnf")}\nbad ::= "😀" my_rule\n`;
  const diags = features.computeDiagnostics(text);
  const err = diags.find((d) => d.severity === "error");
  const lines = text.split("\n");
  const line = lines.findIndex((l) => l.startsWith("bad ::="));
  assert.equal(err.startLine, line);
  // 'bad ::= "😀" my' is 15 UTF-16 units before the underscore (the emoji takes 2), 14 code points.
  assert.equal(err.startCharacter, lines[line].indexOf("_"));
  assert.equal(err.startCharacter, 15);
  assert.equal(err.code, "parse");
  assert.equal(err.endLine, line);
  assert.equal(err.endCharacter, err.startCharacter + 1);
  assert.deepEqual(features.computeDiagnostics(fixture("grammars/json.gbnf")), []);

  // Go to definition from a reference, from inside a longer line, and not from strings or comments.
  const g = 'root ::= value "value"\nvalue ::= "x" # value\nvalue ::= "y"\n';
  const def = features.findDefinition(g, 0, 11);
  assert.deepEqual(def, { line: 2, character: 0, endLine: 2, endCharacter: 5 }); // the last definition wins
  assert.equal(features.findDefinition(g, 0, 17), null); // inside "value"
  assert.equal(features.findDefinition(g, 1, 17), null); // inside the comment
  assert.equal(features.findDefinition(g, 99, 0), null);
  assert.equal(features.findDefinition("root ::= nothere\n", 0, 11), null);
  // Still works while another rule has a syntax error.
  assert.ok(features.findDefinition('root ::= a\na ::= "x" my_bad\n', 0, 10));

  // Sample check wording.
  const ok = features.checkSample('root ::= "a"\n', "a");
  assert.equal(ok.ok, true);
  const bad = features.checkSample('root ::= "a"\n', "b");
  assert.equal(bad.ok, false);
  assert.match(bad.message, /sample rejected at 1:1/);
  assert.deepEqual(bad.location, { line: 0, character: 0 });
  assert.equal(features.checkSample("root ::= x\n", "a").ok, false);
  assert.equal(features.checkSample(fixture("bad/token.gbnf"), "<think>abc").ok, null);
});

test("extension manifest and bundle", () => {
  const manifest = JSON.parse(read("extension", "package.json"));
  assert.ok(manifest.activationEvents.includes("onLanguage:gbnf"));
  assert.ok(manifest.contributes.languages.some((l) => l.id === "gbnf" && l.extensions.includes(".gbnf")));
  assert.ok(manifest.contributes.commands.some((c) => c.command === "gbnf-lens.checkSample"));
  assert.match(manifest.engines.vscode, /^\^1\.90\./);
  const grammar = JSON.parse(read("extension", "syntaxes", "gbnf.tmLanguage.json"));
  assert.equal(grammar.scopeName, "source.gbnf");
  JSON.parse(read("extension", "language-configuration.json"));

  const bundle = read("extension", "dist", "extension.js");
  assert.match(bundle, /require\("vscode"\)/); // vscode stays an external module
  assert.match(bundle, /gbnf-lens\.checkSample/);
  assert.match(bundle, /exports|module\.exports/);
});
