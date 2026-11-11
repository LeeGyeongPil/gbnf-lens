import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { fixture, root } from "./helpers.mjs";

test("ESM and CJS entry points both load", async () => {
  const esm = await import(pathToFileURL(join(root, "dist", "index.js")).href);
  const require = createRequire(import.meta.url);
  const cjs = require(join(root, "dist", "index.cjs"));
  for (const name of ["parseGrammar", "lintGrammar", "matchSample", "parseValidatorOutput", "offsetToPosition"]) {
    assert.equal(typeof esm[name], "function", `ESM ${name}`);
    assert.equal(typeof cjs[name], "function", `CJS ${name}`);
  }
  const text = fixture("bad/loops.gbnf");
  assert.deepEqual(esm.lintGrammar(text), cjs.lintGrammar(text));
  assert.ok(esm.lintGrammar(text).length > 0);
  assert.ok(existsSync(join(root, "dist", "index.d.ts")));

  // The package name resolves through its own `exports` map in both module systems.
  const selfEsm = await import("gbnf-lens");
  assert.equal(typeof selfEsm.lintGrammar, "function");
  assert.equal(typeof require("gbnf-lens").lintGrammar, "function");
});

test("npm pack lists the files that must be published", () => {
  const r = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: root, encoding: "utf8", timeout: 60000 });
  assert.equal(r.status, 0, r.stderr);
  const files = JSON.parse(r.stdout)[0].files.map((f) => f.path);
  for (const must of ["dist/cli.js", "dist/index.cjs", "dist/index.js", "dist/index.d.ts", "LICENSE", "package.json"]) {
    assert.ok(files.includes(must), `${must} missing from ${files.join(", ")}`);
  }
  assert.ok(!files.some((f) => f.startsWith("test/") || f.startsWith("fixtures/")), "tests and fixtures are not published");
});
