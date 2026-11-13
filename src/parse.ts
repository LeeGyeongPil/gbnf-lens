import { langFromLocale, msg, type MessageArgs, type MessageId } from "./messages.js";
import { SourceMap, codePointsToString } from "./position.js";
import { SymbolCounter, costRepetition } from "./repeat-cost.js";
import {
  GRAMMAR_RECURSIVE_LIMIT,
  LARGE_REPETITION_INFO,
  MAX_REPETITION_THRESHOLD,
  type AltNode,
  type ClassRange,
  type Diagnostic,
  type DiagnosticCode,
  type Item,
  type ParseOptions,
  type ParsedGrammar,
  type Rule,
  type SeqNode,
  type Severity,
} from "./types.js";

/** A syntax error: parsing stops at the first one, exactly like llama.cpp. */
class ParseFail extends Error {
  constructor(
    readonly code: DiagnosticCode,
    message: string,
    readonly start: number,
    readonly end: number,
    readonly llamaMessage: string,
  ) {
    super(message);
  }
}

const isDigit = (c: number): boolean => c >= 0x30 && c <= 0x39;
const isWord = (c: number): boolean =>
  (c >= 0x61 && c <= 0x7a) || (c >= 0x41 && c <= 0x5a) || c === 0x2d || isDigit(c);

const QUOTE = 0x22;
const BACKSLASH = 0x5c;

/**
 * Parse GBNF text with the same rules as llama.cpp's `parse_space`, `parse_name`,
 * `parse_sequence` and `parse_alternates`. Never throws for bad grammar text: syntax
 * errors come back as `diagnostics` and `ok === false`.
 */
