import { MAX_REPETITION_THRESHOLD } from "./types.js";

/**
 * Re-creates the bookkeeping llama.cpp does while it expands `x{m,n}` into helper rules,
 * but with arithmetic only: nothing is expanded, so memory stays constant even for `{0,2000}`.
 *
 * llama.cpp tracks `symbol_ids.size()` (every rule name seen, every `( )` group and every
 * helper rule counts once) and multiplies the number of rules in the repeated item by the
 * number of repetitions. If the product exceeds MAX_REPETITION_THRESHOLD it refuses the grammar.
 */
export class SymbolCounter {
  private readonly names = new Set<string>();
  private synthetic = 0;

  /** Number of symbols created so far (llama.cpp: `symbol_ids.size()`). */
  get size(): number {
    return this.names.size + this.synthetic;
  }

  /** A rule name was seen (as a definition or a reference). Returns true if it was new. */
  seen(name: string): boolean {
    if (this.names.has(name)) return false;
    this.names.add(name);
    return true;
  }

  /** A `( )` group or helper rules were generated. */
  generate(count: number): void {
    this.synthetic += count;
  }
}

/** Result of costing one repetition operator. */
export interface RepetitionCost {
  /** `max` after llama.cpp's clamp: `null` when unbounded. */
  effectiveMax: number | null;
  /** True when a finite `max` above the limit was silently turned into "unbounded". */
  clamped: boolean;
  /** llama.cpp `total_rules`: rules the single operator contributes. */
  totalRules: number;
  /** Helper rules llama.cpp generates for this operator. */
  helperRules: number;
  /** `n_prev_rules * total_rules` before this operator is applied. */
  product: number;
  /** True when the product is above the limit (llama.cpp refuses the grammar). */
  overLimit: boolean;
  /** True when `max < min` (llama.cpp would loop on an unsigned underflow). */
  invalidRange: boolean;
}

/**
 * Cost of applying `{min,max}` to an item that already stands for `nPrevRules` rules.
 * `max === null` means unbounded. Mirrors `handle_repetitions` in llama.cpp.
 */
export function costRepetition(nPrevRules: number, min: number, max: number | null): RepetitionCost {
  let effectiveMax = max;
  let clamped = false;
  if (max !== null && max > MAX_REPETITION_THRESHOLD) {
    effectiveMax = null;
    clamped = true;
  }
  const invalidRange = effectiveMax !== null && effectiveMax < min;
  let totalRules = 1;
  if (effectiveMax !== null && effectiveMax > 0) totalRules = effectiveMax;
  else if (min > 0) totalRules = min;
  const helperRules = effectiveMax === null ? 1 : Math.max(0, effectiveMax - min);
  const product = nPrevRules * totalRules;
  return {
    effectiveMax,
    clamped,
    totalRules,
    helperRules,
    product,
    overLimit: product > MAX_REPETITION_THRESHOLD,
    invalidRange,
  };
}
