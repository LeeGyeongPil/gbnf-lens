import { analyzeGrammar, effectiveRules } from "./analyze.js";
import { parseGrammar } from "./parse.js";
import { SourceMap, toCodePoints } from "./position.js";
import type { AltNode, Diagnostic, Item, MatchOptions, MatchResult, ParsedGrammar, SeqNode } from "./types.js";

const DEFAULT_MAX_INPUT_CHARS = 100_000;
const DEFAULT_MAX_STEPS = 5_000_000;
/** How many "expected" entries are kept for a rejection. */
const MAX_EXPECTED = 12;

class BudgetExceeded extends Error {}

/** Characters shown as expected input: `"}"` (JSON quoted) so whitespace stays readable. */
function quoteCodePoint(cp: number): string {
  return JSON.stringify(cp > 0x10ffff ? "�" : String.fromCodePoint(cp));
}

/**
 * Check whether `input` is a sentence of the grammar.
 *
 * The matcher never expands `x{m,n}`: repetitions are counted, so a `{0,2000}` costs no more
 * than `*`. It remembers where each rule can end (memoization), so ambiguous grammars do not
 * blow up. A work budget turns pathological cases into `inconclusive` instead of hanging.
 */
export function matchSample(grammar: string | ParsedGrammar, input: string, options: MatchOptions = {}): MatchResult {
  if (typeof grammar !== "string" && (typeof grammar !== "object" || grammar === null || !Array.isArray(grammar.rules))) {
    throw new TypeError("matchSample: `grammar` must be GBNF text or the result of parseGrammar()");
  }
  if (typeof input !== "string") throw new TypeError("matchSample: `input` must be a string");
  const rootName = options.root ?? "root";
  const maxInputChars = options.maxInputChars ?? DEFAULT_MAX_INPUT_CHARS;
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
  if (!Number.isFinite(maxSteps) || maxSteps < 1) throw new TypeError("matchSample: `maxSteps` must be a positive number");
  if (!Number.isFinite(maxInputChars) || maxInputChars < 0) throw new TypeError("matchSample: `maxInputChars` must be a non-negative number");

  const parsed = typeof grammar === "string" ? parseGrammar(grammar) : grammar;
  const errors: Diagnostic[] = [...parsed.diagnostics, ...(parsed.ok ? analyzeGrammar(parsed) : [])].filter((d) => d.severity === "error" && !(d.code === "no-root" && options.root !== undefined));
  const byName = effectiveRules(parsed.rules);
  if (errors.length === 0 && !byName.has(rootName)) {
    const zero = { offset: 0, line: 1, column: 1 };
    errors.push({ severity: "error", code: "no-root", message: `the grammar has no rule named '${rootName}'`, start: zero, end: zero });
  }
  if (errors.length > 0) return { status: "grammar-error", diagnostics: errors };

  const cps = toCodePoints(input);
  if (cps.length > maxInputChars) return { status: "inconclusive", reason: "input-too-long", limit: maxInputChars };

  // Furthest position any terminal was tried at, and what it expected there.
  let furthest = 0;
  let expected = new Set<string>();
  let needsVocab = false;
  let steps = 0;
  const note = (pos: number, what: string): void => {
    if (pos > furthest) {
      furthest = pos;
      expected = new Set([what]);
    } else if (pos === furthest) expected.add(what);
  };

  const memo = new Map<string, Map<number, Set<number>>>();
  const running = new Set<string>();
  const EMPTY: ReadonlySet<number> = new Set<number>();

  const matchSeq = (seq: SeqNode, pos: number): ReadonlySet<number> => {
    let current: ReadonlySet<number> = new Set([pos]);
    for (const item of seq.items) {
      const next = new Set<number>();
      for (const q of current) for (const e of matchItem(item, q)) next.add(e);
      current = next;
      if (current.size === 0) break;
    }
    return current;
  };

  const matchAlt = (alt: AltNode, pos: number): ReadonlySet<number> => {
    if (alt.alts.length === 1) return matchSeq(alt.alts[0] as SeqNode, pos);
    const out = new Set<number>();
    for (const seq of alt.alts) for (const e of matchSeq(seq, pos)) out.add(e);
    return out;
  };

  const matchItem = (item: Item, pos: number): ReadonlySet<number> => {
    if (++steps > maxSteps) throw new BudgetExceeded();
    switch (item.kind) {
      case "literal": {
        let q = pos;
        for (const cp of item.codePoints) {
          if (cps[q] !== cp) {
            note(q, quoteCodePoint(cp));
            return EMPTY;
          }
          q++;
        }
        return new Set([q]);
      }
      case "class": {
        const c = cps[pos];
        if (c !== undefined) {
          const hit = item.ranges.some((r) => c >= r.from && c <= r.to);
          if (hit !== item.negated) return new Set([pos + 1]);
        }
        note(pos, item.text);
        return EMPTY;
      }
      case "any":
        if (pos < cps.length) return new Set([pos + 1]);
        note(pos, "any character");
        return EMPTY;
      case "token":
        needsVocab = true;
        note(pos, item.text);
        return EMPTY;
      case "group":
        return matchAlt(item.body, pos);
      case "ref": {
        let perRule = memo.get(item.name);
        if (!perRule) memo.set(item.name, (perRule = new Map()));
        const cached = perRule.get(pos);
        if (cached) return cached;
        const key = `${item.name}@${pos}`;
        if (running.has(key)) return EMPTY; // left recursion guard (the linter reports it as an error)
        running.add(key);
        const rule = byName.get(item.name);
        const result = new Set(rule ? matchAlt(rule.body, pos) : []);
        running.delete(key);
        perRule.set(pos, result);
        return result;
      }
      case "repeat": {
        const max = item.max ?? Infinity;
        const out = new Set<number>();
        let current: ReadonlySet<number> = new Set([pos]);
        for (let i = 0; ; i++) {
          if (i >= item.min) for (const q of current) out.add(q);
          if (i >= max) break;
          const next = new Set<number>();
          for (const q of current) for (const e of matchItem(item.item, q)) next.add(e);
          // Past the minimum an unbounded loop only follows positions it has not seen yet,
          // so a body that can match nothing cannot loop forever.
          if (max === Infinity && i >= item.min) for (const e of [...next]) if (out.has(e)) next.delete(e);
          current = next;
          if (current.size === 0) break;
        }
        return out;
      }
    }
  };

  let ends: ReadonlySet<number>;
  try {
    ends = matchItem({ kind: "ref", name: rootName, start: 0, end: 0 }, 0);
  } catch (err) {
    // Budget used up, or the JS stack ran out on a very deep right-recursive sample.
    if (err instanceof BudgetExceeded) return { status: "inconclusive", reason: "budget" };
    if (err instanceof RangeError) return { status: "inconclusive", reason: "stack-depth" };
    throw err;
  }
  if (ends.has(cps.length)) return { status: "accept" };
  if (needsVocab) return { status: "inconclusive", reason: "needs-vocab" };

  // The grammar may have been complete earlier than any terminal failed (extra trailing input).
  let longest = -1;
  for (const e of ends) if (e > longest) longest = e;
  if (longest > furthest) {
    furthest = longest;
    expected = new Set();
  }
  const at = new SourceMap(input).position(furthest);
  const list = [...expected];
  const shown = list.length > MAX_EXPECTED ? [...list.slice(0, MAX_EXPECTED), "..."] : list;
  return {
    status: "reject",
    reason: furthest >= cps.length ? "unexpected-end" : "unexpected-char",
    at,
    expected: shown.length > 0 ? shown : ["end of input"],
  };
}
