# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.2.0] - 2026-11-13

### Added
- `--lang en|ko` option for the CLI, and the `GBNF_LENS_LANG` environment variable. The language is chosen in this order:
  `--lang`, `GBNF_LENS_LANG`, then `LC_ALL`, `LC_MESSAGES` and `LANG`. A value starting with `ko` gives Korean, anything else gives English.
  A bad `--lang` value is a usage error (exit code 2).
- Korean text for the CLI help, usage and file errors, diagnostics, sample results and the summary line.
- VS Code extension: command titles and descriptions (`package.nls.ko.json`), notifications and the file picker button (`l10n/bundle.l10n.ko.json`),
  and diagnostic messages now follow the VS Code display language (Korean for `ko*`, English otherwise).
- Library: optional `lang` option (`"en"` | `"ko"`) on `lintGrammar`, `parseGrammar` and `matchSample`. Without it the messages are English, as before.
  Other values never throw: a string starting with `ko` (such as `"ko-KR"`) gives Korean, anything else gives English.
- The CLI also accepts `--lang` before the command (`gbnf-lens --lang ko check grammar.gbnf`).
  A leading `--lang` with no value, or followed directly by the command, is reported as a `--lang` error (exit code 2).

### Changed
- When the locale is Korean (for example `LANG=ko_KR.UTF-8`) and no `--lang` is given, the human-readable CLI output and the `message` field of `--json` are now Korean.
  Scripts that match message text should pass `--lang en` or set `GBNF_LENS_LANG=en`. `code`, `severity`, the other JSON keys,
  the exit codes and the text after `llama.cpp says:` do not change with the language.

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

[Unreleased]: https://github.com/LeeGyeongPil/gbnf-lens/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/LeeGyeongPil/gbnf-lens/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/LeeGyeongPil/gbnf-lens/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/LeeGyeongPil/gbnf-lens/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/LeeGyeongPil/gbnf-lens/releases/tag/v0.1.0
