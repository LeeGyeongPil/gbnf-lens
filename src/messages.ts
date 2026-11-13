/**
 * Message table for human-readable text (internal, not exported from index.ts).
 * Every message has an id and an `{arg}` template per language. The English table is the
 * source of truth; the Korean table must have exactly the same ids (a test checks this).
 * Not translated on purpose: diagnostic codes, severities, JSON keys and llama.cpp's own text.
 */

import type { Language } from "./types.js";

export type Lang = Language;
export const LANGS: readonly Lang[] = ["en", "ko"];

export type MessageArgs = Record<string, string | number>;

const en = {
  // --- parse.ts ---
  "parse.hex": "expecting {size} hex digits after '{escape}'",
  "parse.unknownEscape": "unknown escape '\\{ch}' (allowed: \\x \\u \\U \\t \\r \\n \\\\ \\\" \\[ \\] \\-)",
  "parse.endOfInput": "unexpected end of input",
  "parse.numberTooLarge":
    "the number {digits} is too large: repetition counts must be at most 18446744073709551615 (llama.cpp refuses this grammar; anything above {threshold} is already silently treated as unbounded)",
  "parse.tokenLt": "expecting '<' after '!'",
  "parse.tokenId": "expecting a token id like <[1234]>",
  "parse.tokenBracket": "expecting ']'",
  "parse.tokenGt": "expecting '>'",
  "parse.tokenClose": "expecting '>' to close the token",
  "parse.repeatNoItem": "expecting an item before '*', '+', '?' or '{...}' to repeat",
  "parse.repeatThreshold":
    "{prev} rules x {total} = {product} > {threshold} (llama.cpp refuses this grammar). It multiplies the number of rules inside the repeated part by the repetition count; lower the count or simplify the repeated part.",
  "parse.repeatRange":
    "{{min},{max}}: the maximum is smaller than the minimum. llama.cpp does not check this; its expansion subtracts the two as unsigned numbers and would not finish.",
  "parse.maxClamped":
    "{label}: llama.cpp silently treats max > {threshold} as unbounded ({{min},}); the upper limit you wrote is not enforced.",
  "parse.largeRepetition":
    "this repetition makes llama.cpp build about {product} rules (limit {threshold}); grammar loading and sampling can get slow.",
  "parse.stringUnclosed": "unexpected end of input: this string literal is never closed (missing '\"')",
  "parse.classUnclosed": "unexpected end of input: this character class is never closed (missing ']')",
  "parse.classDash": "unexpected end of input after '-' in a character class",
  "parse.nestingDepth":
    "parentheses are nested more than {limit} levels deep (llama.cpp refuses this). Move the inner part into its own rule.",
  "parse.parenClose": "expecting ')' to close the '(' opened at {line}:{column}",
  "parse.braceNumber": "expecting a number after '{', like {2} or {1,3}",
  "parse.braceClose": "expecting '}' to close the repetition",
  "parse.braceComma": "expecting ',' or '}' after the number",
  "parse.minTooLarge": "{{min}...}: the minimum is above {threshold} (llama.cpp refuses this grammar).",
  "parse.expectName": "expecting name — {hint}",
  "parse.hintLeadingPipe": "a line cannot start with '|'; put '|' at the end of the previous line or wrap the alternatives in ( )",
  "parse.hintNameChars": "rule names use letters, digits and '-'",
  "parse.expectAssign": "expecting '::=' after the rule name '{name}'",
  "parse.expectNewline": "expecting newline or end — {hint}",
  "parse.hintUnderscore": "rule names may only contain letters, digits and '-'; '_' is not allowed",
  "parse.hintCloseParen": "this ')' has no matching '('",
  "parse.hintUnexpected": "unexpected {what}; a rule must end at the end of its line",
  "parse.duplicateRule": "rule '{name}' is defined again (first at {line}:{column}); llama.cpp silently keeps the last definition",
  "parse.endOfInputShort": "end of input",
  // --- analyze.ts / match.ts ---
  "analyze.undefinedRule": "rule '{name}' is used here but never defined",
  "analyze.noRoot": "the grammar has no 'root' rule; llama.cpp always starts matching at a rule named 'root'",
  "analyze.noRootNamed": "the grammar has no rule named '{name}'",
  "analyze.unusedRule": "rule '{name}' is never reached from 'root'",
  "analyze.nullableLoop":
    "the repeated part can match the empty string, so this loop can go around without consuming input; the grammar becomes ambiguous and can blow up llama.cpp's parser stacks. Make the inner part non-empty.",
  "analyze.tokenNeedsVocab":
    "{text} is a token terminal: it needs the model vocabulary, so gbnf-lens cannot match it in sample checks",
  "analyze.optionalChain":
    "{count} or more identical optional items in a row ('x? x? x?'): llama.cpp can become very slow here. Use a bounded repeat such as x{0,N} instead.",
  "analyze.leftRecursion":
    "left recursion: {chain}. llama.cpp refuses grammars where a rule can begin with itself; rewrite it as a loop, e.g. expr ::= term (\"+\" term)*.",
  // --- format.ts (sample results) ---
  "sample.accepted": "sample accepted",
  "sample.rejected": "sample rejected at {line}:{column} (offset {offset}): {what}, {expected}",
  "sample.endOfInput": "unexpected end of input",
  "sample.unexpectedChar": "unexpected {ch}",
  "sample.endOfInputName": "end of input",
  "match.anyChar": "any character",
  "sample.expectedOne": "expected {item}",
  "sample.expectedMany": "expected one of {items}",
  "sample.needsVocab":
    "sample inconclusive: needs vocab (the grammar uses <token> terminals, which depend on the model's vocabulary)",
  "sample.tooLong":
    "sample inconclusive: the sample is longer than {limit} characters (code points); raise --max-input to check it anyway",
  "sample.stackDepth":
    "sample inconclusive: the grammar recurses too deeply on this sample (deep right recursion); --max-steps will not help, try a shorter sample or a loop (x*) instead of recursion",
  "sample.budget":
    "sample inconclusive: work budget exceeded (the grammar is very ambiguous for this sample); raise --max-steps to try again",
  "sample.grammarError": "sample not checked: the grammar has errors",
  "format.llamaSays": "llama.cpp says: {text}",
  // --- cli.ts ---
  "cli.usage": `gbnf-lens {version} - check llama.cpp GBNF grammars before you send them to a server

Usage:
  gbnf-lens check <files...> [options]

Options:
  --sample <file>       also check that the text in <file> is accepted by each grammar
  --sample-text <text>  same, with the sample given on the command line
  --json                print a JSON array of diagnostics instead of text
  --strict              exit 1 on warnings too
  --max-steps <n>       work budget for sample matching (default 5000000)
  --max-input <n>       longest sample in characters (code points) to check (default 100000)
  --lang <en|ko>        language of messages (default: GBNF_LENS_LANG, then LC_ALL / LC_MESSAGES / LANG; else en)
  -h, --help            show this help
  -v, --version         show the version

Exit codes: 0 ok, 1 errors or rejected sample (or warnings with --strict), 2 usage or file error.
`,
  "cli.missingCommand": "missing command; try `gbnf-lens check <files...>`",
  "cli.unknownCommand": "unknown command '{command}'; the only command is 'check'",
  "cli.needsValue": "{flag} needs a value",
  "cli.maxStepsInvalid": "--max-steps needs a positive whole number, got '{raw}'",
  "cli.maxInputInvalid": "--max-input needs a non-negative whole number, got '{raw}'",
  "cli.langInvalid": "--lang needs 'en' or 'ko', got '{raw}'",
  "cli.unknownOption": "unknown option '{option}'",
  "cli.noFiles": "no grammar files given; try `gbnf-lens check grammar.gbnf`",
  "cli.sampleBoth": "use either --sample or --sample-text, not both",
  "cli.cannotReadSample": "cannot read sample file '{file}': {reason}",
  "cli.cannotRead": "cannot read '{file}': {reason}",
  "cli.sampleSkipped": "sample not checked because the grammar has errors",
  "cli.ok": "ok",
  "cli.summary": "checked {files} file(s): {errors} error(s), {warnings} warning(s)",
} as const;

