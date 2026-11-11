# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.2] - 2026-11-11

### Fixed
- `npm test` failed with the npm that comes with Node 20 and 22 (npm 10), which is what CI uses.
  npm 10 runs the `prepare` script on `npm pack` even with `--ignore-scripts`, so the packaging test
  rebuilt `dist/` while other tests were reading it and got build output mixed into the JSON.
  The test now packs a copy of the package without scripts and checks that `dist/` was not rebuilt.
  The published files do not change.

## [0.1.1] - 2026-11-11

### Fixed
- `npm test` no longer relies on `node --test "glob"`, which Node 20 does not understand (the package supports Node 20 and up).
  Tests now run through `scripts/run-tests.mjs`, which lists the test files itself.
- CI runs on Node 20 and 22, with read-only token permissions and a job timeout, so a Node-version problem shows up in the matrix.

## [0.1.0] - 2026-11-11

### Added
- Parser that follows llama.cpp's GBNF rules (commit af6b524) and keeps line and column for every node.
- 15 diagnostic codes: syntax errors, undefined rules, missing `root`, left recursion, repetition limits,
  nesting depth, and warnings for duplicate rules, clamped `{m,n}`, empty loops, `x? x? x?` chains and unused rules.
- Sample matcher that counts repetitions instead of expanding them, with an input and step budget.
- `parseValidatorOutput` to read the output of llama.cpp's `test-gbnf-validator`.
- `gbnf-lens check` CLI with `--sample`, `--sample-text`, `--json`, `--strict`, `--max-steps`, `--max-input` and exit codes 0, 1 and 2.
- VS Code extension (run from source): `.gbnf` language, highlighting, diagnostics, go to definition and
  the "GBNF: Check Sample Against Grammar" command.
- Recorded comparison against llama.cpp af6b524 (14 cases).
- `matchSample` reports why a sample is `inconclusive`: `budget` (`--max-steps`), `input-too-long` (`--max-input`, default 100000 code points), `stack-depth` or `needs-vocab`, each with its own message.
- A repeat count above 2^64-1 is a parse error; an unclosed parenthesis is reported at the opening `(` with `line:column`.