export function parseGrammar(src: string, options: ParseOptions = {}): ParsedGrammar {
  if (typeof src !== "string") throw new TypeError("parseGrammar: `src` must be a string containing GBNF text");
  // 지원 밖 lang("ko-KR"·"fr"·null 옵션 등)도 예외 없이 en/ko 로 정규화한다.
  const lang = langFromLocale(options?.lang);
  const t = (id: MessageId, args?: MessageArgs): string => msg(lang, id, args);

  const map = new SourceMap(src);
  const s = map.codePoints;
  const n = s.length;
  const diagnostics: Diagnostic[] = [];
  const rules: Rule[] = [];
  const counter = new SymbolCounter();
  let pos = 0;

  const at = (p: number): number => (p < n ? (s[p] as number) : -1);
  /** What llama.cpp prints after "at": the rest of the grammar text. */
  const rest = (p: number): string => codePointsToString(s, p, n);
  const text = (from: number, to: number): string => codePointsToString(s, from, to);
  const show = (c: number): string => (c < 0 ? t("parse.endOfInputShort") : `'${text(pos, pos + 1)}'`);

  const diag = (
    severity: Severity,
    code: DiagnosticCode,
    message: string,
    start: number,
    end: number,
    extra: { rule?: string; llamaMessage?: string } = {},
  ): Diagnostic => {
    const e = end > start ? end : Math.min(start + 1, n);
    const d: Diagnostic = { severity, code, message, start: map.position(start), end: map.position(e) };
    if (extra.rule !== undefined) d.rule = extra.rule;
    if (extra.llamaMessage) d.llamaMessage = extra.llamaMessage;
    return d;
  };

  /** `parse_space`: blanks, comments and (when allowed) newlines. */
  const space = (p: number, newlineOk: boolean): number => {
    let q = p;
    for (;;) {
      const c = at(q);
      if (c === 0x20 || c === 0x09 || (newlineOk && (c === 0x0d || c === 0x0a))) q++;
      else if (c === 0x23) {
        while (q < n && at(q) !== 0x0d && at(q) !== 0x0a) q++;
      } else return q;
    }
  };

  /** `parse_hex`: exactly `size` hex digits after `\x`, `\u` or `\U`. */
  const hex = (size: number, escapeStart: number): number => {
    let value = 0;
    let q = pos;
    for (; q < pos + size; q++) {
      const c = at(q);
      let d: number;
      if (c >= 0x61 && c <= 0x66) d = c - 0x61 + 10;
      else if (c >= 0x41 && c <= 0x46) d = c - 0x41 + 10;
      else if (isDigit(c)) d = c - 0x30;
      else break;
      value = value * 16 + d;
    }
    if (q !== pos + size) {
      throw new ParseFail(
        "parse",
        t("parse.hex", { size, escape: text(escapeStart, escapeStart + 2) }),
        escapeStart,
        Math.min(q + 1, n),
        `expecting ${size} hex chars at ${rest(pos)}`,
      );
    }
    pos += size;
    return value;
  };

  /** `parse_char`: one literal character or escape sequence inside "..." or [...]. */
  const char = (): number => {
    const c = at(pos);
    if (c === BACKSLASH) {
      const start = pos;
      const e = at(pos + 1);
      pos += 2;
      switch (e) {
        case 0x78: return hex(2, start); // \x
        case 0x75: return hex(4, start); // \u
        case 0x55: return hex(8, start); // \U
        case 0x74: return 9; // \t
        case 0x72: return 13; // \r
        case 0x6e: return 10; // \n
        case BACKSLASH:
        case QUOTE:
        case 0x5b: // [
        case 0x5d: // ]
        case 0x2d: // -
          return e;
        default: {
          const shown = e < 0 ? "" : text(start + 1, start + 2);
          throw new ParseFail(
            "parse",
            t("parse.unknownEscape", { ch: shown }),
            start,
            Math.min(start + 2, n),
            `unknown escape at ${rest(start)}`,
          );
        }
      }
    }
    if (c < 0) throw new ParseFail("parse", t("parse.endOfInput"), n, n, "unexpected end of input");
    pos++;
    return c;
  };

  /**
   * Read a decimal number. For repetition counts, a value above 2^64-1 is a parse error: llama.cpp
   * reads it with `std::stoull`, which throws `out_of_range`. (Source reading only; not run
   * against a llama.cpp binary.) The message keeps the digits exactly as written.
   */
  const parseInt10 = (checkU64 = false): number => {
    const start = pos;
    while (isDigit(at(pos))) pos++;
    const digits = text(start, pos);
    if (checkU64 && BigInt(digits) > 18446744073709551615n) {
      throw new ParseFail(
        "parse",
        t("parse.numberTooLarge", { digits, threshold: MAX_REPETITION_THRESHOLD }),
        start,
        pos,
        "stoull",
      );
    }
    return Number(digits);
  };

  /** `parse_token`: `<name>` or `<[id]>`, optionally preceded by `!`. */
  const token = (negated: boolean, start: number): Item => {
    const fail = (message: string, llama: string): never => {
      throw new ParseFail("parse", message, pos, Math.min(pos + 1, n), `${llama} at ${rest(pos)}`);
    };
    if (at(pos) !== 0x3c) fail(t("parse.tokenLt"), "expecting '<'");
    pos++;
    if (at(pos) === 0x5b) {
      pos++;
      if (!isDigit(at(pos))) fail(t("parse.tokenId"), "expecting integer");
      parseInt10();
      if (at(pos) !== 0x5d) fail(t("parse.tokenBracket"), "expecting ']'");
      pos++;
      if (at(pos) !== 0x3e) fail(t("parse.tokenGt"), "expecting '>'");
      pos++;
    } else {
      while (pos < n && at(pos) !== 0x3e) pos++;
      if (at(pos) !== 0x3e) fail(t("parse.tokenClose"), "expecting '>'");
      pos++;
    }
    return { kind: "token", negated, text: text(start, pos), start, end: pos };
  };

  /** `parse_sequence` */
  const sequence = (nested: boolean, depth: number): SeqNode => {
    const seqStart = pos;
    const items: Item[] = [];
    // llama.cpp: number of rules the last item stands for; repetitions multiply it.
    let nPrevRules = 1;

    /** `handle_repetitions`, costed by arithmetic instead of expansion. */
    const repeat = (min: number, max: number | null, opStart: number, opEnd: number): void => {
      const prev = items[items.length - 1];
      if (prev === undefined) {
        throw new ParseFail(
          "parse",
          t("parse.repeatNoItem"),
          opStart,
          Math.min(opStart + 1, n),
          `expecting preceding item to */+/?/{ at ${rest(pos)}`,
        );
      }
      const cost = costRepetition(nPrevRules, min, max);
      if (cost.overLimit) {
        throw new ParseFail(
          "repetition-threshold",
          t("parse.repeatThreshold", { prev: nPrevRules, total: cost.totalRules, product: cost.product, threshold: MAX_REPETITION_THRESHOLD }),
          prev.start,
          opEnd,
          "number of rules that are going to be repeated multiplied by the new repetition exceeds sane defaults, " +
            "please reduce the number of repetitions or rule complexity",
        );
      }
      if (cost.invalidRange) {
        throw new ParseFail(
          "repetition-range",
          t("parse.repeatRange", { min, max: String(max) }),
          prev.start,
          opEnd,
          "",
        );
      }
      const label = max === null ? `{${min},}` : `{${min},${max}}`;
      if (cost.clamped) {
        diagnostics.push(
          diag(
            "warning",
            "max-clamped",
            t("parse.maxClamped", { label, min, threshold: MAX_REPETITION_THRESHOLD }),
            prev.start,
            opEnd,
          ),
        );
      } else if (cost.product >= LARGE_REPETITION_INFO) {
        diagnostics.push(
          diag(
            "info",
            "large-repetition",
            t("parse.largeRepetition", { product: cost.product, threshold: MAX_REPETITION_THRESHOLD }),
            prev.start,
            opEnd,
          ),
        );
      }
      counter.generate(cost.helperRules);
      nPrevRules *= cost.totalRules;
      items[items.length - 1] = { kind: "repeat", item: prev, min, max: cost.effectiveMax, start: prev.start, end: opEnd };
    };

    while (pos < n) {
      const c = at(pos);
      const start = pos;
      if (c === QUOTE) {
        pos++;
        const codePoints: number[] = [];
        while (at(pos) !== QUOTE) {
          if (pos >= n) {
            throw new ParseFail(
              "parse",
              t("parse.stringUnclosed"),
              start,
              n,
              "unexpected end of input",
            );
          }
          codePoints.push(char());
        }
        pos++;
        const end = pos;
        pos = space(pos, nested);
        nPrevRules = 1;
        items.push({ kind: "literal", codePoints, start, end });
      } else if (c === 0x5b) {
        pos++;
        let negated = false;
        if (at(pos) === 0x5e) {
          negated = true;
          pos++;
        }
        const ranges: ClassRange[] = [];
        while (at(pos) !== 0x5d) {
          if (pos >= n) {
            throw new ParseFail(
              "parse",
              t("parse.classUnclosed"),
              start,
              n,
              "unexpected end of input",
            );
          }
          const from = char();
          let to = from;
          if (at(pos) === 0x2d && at(pos + 1) !== 0x5d) {
            if (pos + 1 >= n) throw new ParseFail("parse", t("parse.classDash"), pos, n, "unexpected end of input");
            pos++;
            to = char();
          }
          ranges.push({ from, to });
        }
        pos++;
        const end = pos;
        pos = space(pos, nested);
        nPrevRules = 1;
        items.push({ kind: "class", negated, ranges, text: text(start, end), start, end });
      } else if (c === 0x3c || c === 0x21) {
        const negated = c === 0x21;
        if (negated) pos++;
        const item = token(negated, start);
        pos = space(pos, nested);
        nPrevRules = 1;
        items.push(item);
      } else if (isWord(c)) {
        while (isWord(at(pos))) pos++;
        const end = pos;
        const name = text(start, end);
        counter.seen(name);
        pos = space(pos, nested);
        nPrevRules = 1;
        items.push({ kind: "ref", name, start, end });
      } else if (c === 0x28) {
        if (depth >= GRAMMAR_RECURSIVE_LIMIT) {
          throw new ParseFail(
            "nesting-depth",
            t("parse.nestingDepth", { limit: GRAMMAR_RECURSIVE_LIMIT }),
            start,
            start + 1,
            `grammar recursion depth limit exceeded (max ${GRAMMAR_RECURSIVE_LIMIT}), please reduce nesting depth`,
          );
        }
        pos = space(pos + 1, true);
        const before = counter.size;
        counter.generate(1);
        const body = alternates(true, depth + 1);
        nPrevRules = Math.max(1, counter.size - before);
        if (at(pos) !== 0x29) {
          throw new ParseFail(
            "parse",
            t("parse.parenClose", { line: map.position(start).line, column: map.position(start).column }),
            start,
            start + 1,
            `expecting ')' at ${rest(pos)}`,
          );
        }
        pos++;
        const end = pos;
        pos = space(pos, nested);
        items.push({ kind: "group", body, start, end });
      } else if (c === 0x2e) {
        pos++;
        const end = pos;
        pos = space(pos, nested);
        nPrevRules = 1;
        items.push({ kind: "any", start, end });
      } else if (c === 0x2a || c === 0x2b || c === 0x3f) {
        pos = space(pos + 1, nested);
        if (c === 0x2a) repeat(0, null, start, start + 1);
        else if (c === 0x2b) repeat(1, null, start, start + 1);
        else repeat(0, 1, start, start + 1);
      } else if (c === 0x7b) {
        pos = space(pos + 1, nested);
        if (!isDigit(at(pos))) {
          throw new ParseFail("parse", t("parse.braceNumber"), pos, Math.min(pos + 1, n), `expecting an int at ${rest(pos)}`);
        }
        const min = parseInt10(true);
        pos = space(pos, nested);
        let max: number | null = null;
        let opEnd = pos;
        if (at(pos) === 0x7d) {
          max = min;
          opEnd = pos + 1;
          pos = space(pos + 1, nested);
        } else if (at(pos) === 0x2c) {
          pos = space(pos + 1, nested);
          if (isDigit(at(pos))) {
            max = parseInt10(true);
            pos = space(pos, nested);
          }
          if (at(pos) !== 0x7d) {
            throw new ParseFail("parse", t("parse.braceClose"), pos, Math.min(pos + 1, n), `expecting '}' at ${rest(pos)}`);
          }
          opEnd = pos + 1;
          pos = space(pos + 1, nested);
        } else {
          throw new ParseFail("parse", t("parse.braceComma"), pos, Math.min(pos + 1, n), `expecting ',' at ${rest(pos)}`);
        }
        if (min > MAX_REPETITION_THRESHOLD) {
          const prev = items[items.length - 1];
          throw new ParseFail(
            "repetition-min-too-large",
            t("parse.minTooLarge", { min, threshold: MAX_REPETITION_THRESHOLD }),
            prev ? prev.start : start,
            opEnd,
            "number of repetitions exceeds sane defaults, please reduce the number of repetitions",
          );
        }
        repeat(min, max, start, opEnd);
      } else break;
    }
    const last = items[items.length - 1];
    return { kind: "seq", items, start: seqStart, end: last ? last.end : seqStart };
  };

  /** `parse_alternates` */
  const alternates = (nested: boolean, depth: number): AltNode => {
    const start = pos;
    const alts: SeqNode[] = [sequence(nested, depth)];
    while (at(pos) === 0x7c) {
      pos = space(pos + 1, true);
      alts.push(sequence(nested, depth));
    }
    const last = alts[alts.length - 1] as SeqNode;
    return { kind: "alt", alts, start, end: Math.max(last.end, start) };
  };

  const firstDefinition = new Map<string, Rule>();
  let ok = true;
  try {
    pos = space(0, true);
    while (pos < n) {
      // parse_rule
      const nameStart = pos;
      while (isWord(at(pos))) pos++;
      if (pos === nameStart) {
        const hint =
          at(pos) === 0x7c
            ? t("parse.hintLeadingPipe")
            : t("parse.hintNameChars");
        throw new ParseFail("parse", t("parse.expectName", { hint }), pos, Math.min(pos + 1, n), `expecting name at ${rest(pos)}`);
      }
      const nameEnd = pos;
      const name = text(nameStart, nameEnd);
      pos = space(pos, false);
      counter.seen(name);
      if (!(at(pos) === 0x3a && at(pos + 1) === 0x3a && at(pos + 2) === 0x3d)) {
        throw new ParseFail("parse", t("parse.expectAssign", { name }), pos, Math.min(pos + 1, n), `expecting ::= at ${rest(pos)}`);
      }
      pos = space(pos + 3, true);
      const body = alternates(false, 0);
      const ruleEnd = Math.max(body.end, nameEnd);
      if (at(pos) === 0x0d) pos += at(pos + 1) === 0x0a ? 2 : 1;
      else if (at(pos) === 0x0a) pos++;
      else if (pos < n) {
        const c = at(pos);
        let hint: string;
        if (c === 0x5f) hint = t("parse.hintUnderscore");
        else if (c === 0x29) hint = t("parse.hintCloseParen");
        else hint = t("parse.hintUnexpected", { what: show(c) });
        throw new ParseFail("parse", t("parse.expectNewline", { hint }), pos, Math.min(pos + 1, n), `expecting newline or end at ${rest(pos)}`);
      }
      pos = space(pos, true);

      const rule: Rule = { name, nameStart, nameEnd, start: nameStart, end: ruleEnd, body };
      const first = firstDefinition.get(name);
      if (first) {
        const where = map.position(first.nameStart);
        diagnostics.push(
          diag(
            "warning",
            "duplicate-rule",
            t("parse.duplicateRule", { name, line: where.line, column: where.column }),
            nameStart,
            nameEnd,
            { rule: name },
          ),
        );
      } else firstDefinition.set(name, rule);
      rules.push(rule);
    }
  } catch (err) {
    if (!(err instanceof ParseFail)) throw err;
    ok = false;
    diagnostics.push(diag("error", err.code, err.message, err.start, err.end, { llamaMessage: err.llamaMessage }));
  }
  diagnostics.sort((a, b) => a.start.offset - b.start.offset);
  return { ok, rules, diagnostics, source: src };
}
