import type { Position } from "./types.js";

/** Split a string into Unicode code points (what llama.cpp counts). */
export function toCodePoints(text: string): number[] {
  const out: number[] = [];
  for (const ch of text) out.push(ch.codePointAt(0) as number);
  return out;
}

/** Join code points into a string; invalid code points (> U+10FFFF) become U+FFFD. */
export function codePointsToString(cps: readonly number[], start = 0, end = cps.length): string {
  let out = "";
  for (let i = Math.max(0, start); i < Math.min(end, cps.length); i += 4096) {
    const chunk = cps.slice(i, Math.min(i + 4096, end, cps.length)).map((c) => (c > 0x10ffff || c < 0 ? 0xfffd : c));
    out += String.fromCodePoint(...chunk);
  }
  return out;
}

/**
 * Index of line starts and code-point -> UTF-16 offsets for one text.
 * Build it once per text; lookups are binary searches.
 */
export class SourceMap {
  readonly codePoints: number[];
  /** `lineStarts[i]` is the code-point offset where line `i + 1` begins. */
  readonly lineStarts: number[] = [0];
  /** `utf16[i]` is the UTF-16 offset of code point `i` (length is code points + 1). */
  readonly utf16: number[];

  constructor(text: string) {
    this.codePoints = toCodePoints(text);
    this.utf16 = new Array<number>(this.codePoints.length + 1);
    let u = 0;
    for (let i = 0; i < this.codePoints.length; i++) {
      this.utf16[i] = u;
      const cp = this.codePoints[i] as number;
      u += cp > 0xffff ? 2 : 1;
      // A line ends at "\n", "\r\n" or a lone "\r".
      if (cp === 10) this.lineStarts.push(i + 1);
      else if (cp === 13 && this.codePoints[i + 1] !== 10) this.lineStarts.push(i + 1);
    }
    this.utf16[this.codePoints.length] = u;
  }

  get length(): number {
    return this.codePoints.length;
  }

  /** Convert a code-point offset (clamped to the text) to line and column. */
  position(offset: number): Position {
    const o = Math.max(0, Math.min(offset, this.codePoints.length));
    let lo = 0;
    let hi = this.lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((this.lineStarts[mid] as number) <= o) lo = mid;
      else hi = mid - 1;
    }
    return { offset: o, line: lo + 1, column: o - (this.lineStarts[lo] as number) + 1 };
  }

  /** UTF-16 offset of a code-point offset. */
  toUtf16(offset: number): number {
    const o = Math.max(0, Math.min(offset, this.codePoints.length));
    return this.utf16[o] as number;
  }

  /** Code-point offset for a UTF-16 offset (a position inside a surrogate pair maps to the pair start). */
  fromUtf16(utf16Offset: number): number {
    let lo = 0;
    let hi = this.codePoints.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((this.utf16[mid] as number) <= utf16Offset) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /** UTF-16 0-based line and character for a code-point offset (what VS Code uses). */
  toUtf16LineChar(offset: number): { line: number; character: number } {
    const p = this.position(offset);
    const lineStart = this.lineStarts[p.line - 1] as number;
    return { line: p.line - 1, character: this.toUtf16(p.offset) - this.toUtf16(lineStart) };
  }

  /** Text of a 1-based line without its line break. */
  lineText(line: number): string {
    const start = this.lineStarts[line - 1];
    if (start === undefined) return "";
    const next = this.lineStarts[line] ?? this.codePoints.length;
    let end = next;
    while (end > start && ((this.codePoints[end - 1] as number) === 10 || (this.codePoints[end - 1] as number) === 13)) end--;
    return codePointsToString(this.codePoints, start, end);
  }
}

/** Convert a code-point offset in `src` to a 1-based line and column. */
export function offsetToPosition(src: string, offset: number): Position {
  if (typeof src !== "string") throw new TypeError("offsetToPosition: `src` must be a string");
  if (typeof offset !== "number" || Number.isNaN(offset)) throw new TypeError("offsetToPosition: `offset` must be a number");
  return new SourceMap(src).position(offset);
}
