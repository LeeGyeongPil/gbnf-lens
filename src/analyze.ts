import { SourceMap } from "./position.js";
import type { AltNode, Diagnostic, DiagnosticCode, Item, LintOptions, ParsedGrammar, RefNode, Rule, Severity, TokenNode, RepeatNode, SeqNode } from "./types.js";

/** Last definition of every rule name: this is what llama.cpp keeps. */
export function effectiveRules(rules: readonly Rule[]): Map<string, Rule> {
  const byName = new Map<string, Rule>();
  for (const r of rules) byName.set(r.name, r);
  return byName;
}

/** Visit every item below an alternation, depth first. */
export function walkItems(alt: AltNode, visit: (item: Item, seq: SeqNode) => void): void {
  for (const seq of alt.alts) {
    for (const item of seq.items) walkItem(item, seq, visit);
  }
}

/** Every sequence below an alternation, including the ones inside `( )` groups. */
function allSeqs(alt: AltNode, out: SeqNode[] = []): SeqNode[] {
  for (const seq of alt.alts) {
    out.push(seq);
    for (const item of seq.items) {
      let inner: Item = item;
      while (inner.kind === "repeat") inner = inner.item;
      if (inner.kind === "group") allSeqs(inner.body, out);
    }
  }
  return out;
}

function walkItem(item: Item, seq: SeqNode, visit: (item: Item, seq: SeqNode) => void): void {
  visit(item, seq);
  if (item.kind === "group") walkItems(item.body, visit);
  else if (item.kind === "repeat") walkItem(item.item, seq, visit);
}

/** Can this item match the empty string, given the nullable set of rules computed so far? */
function isNullable(item: Item | AltNode | SeqNode, nullable: ReadonlySet<string>): boolean {
  switch (item.kind) {
    case "literal": return item.codePoints.length === 0;
    case "class":
    case "any":
    case "token": return false;
    case "ref": return nullable.has(item.name);
    case "group": return isNullable(item.body, nullable);
    case "repeat": return item.min === 0 || item.max === 0 || isNullable(item.item, nullable);
    case "seq": return item.items.every((i) => isNullable(i, nullable));
    case "alt": return item.alts.some((s) => isNullable(s, nullable));
  }
}

/** Rules that can match the empty string (fixed point). */
function nullableRules(byName: Map<string, Rule>): Set<string> {
  const nullable = new Set<string>();
  for (let changed = true; changed; ) {
    changed = false;
    for (const r of byName.values()) {
      if (!nullable.has(r.name) && isNullable(r.body, nullable)) {
        nullable.add(r.name);
        changed = true;
      }
    }
  }
  return nullable;
}

/** Names a node can start with (before any input is consumed). */
function leadingRefs(node: Item | AltNode | SeqNode, nullable: ReadonlySet<string>, out: string[]): void {
  switch (node.kind) {
    case "ref": out.push(node.name); return;
    case "group": leadingRefs(node.body, nullable, out); return;
    case "repeat": if (node.max !== 0) leadingRefs(node.item, nullable, out); return;
    case "alt": for (const s of node.alts) leadingRefs(s, nullable, out); return;
    case "seq":
      for (const i of node.items) {
        leadingRefs(i, nullable, out);
        if (!isNullable(i, nullable)) break;
      }
      return;
    default: return;
  }
}

/** Structural key of an item (positions ignored) to compare `x? x? x?`. */
function itemKey(item: Item | AltNode | SeqNode): string {
  switch (item.kind) {
    case "literal": return `L${item.codePoints.join(",")}`;
    case "class": return `C${item.text}`;
    case "any": return "A";
    case "token": return `T${item.text}`;
    case "ref": return `R${item.name}`;
    case "group": return `G(${itemKey(item.body)})`;
    case "repeat": return `P${item.min},${item.max}(${itemKey(item.item)})`;
    case "seq": return item.items.map(itemKey).join(" ");
    case "alt": return item.alts.map(itemKey).join("|");
  }
}

/** Number of identical optional items in a row that triggers `optional-chain`. */
const OPTIONAL_CHAIN_LENGTH = 3;

/**
 * Static checks that need the whole grammar: undefined and unused rules, missing root,
 * left recursion, loops over nullable parts and other hang or slowdown risks.
 * Syntax-stage diagnostics (`parseGrammar().diagnostics`) are not repeated here.
 */
