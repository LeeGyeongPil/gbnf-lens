import { readFileSync } from "node:fs";
import { diagnosticToJson, describeMatch, formatDiagnostic, type JsonDiagnostic } from "./format.js";
import { lintGrammar } from "./index.js";
import { matchSample } from "./match.js";
import { SourceMap } from "./position.js";
import type { MatchResult } from "./types.js";

declare const __VERSION__: string;
const VERSION = typeof __VERSION__ === "string" ? __VERSION__ : "0.0.0";

const USAGE = `gbnf-lens ${VERSION} - check llama.cpp GBNF grammars before you send them to a server

Usage:
  gbnf-lens check <files...> [options]

Options:
  --sample <file>       also check that the text in <file> is accepted by each grammar
  --sample-text <text>  same, with the sample given on the command line
  --json                print a JSON array of diagnostics instead of text
  --strict              exit 1 on warnings too
  --max-steps <n>       work budget for sample matching (default 5000000)
  --max-input <n>       longest sample in characters (code points) to check (default 100000)
  -h, --help            show this help
  -v, --version         show the version

Exit codes: 0 ok, 1 errors or rejected sample (or warnings with --strict), 2 usage or file error.
`;

interface Args {
  files: string[];
  sampleFile?: string;
  sampleText?: string;
  json: boolean;
  strict: boolean;
  maxSteps?: number;
  maxInput?: number;
}

class UsageError extends Error {}

function parseArgs(argv: string[]): Args | "help" | "version" {
  const args: Args = { files: [], json: false, strict: false };
  if (argv.length === 0) throw new UsageError("missing command; try `gbnf-lens check <files...>`");
  const command = argv[0];
  if (command === "-h" || command === "--help" || command === "help") return "help";
  if (command === "-v" || command === "--version") return "version";
  if (command !== "check") throw new UsageError(`unknown command '${command}'; the only command is 'check'`);
  const value = (i: number, flag: string): string => {
    const v = argv[i + 1];
    if (v === undefined) throw new UsageError(`${flag} needs a value`);
    return v;
  };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a === "-h" || a === "--help") return "help";
    else if (a === "--json") args.json = true;
    else if (a === "--strict") args.strict = true;
    else if (a === "--sample") args.sampleFile = value(i++, a);
    else if (a === "--sample-text") args.sampleText = value(i++, a);
    else if (a === "--max-steps") {
      const raw = value(i++, a);
      const num = Number(raw);
      if (!/^\d+$/.test(raw) || num < 1) throw new UsageError(`--max-steps needs a positive whole number, got '${raw}'`);
      args.maxSteps = num;
    } else if (a === "--max-input") {
      const raw = value(i++, a);
      const num = Number(raw);
      if (!/^\d+$/.test(raw)) throw new UsageError(`--max-input needs a non-negative whole number, got '${raw}'`);
      args.maxInput = num;
    } else if (a.startsWith("-") && a !== "-") throw new UsageError(`unknown option '${a}'`);
    else args.files.push(a);
  }
  if (args.files.length === 0) throw new UsageError("no grammar files given; try `gbnf-lens check grammar.gbnf`");
  if (args.sampleFile !== undefined && args.sampleText !== undefined) throw new UsageError("use either --sample or --sample-text, not both");
  return args;
}

function sampleEntry(file: string, result: MatchResult, input: string): JsonDiagnostic | undefined {
  if (result.status === "reject") {
    return {
      file,
      line: result.at.line,
      column: result.at.column,
      endLine: result.at.line,
      endColumn: result.at.column + 1,
      severity: "error",
      code: "sample-rejected",
      message: describeMatch(result, input)[0] as string,
    };
  }
  if (result.status === "inconclusive") {
    return { file, line: 1, column: 1, endLine: 1, endColumn: 1, severity: "warning", code: "sample-inconclusive", message: describeMatch(result, input)[0] as string };
  }
  return undefined;
}

/** Run the CLI. Returns the exit code (0, 1 or 2); never calls `process.exit`. */
export function main(argv: string[], out: (s: string) => void, err: (s: string) => void): number {
  let parsed: Args | "help" | "version";
  try {
    parsed = parseArgs(argv);
  } catch (e) {
    if (e instanceof UsageError) {
      err(`gbnf-lens: ${e.message}\n\n${USAGE}`);
      return 2;
    }
    throw e;
  }
  if (parsed === "help") {
    out(USAGE);
    return 0;
  }
  if (parsed === "version") {
    out(`${VERSION}\n`);
    return 0;
  }
  const args = parsed;

  let sample: string | undefined = args.sampleText;
  if (args.sampleFile !== undefined) {
    try {
      sample = readFileSync(args.sampleFile, "utf8");
    } catch (e) {
      err(`gbnf-lens: cannot read sample file '${args.sampleFile}': ${(e as Error).message}\n`);
      return 2;
    }
  }

  let readFailed = false;
  let failed = false;
  let warned = false;
  let errors = 0;
  let warnings = 0;
  const json: JsonDiagnostic[] = [];

  for (const file of args.files) {
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch (e) {
      err(`gbnf-lens: cannot read '${file}': ${(e as Error).message}\n`);
      readFailed = true;
      continue;
    }
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const diagnostics = lintGrammar(text);
    const map = new SourceMap(text);
    let fileErrors = 0;
    let fileFailed = false;
    for (const d of diagnostics) {
      if (d.severity === "error") fileErrors++;
      else if (d.severity === "warning") warnings++;
      if (args.json) json.push(diagnosticToJson(file, d));
      else out(`${formatDiagnostic(file, d, map)}\n`);
    }
    errors += fileErrors;
    if (fileErrors > 0) fileFailed = true;
    if (diagnostics.some((d) => d.severity === "warning")) warned = true;

    if (sample !== undefined && fileErrors === 0) {
      const matchOptions = {
        ...(args.maxSteps !== undefined ? { maxSteps: args.maxSteps } : {}),
        ...(args.maxInput !== undefined ? { maxInputChars: args.maxInput } : {}),
      };
      const result = matchSample(text, sample, matchOptions);
      if (result.status === "reject") fileFailed = true;
      if (result.status === "inconclusive") warned = true;
      const entry = sampleEntry(file, result, sample);
      if (args.json) {
        if (entry) json.push(entry);
      } else {
        for (const line of describeMatch(result, sample)) out(`${line.startsWith("  ") ? line : `${file}: ${line}`}\n`);
      }
    } else if (sample !== undefined && !args.json) {
      out(`${file}: sample not checked because the grammar has errors\n`);
    }
    if (fileFailed) failed = true;
    if (!args.json && diagnostics.length === 0 && !fileFailed) out(`${file}: ok\n`);
  }

  if (args.json) out(`${JSON.stringify(json, null, 2)}\n`);
  else out(`checked ${args.files.length} file(s): ${errors} error(s), ${warnings} warning(s)\n`);

  if (readFailed) return 2;
  if (failed || (args.strict && warned)) return 1;
  return 0;
}

// This module is the CLI entry point: bundled as dist/cli.js and run by the `gbnf-lens` bin.
process.exitCode = main(
  process.argv.slice(2),
  (s) => void process.stdout.write(s),
  (s) => void process.stderr.write(s),
);
