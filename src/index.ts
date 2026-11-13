/**
 * gbnf-lens: lint and sample-check llama.cpp GBNF grammars before sending them to a server.
 * Everything exported here is public API; other modules are internal.
 */
import { analyzeGrammar } from "./analyze.js";
import { parseGrammar } from "./parse.js";
import type { Diagnostic, LintOptions } from "./types.js";

export { parseGrammar } from "./parse.js";
export { matchSample } from "./match.js";
export { parseValidatorOutput } from "./oracle.js";
export { offsetToPosition } from "./position.js";
export { MAX_REPETITION_THRESHOLD, GRAMMAR_RECURSIVE_LIMIT, DIAGNOSTIC_CODES } from "./types.js";
export type {
  Diagnostic,
  DiagnosticCode,
  Severity,
  Position,
  ParsedGrammar,
  Rule,
  LintOptions,
  ParseOptions,
  Language,
  MatchOptions,
  MatchResult,
  LlamaVerdict,
} from "./types.js";

/**
 * Parse and analyze a grammar and return every problem found, sorted by position.
 * Never throws for bad grammar text; throws `TypeError` if `src` is not a string.
 * An unsupported `options.lang` does not throw either: `ko…` gives Korean, anything else English.
 */
export function lintGrammar(src: string, options: LintOptions = {}): Diagnostic[] {
  const parsed = parseGrammar(src, options.lang !== undefined ? { lang: options.lang } : {});
  const includeInfo = options.includeInfo !== false;
  const all = parsed.ok ? [...parsed.diagnostics, ...analyzeGrammar(parsed, options)] : parsed.diagnostics;
  return all.filter((d) => includeInfo || d.severity !== "info").sort((a, b) => a.start.offset - b.start.offset);
}
