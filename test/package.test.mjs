import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
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
  // npm 10 (the npm that comes with Node 20 and 22) runs the "prepare" script on `npm pack` of a folder
  // even with --ignore-scripts (its pacote < 20 ignores the flag there). Our "prepare" is the full build:
  // it deletes dist/ while the other test files are running and prints to stdout before the JSON.
  // So we pack a copy whose package.json has no scripts. The file list does not depend on scripts.
  const builtAt = statSync(join(root, "dist", "cli.js")).mtimeMs;
  const dir = mkdtempSync(join(tmpdir(), "gbnf-lens-pack-"));
  try {
    cpSync(root, dir, { recursive: true, filter: (src) => !["node_modules", ".git"].includes(basename(src)) });
    const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    delete manifest.scripts; // nothing left for any npm version to run
    writeFileSync(join(dir, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);

    const r = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: dir, encoding: "utf8", timeout: 60000 });
    assert.equal(r.status, 0, r.stderr);
    const files = JSON.parse(r.stdout)[0].files.map((f) => f.path);
    for (const must of ["dist/cli.js", "dist/index.cjs", "dist/index.js", "dist/index.d.ts", "LICENSE", "package.json"]) {
      assert.ok(files.includes(must), `${must} missing from ${files.join(", ")}`);
    }
    assert.ok(!files.some((f) => f.startsWith("test/") || f.startsWith("fixtures/")), "tests and fixtures are not published");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  // Regression guard: packing must never rebuild the real dist/ under the other tests.
  assert.equal(statSync(join(root, "dist", "cli.js")).mtimeMs, builtAt, "npm pack rebuilt dist/ during the tests");
});