export function analyzeGrammar(grammar: ParsedGrammar, options: LintOptions = {}): Diagnostic[] {
  const map = new SourceMap(grammar.source);
  const out: Diagnostic[] = [];
  const add = (
    severity: Severity,
    code: DiagnosticCode,
    message: string,
    start: number,
    end: number,
    extra: { rule?: string; llamaMessage?: string } = {},
  ): void => {
    const e = end > start ? end : Math.min(start + 1, map.length);
    const d: Diagnostic = { severity, code, message, start: map.position(start), end: map.position(e) };
    if (extra.rule !== undefined) d.rule = extra.rule;
    if (extra.llamaMessage !== undefined) d.llamaMessage = extra.llamaMessage;
    out.push(d);
  };

  const byName = effectiveRules(grammar.rules);

  // 1. Every reference must have a definition.
  const refsOf = new Map<string, RefNode[]>();
  for (const rule of byName.values()) {
    const refs: RefNode[] = [];
    walkItems(rule.body, (item) => {
      if (item.kind === "ref") refs.push(item);
    });
    refsOf.set(rule.name, refs);
    for (const ref of refs) {
      if (!byName.has(ref.name)) {
        add("error", "undefined-rule", `rule '${ref.name}' is used here but never defined`, ref.start, ref.end, {
          rule: rule.name,
          llamaMessage: `Undefined rule identifier '${ref.name}'`,
        });
      }
    }
  }

  // 2. llama.cpp starts from a rule called `root`.
  const hasRoot = byName.has("root");
  if (!hasRoot) {
    add("error", "no-root", "the grammar has no 'root' rule; llama.cpp always starts matching at a rule named 'root'", 0, 1, {
      llamaMessage: "grammar does not contain a 'root' symbol",
    });
  }

  // 3. Rules root cannot reach.
  if (hasRoot) {
    const seen = new Set<string>();
    const stack = ["root"];
    while (stack.length > 0) {
      const name = stack.pop() as string;
      if (seen.has(name) || !byName.has(name)) continue;
      seen.add(name);
      for (const ref of refsOf.get(name) ?? []) stack.push(ref.name);
    }
    for (const rule of byName.values()) {
      if (!seen.has(rule.name)) {
        add("warning", "unused-rule", `rule '${rule.name}' is never reached from 'root'`, rule.nameStart, rule.nameEnd, { rule: rule.name });
      }
    }
  }

  // 4. Loops that can repeat without consuming input, and `x? x? x?` chains.
  const nullable = nullableRules(byName);
  for (const rule of byName.values()) {
    walkItems(rule.body, (item) => {
      if (item.kind === "repeat" && item.max === null && isNullable(item.item, nullable)) {
        add(
          "warning",
          "nullable-loop",
          "the repeated part can match the empty string, so this loop can go around without consuming input; " +
            "the grammar becomes ambiguous and can blow up llama.cpp's parser stacks. Make the inner part non-empty.",
          item.start,
          item.end,
          { rule: rule.name },
        );
      }
      if (item.kind === "token") reportToken(item);
    });
    for (const seq of allSeqs(rule.body)) checkOptionalChain(seq, rule.name);
  }

  function reportToken(item: TokenNode): void {
    add(
      "info",
      "token-needs-vocab",
      `${item.text} is a token terminal: it needs the model vocabulary, so gbnf-lens cannot match it in sample checks`,
      item.start,
      item.end,
    );
  }

  function checkOptionalChain(seq: SeqNode, ruleName: string): void {
    let run = 1;
    for (let i = 1; i < seq.items.length; i++) {
      const a = seq.items[i - 1] as Item;
      const b = seq.items[i] as Item;
      const optional = (x: Item): x is RepeatNode => x.kind === "repeat" && x.min === 0 && x.max === 1;
      if (optional(a) && optional(b) && itemKey(a.item) === itemKey(b.item)) run++;
      else run = 1;
      if (run === OPTIONAL_CHAIN_LENGTH) {
        add(
          "warning",
          "optional-chain",
          `${OPTIONAL_CHAIN_LENGTH} or more identical optional items in a row ('x? x? x?'): llama.cpp can become very slow here. Use a bounded repeat such as x{0,N} instead.`,
          b.start,
          b.end,
          { rule: ruleName },
        );
      }
    }
  }

  // 5. Left recursion: a rule that can start with itself (llama.cpp refuses it).
  const leading = new Map<string, string[]>();
  for (const rule of byName.values()) {
    const names: string[] = [];
    leadingRefs(rule.body, nullable, names);
    leading.set(rule.name, names);
  }
  const state = new Map<string, 1 | 2>();
  const reported = new Set<string>();
  const visit = (name: string, path: string[]): void => {
    const rule = byName.get(name);
    if (!rule) return;
    const st = state.get(name);
    if (st === 2) return;
    if (st === 1) {
      if (reported.has(name)) return;
      reported.add(name);
      const chain = [...path, name].join(" -> ");
      add(
        "error",
        "left-recursion",
        `left recursion: ${chain}. llama.cpp refuses grammars where a rule can begin with itself; ` +
          `rewrite it as a loop, e.g. expr ::= term ("+" term)*.`,
        rule.nameStart,
        rule.nameEnd,
        { rule: name },
      );
      return;
    }
    state.set(name, 1);
    for (const next of leading.get(name) ?? []) visit(next, [...path, name]);
    state.set(name, 2);
  };
  if (hasRoot) visit("root", []);
  for (const name of byName.keys()) visit(name, []);

  const filtered = options.includeInfo === false ? out.filter((d) => d.severity !== "info") : out;
  return filtered.sort((a, b) => a.start.offset - b.start.offset);
}