export type MessageId = keyof typeof en;

const ko: Record<MessageId, string> = {
  "parse.hex": "'{escape}' 뒤에는 16진수 {size}자리가 와야 합니다",
  "parse.unknownEscape": "알 수 없는 이스케이프 '\\{ch}' (사용 가능: \\x \\u \\U \\t \\r \\n \\\\ \\\" \\[ \\] \\-)",
  "parse.endOfInput": "입력이 예상보다 일찍 끝났습니다",
  "parse.numberTooLarge":
    "숫자 {digits} 가 너무 큽니다: 반복 횟수는 18446744073709551615 이하여야 합니다 (llama.cpp 가 이 문법을 거부합니다. {threshold} 를 넘는 값은 이미 조용히 '제한 없음'으로 처리됩니다)",
  "parse.tokenLt": "'!' 뒤에는 '<' 가 와야 합니다",
  "parse.tokenId": "<[1234]> 같은 토큰 id 가 와야 합니다",
  "parse.tokenBracket": "']' 가 와야 합니다",
  "parse.tokenGt": "'>' 가 와야 합니다",
  "parse.tokenClose": "토큰을 닫는 '>' 가 없습니다",
  "parse.repeatNoItem": "'*', '+', '?', '{...}' 로 반복할 항목이 앞에 있어야 합니다",
  "parse.repeatThreshold":
    "규칙 {prev}개 x {total} = {product} > {threshold} (llama.cpp 가 이 문법을 거부합니다). 반복되는 부분 안의 규칙 수에 반복 횟수를 곱한 값입니다. 횟수를 줄이거나 반복되는 부분을 단순하게 만드세요.",
  "parse.repeatRange":
    "{{min},{max}}: 최댓값이 최솟값보다 작습니다. llama.cpp 는 이를 검사하지 않고, 두 값을 부호 없는 수로 빼서 전개하므로 끝나지 않습니다.",
  "parse.maxClamped":
    "{label}: llama.cpp 는 max > {threshold} 를 조용히 제한 없음({{min},})으로 처리합니다. 적어 둔 상한은 지켜지지 않습니다.",
  "parse.largeRepetition":
    "이 반복 때문에 llama.cpp 가 규칙을 약 {product}개 만듭니다 (한도 {threshold}). 문법 로딩과 샘플링이 느려질 수 있습니다.",
  "parse.stringUnclosed": "입력이 예상보다 일찍 끝났습니다: 이 문자열 리터럴이 닫히지 않았습니다 ('\"' 누락)",
  "parse.classUnclosed": "입력이 예상보다 일찍 끝났습니다: 이 문자 클래스가 닫히지 않았습니다 (']' 누락)",
  "parse.classDash": "문자 클래스의 '-' 뒤에서 입력이 끝났습니다",
  "parse.nestingDepth":
    "괄호가 {limit}단계보다 깊게 중첩되었습니다 (llama.cpp 가 거부합니다). 안쪽 부분을 별도 규칙으로 옮기세요.",
  "parse.parenClose": "{line}:{column} 에서 연 '(' 를 닫는 ')' 가 필요합니다",
  "parse.braceNumber": "'{' 뒤에는 {2} 또는 {1,3} 같은 숫자가 와야 합니다",
  "parse.braceClose": "반복을 닫는 '}' 가 필요합니다",
  "parse.braceComma": "숫자 뒤에는 ',' 또는 '}' 가 와야 합니다",
  "parse.minTooLarge": "{{min}...}: 최솟값이 {threshold} 를 넘습니다 (llama.cpp 가 이 문법을 거부합니다).",
  "parse.expectName": "규칙 이름이 필요합니다 — {hint}",
  "parse.hintLeadingPipe": "줄은 '|' 로 시작할 수 없습니다. '|' 를 앞 줄 끝으로 옮기거나 선택지를 ( ) 로 감싸세요",
  "parse.hintNameChars": "규칙 이름에는 영문자, 숫자, '-' 만 쓸 수 있습니다",
  "parse.expectAssign": "규칙 이름 '{name}' 뒤에는 '::=' 가 와야 합니다",
  "parse.expectNewline": "줄바꿈 또는 끝이 필요합니다 — {hint}",
  "parse.hintUnderscore": "규칙 이름에는 영문자, 숫자, '-' 만 쓸 수 있고 '_' 는 쓸 수 없습니다",
  "parse.hintCloseParen": "이 ')' 에 짝이 되는 '(' 가 없습니다",
  "parse.hintUnexpected": "예상하지 못한 {what}; 규칙은 그 줄의 끝에서 끝나야 합니다",
  "parse.duplicateRule": "규칙 '{name}' 이 다시 정의되었습니다 (처음은 {line}:{column}). llama.cpp 는 조용히 마지막 정의를 씁니다",
  "parse.endOfInputShort": "입력의 끝",
  "analyze.undefinedRule": "규칙 '{name}' 을 여기서 쓰지만 정의가 없습니다",
  "analyze.noRoot": "문법에 'root' 규칙이 없습니다. llama.cpp 는 항상 'root' 규칙에서 매칭을 시작합니다",
  "analyze.noRootNamed": "문법에 '{name}' 규칙이 없습니다",
  "analyze.unusedRule": "규칙 '{name}' 은 'root' 에서 도달할 수 없습니다",
  "analyze.nullableLoop":
    "반복되는 부분이 빈 문자열과 일치할 수 있어서, 이 반복이 입력을 소비하지 않고 계속 돌 수 있습니다. 문법이 모호해지고 llama.cpp 의 파서 스택이 폭발할 수 있습니다. 안쪽 부분이 비어 있지 않게 고치세요.",
  "analyze.tokenNeedsVocab":
    "{text} 은 토큰 터미널입니다: 모델 어휘가 필요해서 gbnf-lens 는 샘플 검사에서 일치 여부를 알 수 없습니다",
  "analyze.optionalChain":
    "같은 선택 항목이 {count}개 이상 연달아 있습니다 ('x? x? x?'): llama.cpp 가 매우 느려질 수 있습니다. 대신 x{0,N} 같은 제한된 반복을 쓰세요.",
  "analyze.leftRecursion":
    "좌재귀: {chain}. llama.cpp 는 규칙이 자기 자신으로 시작하는 문법을 거부합니다. 반복문으로 바꾸세요. 예: expr ::= term (\"+\" term)*.",
  "sample.accepted": "샘플이 문법과 일치합니다",
  "sample.rejected": "샘플이 {line}:{column} (오프셋 {offset}) 에서 거부되었습니다: {what}, {expected}",
  "sample.endOfInput": "입력이 예상보다 일찍 끝났습니다",
  "sample.unexpectedChar": "예상하지 못한 {ch}",
  "sample.endOfInputName": "입력의 끝",
  "match.anyChar": "아무 문자",
  "sample.expectedOne": "예상: {item}",
  "sample.expectedMany": "예상: 다음 중 하나 {items}",
  "sample.needsVocab":
    "샘플 판정 불가: 어휘가 필요합니다 (문법이 모델 어휘에 따라 달라지는 <token> 터미널을 씁니다)",
  "sample.tooLong":
    "샘플 판정 불가: 샘플이 {limit}자(코드 포인트)보다 깁니다. 그래도 검사하려면 --max-input 을 늘리세요",
  "sample.stackDepth":
    "샘플 판정 불가: 이 샘플에서 문법이 너무 깊게 재귀합니다 (깊은 오른쪽 재귀). --max-steps 는 도움이 되지 않으니 더 짧은 샘플을 쓰거나 재귀 대신 반복(x*)을 쓰세요",
  "sample.budget":
    "샘플 판정 불가: 작업 한도를 넘었습니다 (이 샘플에서 문법이 매우 모호합니다). 다시 시도하려면 --max-steps 를 늘리세요",
  "sample.grammarError": "샘플을 검사하지 않았습니다: 문법에 오류가 있습니다",
  "format.llamaSays": "llama.cpp says: {text}",
  "cli.usage": `gbnf-lens {version} - llama.cpp GBNF 문법을 서버에 보내기 전에 검사합니다

사용법:
  gbnf-lens check <파일...> [옵션]

옵션:
  --sample <파일>       <파일>의 텍스트가 각 문법과 일치하는지도 검사
  --sample-text <텍스트>  같은 검사, 샘플을 명령줄에서 직접 지정
  --json                텍스트 대신 진단의 JSON 배열을 출력
  --strict              경고에도 종료 코드 1
  --max-steps <n>       샘플 매칭 작업 한도 (기본 5000000)
  --max-input <n>       검사할 샘플의 최대 길이, 문자(코드 포인트) 수 (기본 100000)
  --lang <en|ko>        메시지 언어 (기본: GBNF_LENS_LANG, 그다음 LC_ALL / LC_MESSAGES / LANG, 그 밖은 en)
  -h, --help            이 도움말 표시
  -v, --version         버전 표시

종료 코드: 0 정상, 1 오류 또는 거부된 샘플(--strict 면 경고도), 2 사용법 또는 파일 오류.
`,
  "cli.missingCommand": "명령이 없습니다. `gbnf-lens check <파일...>` 처럼 실행하세요",
  "cli.unknownCommand": "알 수 없는 명령 '{command}'. 사용할 수 있는 명령은 'check' 뿐입니다",
  "cli.needsValue": "{flag} 에는 값이 필요합니다",
  "cli.maxStepsInvalid": "--max-steps 에는 1 이상의 정수가 필요합니다 (받은 값: '{raw}')",
  "cli.maxInputInvalid": "--max-input 에는 0 이상의 정수가 필요합니다 (받은 값: '{raw}')",
  "cli.langInvalid": "--lang 에는 'en' 또는 'ko' 가 필요합니다 (받은 값: '{raw}')",
  "cli.unknownOption": "알 수 없는 옵션 '{option}'",
  "cli.noFiles": "문법 파일이 없습니다. `gbnf-lens check grammar.gbnf` 처럼 실행하세요",
  "cli.sampleBoth": "--sample 과 --sample-text 는 함께 쓸 수 없습니다",
  "cli.cannotReadSample": "샘플 파일 '{file}' 을 읽을 수 없습니다: {reason}",
  "cli.cannotRead": "'{file}' 을 읽을 수 없습니다: {reason}",
  "cli.sampleSkipped": "문법에 오류가 있어 샘플을 검사하지 않았습니다",
  "cli.ok": "ok",
  "cli.summary": "{files}개 파일 검사: 오류 {errors}개, 경고 {warnings}개",
};

