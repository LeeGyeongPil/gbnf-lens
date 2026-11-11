import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { root } from "./helpers.mjs";

// Patterns are built from pieces so that this file does not contain them itself.
const FORBIDDEN = ["/Us" + "ers/", "/ho" + "me/", "/private" + "/tmp", "C:\\\\Us" + "ers", "C:\\Us" + "ers"];

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

test("fixtures contain no local user paths and keep attribution", () => {
  for (const dir of ["fixtures", "test", "examples"]) {
    for (const file of walk(join(root, dir))) {
      const text = readFileSync(file, "utf8");
      for (const bad of FORBIDDEN) assert.ok(!text.includes(bad), `${file} contains a local path`);
    }
  }
  const license = readFileSync(join(root, "fixtures", "grammars", "LICENSE-llama.cpp"), "utf8");
  assert.match(license, /MIT License/);
  assert.match(license, /Permission is hereby granted, free of charge/);
  assert.match(license, /af6b524/);
  assert.match(license, /ggml-org\/llama\.cpp/);
});

test("recorded llama.cpp output is complete", () => {
  const rec = JSON.parse(readFileSync(join(root, "fixtures", "llamacpp", "cases.json"), "utf8"));
  assert.match(rec.recorded_with, /af6b524/);
  for (const c of rec.cases) assert.ok(c.output.length > 0 && c.name && c.grammar, c.name);
});
