import { readFileSync } from "node:fs";
import { diagnosticToJson, describeMatch, formatDiagnostic, type JsonDiagnostic } from "./format.js";
import { lintGrammar } from "./index.js";
import { langFromLocale, msg, type Lang, type MessageArgs, type MessageId } from "./messages.js";
import { matchSample } from "./match.js";
import { SourceMap } from "./position.js";
import type { MatchResult } from "./types.js";

declare const __VERSION__: string;
const VERSION = typeof __VERSION__ === "string" ? __VERSION__ : "0.0.0";

interface Args {
  files: string[];
  sampleFile?: string;
  sampleText?: string;
  json: boolean;
  strict: boolean;
  maxSteps?: number;
  maxInput?: number;
  lang?: Lang;
}

/** A usage error carries a message id so it can be printed in the chosen language. */
class UsageError extends Error {
  constructor(
    readonly id: MessageId,
    readonly args: MessageArgs = {},
  ) {
    super(id);
  }
}

/** Language from the environment: GBNF_LENS_LANG, then LC_ALL, LC_MESSAGES, LANG (first one that is set). */
function envLang(env: NodeJS.ProcessEnv): Lang {
  for (const key of ["GBNF_LENS_LANG", "LC_ALL", "LC_MESSAGES", "LANG"]) {
    const v = env[key];
    if (v !== undefined && v !== "") return langFromLocale(v);
  }
  return "en";
}

/** Check a `--lang` value (`raw` is undefined when the value is missing). Same rule before and after the command. */
function checkLang(raw: string | undefined): Lang {
  if (raw === undefined) throw new UsageError("cli.needsValue", { flag: "--lang" });
  if (raw !== "en" && raw !== "ko") throw new UsageError("cli.langInvalid", { raw });
  return raw;
}

/**
 * The `--lang` value written anywhere in `argv` (the last valid one), or `base`.
 * Used for text printed before or instead of a full parse: help and usage errors.
 */
function langInArgv(argv: string[], base: Lang): Lang {
  let lang = base;
  argv.forEach((a, i) => {
    const raw = a === "--lang" ? argv[i + 1] : a.startsWith("--lang=") ? a.slice("--lang=".length) : undefined;
    if (raw === "en" || raw === "ko") lang = raw;
  });
  return lang;
}

function parseArgs(argv0: string[], base: Lang): Args | "help" | "version" {
  const args: Args = { files: [], json: false, strict: false, lang: base };
  // `--lang ko check ...` / `--lang=ko check ...`: read a leading --lang first, then the rest as usual.
  // 값이 없거나(`gbnf-lens --lang`) 명령 이름이 값 자리에 온 경우(`--lang check x`)도 --lang 값 오류(종료 2)로 알린다.
  let argv = argv0;
  const first = argv0[0];
  if (first === "--lang") {
    args.lang = checkLang(argv0[1]);
    argv = argv0.slice(2);
  } else if (first !== undefined && first.startsWith("--lang=")) {
    args.lang = checkLang(first.slice("--lang=".length));
    argv = argv0.slice(1);
  }
  if (argv.length === 0) throw new UsageError("cli.missingCommand");
  const command = argv[0] as string;
  if (command === "-h" || command === "--help" || command === "help") return "help";
  if (command === "-v" || command === "--version") return "version";
  if (command !== "check") throw new UsageError("cli.unknownCommand", { command });
  const value = (i: number, flag: string): string => {
    const v = argv[i + 1];
    if (v === undefined) throw new UsageError("cli.needsValue", { flag });
    return v;
  };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a === "-h" || a === "--help") return "help";
    else if (a === "--json") args.json = true;
    else if (a === "--strict") args.strict = true;
    else if (a === "--lang") args.lang = checkLang(argv[++i]);
    else if (a.startsWith("--lang=")) args.lang = checkLang(a.slice("--lang=".length));
    else if (a === "--sample") args.sampleFile = value(i++, a);
    else if (a === "--sample-text") args.sampleText = value(i++, a);
    else if (a === "--max-steps") {
      const raw = value(i++, a);
      const num = Number(raw);
      if (!/^\d+$/.test(raw) || num < 1) throw new UsageError("cli.maxStepsInvalid", { raw });
      args.maxSteps = num;
    } else if (a === "--max-input") {
      const raw = value(i++, a);
      const num = Number(raw);
      if (!/^\d+$/.test(raw)) throw new UsageError("cli.maxInputInvalid", { raw });
      args.maxInput = num;
    } else if (a.startsWith("-") && a !== "-") throw new UsageError("cli.unknownOption", { option: a });
    else args.files.push(a);
  }
  if (args.files.length === 0) throw new UsageError("cli.noFiles");
  if (args.sampleFile !== undefined && args.sampleText !== undefined) throw new UsageError("cli.sampleBoth");
  return args;
}