/** Both tables, exported for tests. */
export const MESSAGES: Record<Lang, Record<MessageId, string>> = { en, ko };

/**
 * Look up `id` in `lang` and fill the `{name}` placeholders. Unknown placeholders stay as written.
 * Never throws: plain JavaScript callers may pass any `lang` (a locale such as "ko-KR", "fr",
 * a number), so it goes through `langFromLocale` first — `ko…` gives Korean, anything else English.
 */
export function msg(lang: Lang | undefined, id: MessageId, args: MessageArgs = {}): string {
  // 지원 밖 언어 값("ko-KR"·"fr"·"EN" 등)도 여기서 en/ko 로 정규화한다 — 표 조회가 undefined 가 되지 않게.
  const table = MESSAGES[langFromLocale(lang)];
  // 없는 id 는 영어 표, 그래도 없으면 id 자체를 보여 준다(내부 오류 대신 읽을 수 있는 글).
  const template: string = table[id] ?? MESSAGES.en[id] ?? String(id);
  // Placeholders are `{name}` where name is a word; doubled braces `{{min},{max}}` come from
  // templates that print a literal brace, so only match names that exist in `args`.
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(args, name) ? String(args[name]) : whole,
  );
}

/**
 * `ko`, `KO`, `ko_KR.UTF-8`, `ko-KR` → "ko"; anything else → "en", including `undefined`,
 * other languages ("fr", "EN") and values that are not strings at all.
 */
export function langFromLocale(value: unknown): Lang {
  return typeof value === "string" && /^ko(?![a-z])/i.test(value.trim()) ? "ko" : "en";
}
