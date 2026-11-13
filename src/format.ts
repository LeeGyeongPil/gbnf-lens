import { msg, type Lang } from "./messages.js";
import { SourceMap, codePointsToString } from "./position.js";
import type { Diagnostic, MatchResult, Position } from "./types.js";

/** One entry of the CLI `--json` output. */
export interface JsonDiagnostic {
  file: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
}

export function diagnosticToJson(file: string, d: Diagnostic): JsonDiagnostic {
  return {
    file,
    line: d.start.line,
    column: d.start.column,
    endLine: d.end.line,
    endColumn: d.end.column,
    severity: d.severity,
    code: d.code,
    message: d.message,
  };
}

/** The source line plus a caret line (`^~~~`) under `start`..`end`. */
export function snippet(map: SourceMap, start: Position, end?: Position): string[] {
  const text = map.lineText(start.line);
  const lead = [...text]
    .slice(0, start.column - 1)
    .map((ch) => (ch === "\t" ? "\t" : " "))
    .join("");
  const padding = start.column - 1 > [...text].length ? " ".repeat(start.column - 1 - [...text].length) : "";
  let width = 1;
  if (end && end.line === start.line && end.column > start.column) width = end.column - start.column;
  else if (end && end.line > start.line) width = Math.max(1, [...text].length - start.column + 1);
  return [`  ${text}`, `  ${lead}${padding}^${"~".repeat(Math.max(0, width - 1))}`];
}

/** Text form of a diagnostic: `file:line:col severity code message` and a caret snippet. */
export function formatDiagnostic(file: string, d: Diagnostic, map: SourceMap, lang?: Lang): string {
  const head = `${file}:${d.start.line}:${d.start.column} ${d.severity} ${d.code}: ${d.message}`;
  const lines = [head, ...snippet(map, d.start, d.end)];
  if (d.llamaMessage) lines.push(`  ${msg(lang, "format.llamaSays", { text: d.llamaMessage.split("\n")[0] as string })}`);
  return lines.join("\n");
}

function showChar(input: string, offset: number, lang?: Lang): string {
  const cps = [...input];
  const ch = cps[offset];
  if (ch === undefined) return msg(lang, "sample.endOfInputName");
  return `'${JSON.stringify(ch).slice(1, -1)}'`;
}

/** Plain-language result of a sample check, with a caret line where the sample went wrong. */
export function describeMatch(result: MatchResult, input: string, lang?: Lang): string[] {
  switch (result.status) {
    case "accept":
      return [msg(lang, "sample.accepted")];
    case "reject": {
      const { at, expected } = result;
      const what =
        result.reason === "unexpected-end" ? msg(lang, "sample.endOfInput") : msg(lang, "sample.unexpectedChar", { ch: showChar(input, at.offset, lang) });
      const exp = expected.length === 1 ? msg(lang, "sample.expectedOne", { item: expected[0] as string }) : msg(lang, "sample.expectedMany", { items: expected.join(", ") });
      const map = new SourceMap(input);
      return [msg(lang, "sample.rejected", { line: at.line, column: at.column, offset: at.offset, what, expected: exp }), ...snippet(map, at)];
    }
    case "inconclusive":
      switch (result.reason) {
        case "needs-vocab":
          return [msg(lang, "sample.needsVocab")];
        case "input-too-long":
          return [msg(lang, "sample.tooLong", { limit: result.limit ?? "the" })];
        case "stack-depth":
          return [msg(lang, "sample.stackDepth")];
        default:
          return [msg(lang, "sample.budget")];
      }
    case "grammar-error":
      return [msg(lang, "sample.grammarError")];
  }
}

/** Shorten a text for one-line display. */
export function preview(text: string, max = 40): string {
  const cps = [...text];
  return cps.length > max ? `${codePointsToString(cps.map((c) => c.codePointAt(0) as number), 0, max)}...` : text;
}
