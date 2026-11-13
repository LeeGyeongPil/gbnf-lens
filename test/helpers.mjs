// Shared helpers for the tests. Tests run against the built files in dist/.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const read = (...parts) => readFileSync(join(root, ...parts), "utf8");
export const fixture = (name) => read("fixtures", name);
export const cliPath = join(root, "dist", "cli.js");
export const lib = await import(pathToFileURL(join(root, "dist", "index.js")).href);

/** Environment for CLI runs that must not depend on the machine's locale: English unless a test sets a variable. */
export const cleanEnv = (extra = {}) => {
  const env = { ...process.env };
  for (const key of ["GBNF_LENS_LANG", "LC_ALL", "LC_MESSAGES", "LANG"]) delete env[key];
  return { ...env, LANG: "C", ...extra };
};
