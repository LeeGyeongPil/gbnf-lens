import type { DiagnosticCode, LlamaVerdict } from "./types.js";

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g;

/** Map llama.cpp's own error text to our diagnostic code. */
function codeForLlamaMessage(message: string): DiagnosticCode | "unknown" {
  if (message.includes("Undefined rule")) return "undefined-rule";
  if (message.includes("does not contain a 'root' symbol")) return "no-root";
  if (message.includes("left recursion detected")) return "left-recursion";
  if (message.includes("number of rules that are going to be repeated multiplied")) return "repetition-threshold";
  if (message.includes("number of repetitions exceeds sane defaults")) return "repetition-min-too-large";
  if (message.includes("grammar recursion depth limit exceeded")) return "nesting-depth";
  if (/^(expecting|unknown escape|unexpected end of input)/.test(message)) return "parse";
  return "unknown";
}

/**
 * Read the output of llama.cpp's `test-gbnf-validator` (stdout and stderr together) and
 * return its verdict. Offsets are code points, like our own results.
 *
 * Throws `TypeError` if `stdout` is not a string.
 */
export function parseValidatorOutput(stdout: string): LlamaVerdict {
  if (typeof stdout !== "string") throw new TypeError("parseValidatorOutput: `stdout` must be a string");
  const text = stdout.replace(ANSI, "");

  if (/Input string is valid according to the grammar/.test(text)) return { kind: "valid" };

  if (/Input string is invalid according to the grammar/.test(text)) {
    const end = /Error: Unexpected end of input at position (\d+)/.exec(text);
    if (end) return { kind: "invalid", reason: "unexpected-end", offset: Number(end[1]) };
    const ch = /Error: Unexpected character [\s\S]*? at position (\d+)/.exec(text);
    if (ch) return { kind: "invalid", reason: "unexpected-char", offset: Number(ch[1]) };
    return { kind: "grammar-error", code: "unknown", message: "invalid input without a position" };
  }

  const parsing = /error parsing grammar: ([^\n]*)/.exec(text);
  if (parsing) {
    const message = (parsing[1] ?? "").trim();
    return { kind: "grammar-error", code: codeForLlamaMessage(message), message };
  }
  for (const marker of ["unsupported grammar, left recursion detected", "grammar does not contain a 'root' symbol"]) {
    const line = text.split("\n").find((l) => l.includes(marker));
    if (line) return { kind: "grammar-error", code: codeForLlamaMessage(line), message: line.trim() };
  }
  const first = text.split("\n").find((l) => l.trim() !== "") ?? "";
  return { kind: "grammar-error", code: "unknown", message: first.trim() };
}
