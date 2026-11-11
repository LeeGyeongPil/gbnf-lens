// Shared helpers for the tests. Tests run against the built files in dist/.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const read = (...parts) => readFileSync(join(root, ...parts), "utf8");
export const fixture = (name) => read("fixtures", name);
export const cliPath = join(root, "dist", "cli.js");
export const lib = await import(pathToFileURL(join(root, "dist", "index.js")).href);