function sampleEntry(file: string, result: MatchResult, input: string, lang: Lang): JsonDiagnostic | undefined {
  if (result.status === "reject") {
    return {
      file,
      line: result.at.line,
      column: result.at.column,
      endLine: result.at.line,
      endColumn: result.at.column + 1,
      severity: "error",
      code: "sample-rejected",
      message: describeMatch(result, input, lang)[0] as string,
    };
  }
  if (result.status === "inconclusive") {
    return { file, line: 1, column: 1, endLine: 1, endColumn: 1, severity: "warning", code: "sample-inconclusive", message: describeMatch(result, input, lang)[0] as string };
  }
  return undefined;
}

/** Run the CLI. Returns the exit code (0, 1 or 2); never calls `process.exit`. */
export function main(argv: string[], out: (s: string) => void, err: (s: string) => void, env: NodeJS.ProcessEnv = process.env): number {
  const base = envLang(env);
  let parsed: Args | "help" | "version";
  try {
    parsed = parseArgs(argv, base);
  } catch (e) {
    if (e instanceof UsageError) {
      // Usage errors use a valid --lang written anywhere on the line, else the environment's language.
      const lang = langInArgv(argv, base);
      err(`gbnf-lens: ${msg(lang, e.id, e.args)}\n\n${msg(lang, "cli.usage", { version: VERSION })}`);
      return 2;
    }
    throw e;
  }
  // `--help` may come before --lang is parsed; look it up so help uses the right language.
  if (parsed === "help") {
    out(msg(langInArgv(argv, base), "cli.usage", { version: VERSION }));
    return 0;
  }
  if (parsed === "version") {
    out(`${VERSION}\n`);
    return 0;
  }
  const args = parsed;
  const lang = args.lang ?? base;
  const t = (id: MessageId, a?: MessageArgs): string => msg(lang, id, a);

  let sample: string | undefined = args.sampleText;
  if (args.sampleFile !== undefined) {
    try {
      sample = readFileSync(args.sampleFile, "utf8");
    } catch (e) {
      err(`gbnf-lens: ${t("cli.cannotReadSample", { file: args.sampleFile, reason: (e as Error).message })}\n`);
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
      err(`gbnf-lens: ${t("cli.cannotRead", { file, reason: (e as Error).message })}\n`);
      readFailed = true;
      continue;
    }
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const diagnostics = lintGrammar(text, { lang });
    const map = new SourceMap(text);
    let fileErrors = 0;
    let fileFailed = false;
    for (const d of diagnostics) {
      if (d.severity === "error") fileErrors++;
      else if (d.severity === "warning") warnings++;
      if (args.json) json.push(diagnosticToJson(file, d));
      else out(`${formatDiagnostic(file, d, map, lang)}\n`);
    }
    errors += fileErrors;
    if (fileErrors > 0) fileFailed = true;
    if (diagnostics.some((d) => d.severity === "warning")) warned = true;

    if (sample !== undefined && fileErrors === 0) {
      const matchOptions = {
        ...(args.maxSteps !== undefined ? { maxSteps: args.maxSteps } : {}),
        ...(args.maxInput !== undefined ? { maxInputChars: args.maxInput } : {}),
      };
      const result = matchSample(text, sample, { ...matchOptions, lang });
      if (result.status === "reject") fileFailed = true;
      if (result.status === "inconclusive") warned = true;
      const entry = sampleEntry(file, result, sample, lang);
      if (args.json) {
        if (entry) json.push(entry);
      } else {
        for (const line of describeMatch(result, sample, lang)) out(`${line.startsWith("  ") ? line : `${file}: ${line}`}\n`);
      }
    } else if (sample !== undefined && !args.json) {
      out(`${file}: ${t("cli.sampleSkipped")}\n`);
    }
    if (fileFailed) failed = true;
    if (!args.json && diagnostics.length === 0 && !fileFailed) out(`${file}: ${t("cli.ok")}\n`);
  }

  if (args.json) out(`${JSON.stringify(json, null, 2)}\n`);
  else out(`${t("cli.summary", { files: args.files.length, errors, warnings })}\n`);

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
