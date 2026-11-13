// Build everything: type check + .d.ts (tsc), ESM/CJS library, CLI and the VS Code extension bundle (esbuild).
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { chmodSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
const pkg = JSON.parse(readFileSync("package.json", "utf8"));

function tsc(project) {
  const bin = join("node_modules", ".bin", process.platform === "win32" ? "tsc.cmd" : "tsc");
  const result = spawnSync(bin, ["-p", project], { stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) {
    console.error(`build: type check failed for ${project}`);
    process.exit(result.status ?? 1);
  }
}

rmSync("dist", { recursive: true, force: true });
rmSync(join("extension", "dist"), { recursive: true, force: true });

// 1. Type check (and write dist/*.d.ts for the library).
tsc("tsconfig.json");
tsc(join("extension", "tsconfig.json"));

// 2. Bundles. The library has no runtime dependencies.
const common = { bundle: true, platform: "node", target: "node20", logLevel: "warning" };
await build({ ...common, entryPoints: ["src/index.ts"], format: "esm", outfile: "dist/index.js" });
await build({ ...common, entryPoints: ["src/index.ts"], format: "cjs", outfile: "dist/index.cjs" });
await build({
  ...common,
  entryPoints: ["src/cli.ts"],
  format: "esm",
  outfile: "dist/cli.js",
  banner: { js: "#!/usr/bin/env node" },
  define: { __VERSION__: JSON.stringify(pkg.version) },
});
chmodSync("dist/cli.js", 0o755);
await build({
  ...common,
  entryPoints: ["extension/src/extension.ts"],
  format: "cjs",
  outfile: "extension/dist/extension.js",
  external: ["vscode"],
});
// Pure editor features, also bundled on their own so tests can load them without VS Code.
await build({ ...common, entryPoints: ["extension/src/features.ts"], format: "esm", outfile: "extension/dist/features.mjs" });

// Internal message tables, bundled only so tests can compare the en and ko tables (not published, not public API).
await build({ ...common, entryPoints: ["src/messages.ts"], format: "esm", outfile: "extension/dist/messages.mjs" });

console.log(`built gbnf-lens ${pkg.version}`);
