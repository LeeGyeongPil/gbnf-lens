/**
 * Editor features as pure functions: no `vscode` import, so they can be tested without VS Code.
 * All positions in and out are 0-based and count UTF-16 code units, as VS Code does.
 */
import { describeMatch } from "../../src/format.js";
import { lintGrammar } from "../../src/index.js";
import { matchSample } from "../../src/match.js";
import { langFromLocale, msg, type Lang } from "../../src/messages.js";
import { SourceMap } from "../../src/position.js";

/** Message language for a VS Code display language such as `ko` or `en-US`: Korean for `ko*`, English otherwise. */
export const languageFor = (vscodeLanguage: string | undefined): Lang => langFromLocale(vscodeLanguage);

/** The llama.cpp prefix used in related information; the text after it is never translated. */
export const llamaSays = (text: string, lang?: Lang): string => msg(lang, "format.llamaSays", { text });

export interface EditorDiagnostic {
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
  severity: "error" | "warning" | "info";
  message: string;
  code: string;
  /** What llama.cpp itself prints for the same problem (shown as related information). */
  llamaMessage?: string;
}

export interface EditorLocation {
  line: number;
  character: number;
  endLine: number;
  endCharacter: number;
}

export interface SampleCheck {
  /** `true` accepted, `false` rejected or grammar broken, `null` could not decide. */
  ok: boolean | null;
  /** Text for a notification. */
  message: string;
  /** Where the sample stopped matching (0-based UTF-16), when it was rejected. */
  location?: { line: number; character: number };
}

/** Diagnostics for the editor's Problems panel. */
export function computeDiagnostics(text: string, lang?: Lang): EditorDiagnostic[] {
  const map = new SourceMap(text);
  return lintGrammar(text, lang !== undefined ? { lang } : {}).map((d) => {
    const start = map.toUtf16LineChar(d.start.offset);
    const end = map.toUtf16LineChar(d.end.offset);
    const out: EditorDiagnostic = {
      startLine: start.line,
      startCharacter: start.character,
      endLine: end.line,
      endCharacter: end.character,
      severity: d.severity,
      message: d.message,
      code: d.code,
    };
    if (d.llamaMessage !== undefined) out.llamaMessage = d.llamaMessage;
    return out;
  });
}

interface Word {
  name: string;
  start: number;
  end: number;
  /** True when the word is the name in `name ::=`. */
  isHead: boolean;
}

const isWordChar = (c: string): boolean => /[A-Za-z0-9-]/.test(c);

/**
 * Find rule names and rule references in the text without needing a valid grammar,
 * so "go to definition" keeps working while another rule has a syntax error.
 */
function scanWords(text: string): Word[] {
  const words: Word[] = [];
  const n = text.length;
  let i = 0;
  const skipUntil = (close: string): void => {
    i++;
    while (i < n && text[i] !== close && text[i] !== "\n") {
      if (text[i] === "\\") i++;
      i++;
    }
    i++; // the closing character
  };
  while (i < n) {
    const c = text[i] as string;
    if (c === "#") while (i < n && text[i] !== "\n") i++;
    else if (c === '"') skipUntil('"');
    else if (c === "[") skipUntil("]");
    else if (c === "<") skipUntil(">");
    else if (c === "{") skipUntil("}");
    else if (isWordChar(c)) {
      const start = i;
      while (i < n && isWordChar(text[i] as string)) i++;
      let k = i;
      while (text[k] === " " || text[k] === "\t") k++;
      words.push({ name: text.slice(start, i), start, end: i, isHead: text.startsWith("::=", k) });
    } else i++;
  }
  return words;
}

/** Line start offsets (UTF-16) for `\n`-separated text. */
function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  return starts;
}

function locate(starts: number[], offset: number): { line: number; character: number } {
  let line = 0;
  while (line + 1 < starts.length && (starts[line + 1] as number) <= offset) line++;
  return { line, character: offset - (starts[line] as number) };
}

/**
 * "Go to definition": the rule name under the cursor jumps to its definition line
 * (the last one if the rule is defined twice, because that is the one llama.cpp keeps).
 */
export function findDefinition(text: string, line: number, character: number): EditorLocation | null {
  const starts = lineStarts(text);
  const lineStart = starts[line];
  if (lineStart === undefined) return null;
  const offset = lineStart + character;
  const words = scanWords(text);
  const hit = words.find((w) => offset >= w.start && offset <= w.end);
  if (!hit) return null;
  let def: Word | undefined;
  for (const w of words) if (w.isHead && w.name === hit.name) def = w;
  if (!def) return null;
  const s = locate(starts, def.start);
  const e = locate(starts, def.end);
  return { line: s.line, character: s.character, endLine: e.line, endCharacter: e.character };
}

/** Check a sample text against a grammar and describe the result for a notification. */
export function checkSample(grammarText: string, sample: string, lang?: Lang): SampleCheck {
  const result = matchSample(grammarText, sample, lang !== undefined ? { lang } : {});
  const message = describeMatch(result, sample, lang)
    .filter((l) => !l.startsWith("  "))
    .join("\n");
  if (result.status === "accept") return { ok: true, message };
  if (result.status === "reject") {
    const map = new SourceMap(sample);
    const p = map.toUtf16LineChar(result.at.offset);
    return { ok: false, message, location: { line: p.line, character: p.character } };
  }
  if (result.status === "grammar-error") {
    const first = result.diagnostics[0];
    const where = first ? ` (${first.start.line}:${first.start.column} ${first.code}: ${first.message})` : "";
    return { ok: false, message: `${message}${where}` };
  }
  return { ok: null, message };
}
