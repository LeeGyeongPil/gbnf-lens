/**
 * Shared types and llama.cpp limits.
 *
 * The numeric limits mirror `src/llama-grammar.cpp` of llama.cpp commit af6b524
 * (checked 2026-11-11). If llama.cpp changes them, this is the only place to edit.
 */

/** `MAX_REPETITION_THRESHOLD` in llama.cpp: rule-expansion budget for `{m,n}`. */
export const MAX_REPETITION_THRESHOLD = 2000;
/** `GRAMMAR_RECURSIVE_LIMIT` in llama.cpp: maximum parenthesis nesting depth. */
export const GRAMMAR_RECURSIVE_LIMIT = 256;
/** Expanded-rule count from which `large-repetition` is reported (info). */
export const LARGE_REPETITION_INFO = 500;

export const DIAGNOSTIC_CODES = [
  "parse",
  "undefined-rule",
  "no-root",
  "left-recursion",
  "repetition-threshold",
  "repetition-min-too-large",
  "repetition-range",
  "nesting-depth",
  "duplicate-rule",
  "max-clamped",
  "nullable-loop",
  "optional-chain",
  "unused-rule",
  "large-repetition",
  "token-needs-vocab",
] as const;

export type DiagnosticCode = (typeof DIAGNOSTIC_CODES)[number];
export type Severity = "error" | "warning" | "info";

/** A location in the grammar text. `offset` and `column` count Unicode code points (like llama.cpp). */
export interface Position {
  /** 0-based offset in code points. */
  offset: number;
  /** 1-based line. */
  line: number;
  /** 1-based column in code points. */
  column: number;
}

export interface Diagnostic {
  severity: Severity;
  code: DiagnosticCode;
  /** Human-readable explanation with a hint on how to fix it. */
  message: string;
  start: Position;
  end: Position;
  /** Name of the rule the diagnostic belongs to, when there is one. */
  rule?: string;
  /** The message llama.cpp itself prints for the same problem, when it rejects the grammar. */
  llamaMessage?: string;
}

/** Offsets in the AST are 0-based code-point offsets; convert with `offsetToPosition`. */
export interface Span {
  start: number;
  end: number;
}

export interface LiteralNode extends Span {
  kind: "literal";
  codePoints: number[];
}

export interface ClassRange {
  from: number;
  to: number;
}

export interface ClassNode extends Span {
  kind: "class";
  negated: boolean;
  ranges: ClassRange[];
  /** Original text, e.g. `[0-9a-f]`, used in messages. */
  text: string;
}

export interface AnyNode extends Span {
  kind: "any";
}

export interface TokenNode extends Span {
  kind: "token";
  negated: boolean;
  /** Original text, e.g. `<think>` or `<[1234]>`. */
  text: string;
}

export interface RefNode extends Span {
  kind: "ref";
  name: string;
}

export interface GroupNode extends Span {
  kind: "group";
  body: AltNode;
}

export interface RepeatNode extends Span {
  kind: "repeat";
  item: Item;
  min: number;
  /** `null` means unbounded (`*`, `+`, `{m,}` or a clamped `{m,n}` with n > 2000). */
  max: number | null;
}

export type Item = LiteralNode | ClassNode | AnyNode | TokenNode | RefNode | GroupNode | RepeatNode;

export interface SeqNode extends Span {
  kind: "seq";
  items: Item[];
}

export interface AltNode extends Span {
  kind: "alt";
  alts: SeqNode[];
}

export interface Rule extends Span {
  name: string;
  nameStart: number;
  nameEnd: number;
  body: AltNode;
}

export interface ParsedGrammar {
  /** `true` when the whole text was parsed without a syntax error. */
  ok: boolean;
  /** All rule definitions in source order (a name defined twice appears twice; llama.cpp keeps the last). */
  rules: Rule[];
  /** Problems found while parsing (syntax errors, duplicates, repetition limits). */
  diagnostics: Diagnostic[];
  /** The source text, kept for position conversion. */
  source: string;
}

/**
 * Language of human-readable messages. Diagnostic codes and llama.cpp's own text are never translated.
 * Other values passed at run time (for example from plain JavaScript) never throw: a string that
 * starts with `ko` ("ko-KR", "KO", "ko_KR.UTF-8") gives Korean, anything else ("fr", "EN") gives English.
 */
export type Language = "en" | "ko";

export interface ParseOptions {
  /** Language of `Diagnostic.message`. Default `"en"`; see {@link Language} for other values. */
  lang?: Language;
}

export interface LintOptions {
  /** Also report `info` level hints. Default `true`. */
  includeInfo?: boolean;
  /** Language of `Diagnostic.message`. Default `"en"`; see {@link Language} for other values. */
  lang?: Language;
}

export interface MatchOptions {
  /** Start rule. Default `root`. */
  root?: string;
  /** Inputs longer than this many code points are `inconclusive`. Default 100000. */
  maxInputChars?: number;
  /** Work budget; exceeding it gives `inconclusive`. Default 5000000. */
  maxSteps?: number;
  /**
   * Language of the messages in `grammar-error` diagnostics and of the `expected` names
   * ("any character", "end of input") in a `reject`. Default `"en"`; see {@link Language} for other values.
   */
  lang?: Language;
}

export type MatchResult =
  | { status: "accept" }
  | {
      status: "reject";
      reason: "unexpected-char" | "unexpected-end";
      at: Position;
      /** Descriptions of what the grammar would have accepted at `at`, e.g. `"}"` or `[0-9]`. */
      expected: string[];
    }
  | {
      status: "inconclusive";
      /**
       * `budget`: work budget used up (raise `maxSteps`); `input-too-long`: sample longer than
       * `limit` code points (raise `maxInputChars`); `stack-depth`: right recursion too deep for
       * the matcher (neither option helps); `needs-vocab`: the grammar uses token terminals.
       */
      reason: "budget" | "needs-vocab" | "input-too-long" | "stack-depth";
      /** For `input-too-long`: the limit that was exceeded, in code points. */
      limit?: number;
    }
  | { status: "grammar-error"; diagnostics: Diagnostic[] };

export type LlamaVerdict =
  | { kind: "valid" }
  | { kind: "invalid"; reason: "unexpected-char" | "unexpected-end"; offset: number }
  | { kind: "grammar-error"; code: DiagnosticCode | "unknown"; message: string };
