// Screen language: --lang, GBNF_LENS_LANG, LANG; message tables; VS Code extension files.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { cleanEnv, cliPath, fixture, lib, read, root } from "./helpers.mjs";

const messages = await import(pathToFileURL(join(root, "extension", "dist", "messages.mjs")).href);
const features = await import(pathToFileURL(join(root, "extension", "dist", "features.mjs")).href);
const hangul = /[가-힣]/;

const run = (args, env = {}) =>
  spawnSync(process.execPath, [cliPath, ...args], { cwd: root, encoding: "utf8", timeout: 20000, env: cleanEnv(env) });
const bad = ["check", "fixtures/bad/undefined.gbnf"];

test("--lang picks the language", () => {
  assert.match(run([...bad, "--lang", "en"]).stdout, /is used here but never defined/);
  assert.match(run([...bad, "--lang", "ko"]).stdout, /정의가 없습니다/);
  assert.match(run([...bad, "--lang=ko"]).stdout, /정의가 없습니다/);
  assert.match(run([...bad, "--lang", "ko"]).stdout, /1개 파일 검사: 오류 1개/);
  assert.match(run([...bad, "--lang", "en"]).stdout, /checked 1 file\(s\): 1 error\(s\)/);
  assert.match(run(["check", "fixtures/grammars/json.gbnf", "--lang", "ko"]).stdout, /json\.gbnf: ok/);
  assert.match(run(["--help", "--lang", "ko"]).stdout, /사용법:/);
  assert.match(run(["check", "--help", "--lang", "ko"]).stdout, /사용법:/);
  assert.match(run(["--help"]).stdout, /Usage:/);
  assert.match(run(["--help"]).stdout, /--lang <en\|ko>/);
});

test("environment order: --lang > GBNF_LENS_LANG > LC_ALL / LC_MESSAGES / LANG; not Korean means English", () => {
  const ko = /정의가 없습니다/;
  const en = /never defined/;
  assert.match(run(bad, { GBNF_LENS_LANG: "ko" }).stdout, ko);
  assert.match(run(bad, { LANG: "ko_KR.UTF-8" }).stdout, ko);
  assert.match(run(bad, { LC_ALL: "ko_KR.UTF-8" }).stdout, ko);
  assert.match(run(bad, { LC_MESSAGES: "ko" }).stdout, ko);
  assert.match(run(bad, { LANG: "fr_FR.UTF-8" }).stdout, en);
  assert.match(run(bad, { LANG: "C" }).stdout, en);
  assert.match(run(bad, { LANG: "" }).stdout, en);
  assert.match(run(bad, {}).stdout, en);
  assert.match(run(bad, { GBNF_LENS_LANG: "xx" }).stdout, en);
  // GBNF_LENS_LANG beats LANG, in both directions; --lang beats both
  assert.match(run(bad, { GBNF_LENS_LANG: "en", LANG: "ko_KR.UTF-8" }).stdout, en);
  assert.match(run(bad, { GBNF_LENS_LANG: "ko", LANG: "en_US.UTF-8" }).stdout, ko);
  assert.match(run([...bad, "--lang", "en"], { GBNF_LENS_LANG: "ko", LANG: "ko_KR.UTF-8" }).stdout, en);
  assert.match(run([...bad, "--lang", "ko"], { GBNF_LENS_LANG: "en" }).stdout, ko);
  // LC_ALL beats LANG as in the C library
  assert.match(run(bad, { LC_ALL: "C", LANG: "ko_KR.UTF-8" }).stdout, en);
});

test("a bad --lang value is a usage error (exit 2) shown in the environment's language", () => {
  const r = run([...bad, "--lang", "fr"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--lang needs 'en' or 'ko', got 'fr'/);
  assert.match(r.stderr, /Usage:/);
  const k = run([...bad, "--lang", "fr"], { GBNF_LENS_LANG: "ko" });
  assert.equal(k.status, 2);
  assert.match(k.stderr, /--lang 에는 'en' 또는 'ko' 가 필요합니다/);
  assert.equal(run([...bad, "--lang"]).status, 2);
  assert.equal(run(["check", "fixtures/nope.gbnf", "--lang", "ko"]).status, 2);
  assert.match(run(["check", "fixtures/nope.gbnf", "--lang", "ko"]).stderr, /을 읽을 수 없습니다/);
  assert.match(run(["check", "x.gbnf", "--bogus", "--lang", "ko"]).stderr, /알 수 없는 옵션 '--bogus'/);
});

test("sample results are translated; the sample text and llama.cpp text are not", () => {
  const args = ["check", "examples/tool-call.gbnf", "--sample", "examples/tool-call.bad.txt"];
  const ko = run([...args, "--lang", "ko"]);
  assert.equal(ko.status, 1);
  assert.match(ko.stdout, /샘플이 1:39 \(오프셋 38\) 에서 거부되었습니다: 예상하지 못한 '\}', 예상: 다음 중 하나/);
  const en = run([...args, "--lang", "en"]);
  assert.match(en.stdout, /sample rejected at 1:39 \(offset 38\): unexpected '\}', expected one of/);
  assert.match(run(["check", "examples/tool-call.gbnf", "--sample", "examples/tool-call.ok.txt", "--lang", "ko"]).stdout, /샘플이 문법과 일치합니다/);
  assert.match(run(["check", "fixtures/bad/undefined.gbnf", "--sample-text", "x", "--lang", "ko"]).stdout, /문법에 오류가 있어 샘플을 검사하지 않았습니다/);
});

test("--json: code, severity, keys and llama.cpp text are the same in every language; message follows the language", () => {
  const files = ["fixtures/bad/loops.gbnf", "fixtures/bad/undefined.gbnf", "fixtures/bad/leading-pipe.gbnf", "fixtures/bad/no-root.gbnf"];
  const en = JSON.parse(run(["check", ...files, "--json", "--lang", "en"]).stdout);
  const ko = JSON.parse(run(["check", ...files, "--json", "--lang", "ko"]).stdout);
  assert.equal(en.length, ko.length);
  assert.ok(en.length >= 5);
  const strip = (list) => list.map(({ message, ...rest }) => rest);
  assert.deepEqual(strip(en), strip(ko));
  for (let i = 0; i < en.length; i++) {
    assert.ok(hangul.test(ko[i].message), ko[i].message);
    assert.ok(!hangul.test(en[i].message), en[i].message);
  }
  // llama.cpp's own text is kept as it is, in the text output too
  const text = run(["check", "fixtures/bad/undefined.gbnf", "--lang", "ko"]).stdout;
  assert.match(text, /llama\.cpp says: Undefined rule identifier 'name'/);
  const d = lib.lintGrammar(fixture("bad/undefined.gbnf"), { lang: "ko" })[0];
  assert.equal(d.llamaMessage, lib.lintGrammar(fixture("bad/undefined.gbnf"))[0].llamaMessage);
});

test("library output stays English by default and changes only when `lang` is given", () => {
  const text = fixture("bad/undefined.gbnf");
  const def = lib.lintGrammar(text);
  assert.match(def[0].message, /^rule 'name' is used here but never defined$/);
  assert.deepEqual(lib.lintGrammar(text, { lang: "en" }), def);
  assert.match(lib.lintGrammar(text, { lang: "ko" })[0].message, /정의가 없습니다/);
  assert.match(lib.parseGrammar('root ::= "a\n').diagnostics[0].message, /never closed/);
  assert.match(lib.parseGrammar('root ::= "a\n', { lang: "ko" }).diagnostics[0].message, /닫히지 않았습니다/);
  assert.match(lib.matchSample("root ::= x\n", "a", { lang: "ko" }).diagnostics[0].message, /정의가 없습니다/);
  assert.match(lib.matchSample("root ::= x\n", "a").diagnostics[0].message, /never defined/);
  assert.match(lib.matchSample('root ::= "a"\n', "a", { root: "zzz", lang: "ko" }).diagnostics[0].message, /'zzz' 규칙이 없습니다/);
});

test("en and ko tables have the same ids and the same placeholders", () => {
  const en = messages.MESSAGES.en;
  const ko = messages.MESSAGES.ko;
  assert.deepEqual(Object.keys(ko).sort(), Object.keys(en).sort());
  const holes = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).filter((n) => !/^\d+$/.test(n)).sort().join(",");
  for (const id of Object.keys(en)) {
    assert.ok(en[id].length > 0 && ko[id].length > 0, id);
    assert.equal(holes(ko[id]), holes(en[id]), `placeholders of ${id}`);
  }
  // msg(): unknown language falls back to English, missing args stay visible
  assert.equal(messages.msg(undefined, "cli.ok"), "ok");
  assert.equal(messages.msg("ko", "cli.needsValue", {}), "{flag} 에는 값이 필요합니다");
  assert.equal(messages.langFromLocale("ko_KR.UTF-8"), "ko");
  assert.equal(messages.langFromLocale("ko-KR"), "ko");
  assert.equal(messages.langFromLocale("fr_FR"), "en");
  assert.equal(messages.langFromLocale(undefined), "en");
});

test("msg() never throws: unsupported languages and unknown ids give readable text", () => {
  // 지원 밖 언어 값은 en/ko 로 정규화된다 (QA: "ko-KR"·"fr"·"EN" 에서 'reading ...' TypeError 가 났다)
  assert.equal(messages.msg("fr", "cli.needsValue", { flag: "--x" }), "--x needs a value");
  assert.equal(messages.msg("EN", "cli.needsValue", { flag: "--x" }), "--x needs a value");
  assert.equal(messages.msg("ko-KR", "cli.needsValue", { flag: "--x" }), "--x 에는 값이 필요합니다");
  assert.equal(messages.msg("KO", "cli.ok"), "ok");
  assert.equal(messages.msg(null, "cli.ok"), "ok");
  assert.equal(messages.msg(42, "cli.ok"), "ok");
  assert.equal(messages.langFromLocale("KO"), "ko");
  assert.equal(messages.langFromLocale(42), "en");
  assert.equal(messages.langFromLocale({}), "en");
  // an id that is not in the table shows the id instead of crashing
  assert.equal(messages.msg("ko", "no.such.id"), "no.such.id");
  // a missing argument stays visible; names from Object.prototype are not arguments
  assert.equal(messages.msg("en", "cli.unknownCommand", {}), "unknown command '{command}'; the only command is 'check'");
  assert.equal(messages.msg("en", "cli.unknownCommand", Object.create({ command: "x" })), "unknown command '{command}'; the only command is 'check'");
});

test("every message id used in the source exists in the tables", () => {
  // npm test 는 타입 검사를 돌리지 않으므로, 소스의 메시지 id 오타(undefined 조회)를 여기서 잡는다
  const ids = new Set(Object.keys(messages.MESSAGES.en));
  const sources = [
    ...readdirSync(join(root, "src")).filter((n) => n.endsWith(".ts")).map((n) => ["src", n]),
    ...readdirSync(join(root, "extension", "src")).filter((n) => n.endsWith(".ts")).map((n) => ["extension", "src", n]),
  ];
  let used = 0;
  for (const parts of sources) {
    const text = read(...parts);
    for (const m of text.matchAll(/(?:msg\([^,()]*,\s*|\bt\(|UsageError\()"([a-z]+\.[A-Za-z]+)"/g)) {
      used++;
      assert.ok(ids.has(m[1]), `${parts.join("/")} uses message id '${m[1]}', which is not in the table`);
    }
  }
  assert.ok(used >= 60, `only ${used} message ids found; the scan pattern may be broken`);
});

test("library: a `lang` other than en/ko never throws; ko… gives Korean, anything else English", () => {
  const undef = "root ::= x\n";
  const open = 'root ::= "a\n';
  for (const lang of ["ko-KR", "KO", "ko_KR.UTF-8"]) {
    assert.match(lib.lintGrammar(undef, { lang })[0].message, /정의가 없습니다/, lang);
    assert.match(lib.parseGrammar(open, { lang }).diagnostics[0].message, /닫히지 않았습니다/, lang);
    assert.match(lib.matchSample(undef, "a", { lang }).diagnostics[0].message, /정의가 없습니다/, lang);
    assert.deepEqual(lib.matchSample('root ::= "a" .\n', "a", { lang }).expected, ["아무 문자"], lang);
  }
  for (const lang of ["fr", "EN", "", null, 42, {}]) {
    const label = String(lang);
    assert.match(lib.lintGrammar(undef, { lang })[0].message, /^rule 'x' is used here but never defined$/, label);
    assert.match(lib.parseGrammar(open, { lang }).diagnostics[0].message, /never closed/, label);
    assert.match(lib.matchSample(undef, "a", { lang }).diagnostics[0].message, /never defined/, label);
    assert.deepEqual(lib.matchSample('root ::= "a"\n', "ab", { lang }).expected, ["end of input"], label);
  }
  // the CommonJS build (QA reproduced the crash with require()) behaves the same
  const cjs = createRequire(import.meta.url)(join(root, "dist", "index.cjs"));
  assert.match(cjs.lintGrammar("root ::= x", { lang: "ko-KR" })[0].message, /정의가 없습니다/);
  assert.match(cjs.lintGrammar("root ::= x", { lang: "fr" })[0].message, /never defined/);
  assert.match(cjs.parseGrammar("root ::= x {", { lang: "EN" }).diagnostics[0].message, /^[ -~]+$/);
  // parseGrammar took one argument in 0.1.x; a stray second argument such as null still works
  assert.equal(lib.parseGrammar('root ::= "a"\n', null).ok, true);
  // the documented TypeError (text is not a string) is unchanged
  assert.throws(() => lib.lintGrammar(42, { lang: "fr" }), TypeError);
  assert.throws(() => lib.parseGrammar(undefined, { lang: "ko-KR" }), /`src` must be a string/);
});

test("a leading --lang with a missing or wrong value is a --lang error (exit 2)", () => {
  const none = run(["--lang"]);
  assert.equal(none.status, 2);
  assert.match(none.stderr, /gbnf-lens: --lang needs a value/);
  assert.doesNotMatch(none.stderr, /unknown command/);
  assert.match(run(["--lang"], { GBNF_LENS_LANG: "ko" }).stderr, /--lang 에는 값이 필요합니다/);
  // `--lang check x`: the command name sits where the value should be
  const cmd = run(["--lang", "check", "fixtures/bad/undefined.gbnf"]);
  assert.equal(cmd.status, 2);
  assert.match(cmd.stderr, /--lang needs 'en' or 'ko', got 'check'/);
  assert.doesNotMatch(cmd.stderr, /unknown command/);
  const empty = run(["--lang=", "check", "fixtures/bad/undefined.gbnf"]);
  assert.equal(empty.status, 2);
  assert.match(empty.stderr, /--lang needs 'en' or 'ko', got ''/);
  // a valid leading --lang with nothing after it: missing command, in the chosen language
  const only = run(["--lang", "ko"]);
  assert.equal(only.status, 2);
  assert.match(only.stderr, /명령이 없습니다/);
  assert.match(run(["--lang", "ko", "check"]).stderr, /문법 파일이 없습니다/);
  assert.match(run(["--lang", "ko", "--help"]).stdout, /사용법:/);
  assert.equal(run(["--lang", "ko", "-v"]).status, 0);
  // a later --lang wins, as when both follow the command
  assert.match(run(["--lang", "ko", ...bad, "--lang", "en"]).stdout, /never defined/);
});

test("every diagnostic code has English and Korean text", () => {
  const seen = new Set();
  for (const name of readdirSync(join(root, "fixtures", "bad")).filter((n) => n.endsWith(".gbnf"))) {
    const text = fixture(`bad/${name}`);
    const en = lib.lintGrammar(text, { lang: "en" });
    const ko = lib.lintGrammar(text, { lang: "ko" });
    assert.equal(en.length, ko.length, name);
    en.forEach((d, i) => {
      seen.add(d.code);
      assert.equal(ko[i].code, d.code);
      assert.ok(!hangul.test(d.message), `${d.code}: ${d.message}`);
      assert.ok(hangul.test(ko[i].message), `${d.code}: ${ko[i].message}`);
    });
  }
  for (const code of lib.DIAGNOSTIC_CODES) assert.ok(seen.has(code), `no fixture produces ${code}`);
});

test("extension: nls files, l10n bundle and manifest references agree", () => {
  const manifestText = read("extension", "package.json");
  const manifest = JSON.parse(manifestText);
  const nls = JSON.parse(read("extension", "package.nls.json"));
  const nlsKo = JSON.parse(read("extension", "package.nls.ko.json"));
  assert.deepEqual(Object.keys(nlsKo).sort(), Object.keys(nls).sort());
  const refs = [...manifestText.matchAll(/"%([^%"]+)%"/g)].map((m) => m[1]);
  assert.ok(refs.length >= 3);
  for (const key of refs) assert.ok(key in nls, `package.json uses %${key}% but package.nls.json has no such key`);
  assert.ok(hangul.test(nlsKo["command.checkSample.title"]));
  assert.equal(manifest.l10n, "./l10n");
  assert.match(manifest.engines.vscode, /^\^1\.90\./);

  // every vscode.l10n.t("...") string in extension.ts has a Korean entry, and the bundle has no stale keys
  const source = read("extension", "src", "extension.ts");
  const used = [...source.matchAll(/l10n\.t\("((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
  assert.ok(used.length >= 3);
  const bundle = JSON.parse(read("extension", "l10n", "bundle.l10n.ko.json"));
  assert.deepEqual(Object.keys(bundle).sort(), [...new Set(used)].sort());
  for (const key of used) assert.ok(hangul.test(bundle[key]) || key === "GBNF: {0}", key);
  assert.equal(manifest.version, JSON.parse(read("package.json")).version);
});

test("extension features: Korean output for Korean VS Code, English otherwise", () => {
  assert.equal(features.languageFor("ko"), "ko");
  assert.equal(features.languageFor("ko-kr"), "ko");
  assert.equal(features.languageFor("en"), "en");
  assert.equal(features.languageFor("fr"), "en");
  assert.equal(features.languageFor(undefined), "en");
  const text = "root ::= nothere\n";
  assert.match(features.computeDiagnostics(text)[0].message, /never defined/);
  const ko = features.computeDiagnostics(text, "ko")[0];
  assert.match(ko.message, /정의가 없습니다/);
  assert.equal(ko.code, "undefined-rule");
  assert.equal(ko.llamaMessage, "Undefined rule identifier 'nothere'");
  assert.equal(features.llamaSays("x"), "llama.cpp says: x");
  assert.equal(features.llamaSays("x", "ko"), "llama.cpp says: x");
  const bad = features.checkSample('root ::= "a"\n', "b", "ko");
  assert.equal(bad.ok, false);
  assert.match(bad.message, /샘플이 1:1 \(오프셋 0\) 에서 거부되었습니다/);
  assert.deepEqual(bad.location, { line: 0, character: 0 });
  assert.match(features.checkSample('root ::= "a"\n', "a", "ko").message, /샘플이 문법과 일치합니다/);
  assert.match(features.checkSample("root ::= x\n", "a", "ko").message, /샘플을 검사하지 않았습니다.*정의가 없습니다/);
  assert.match(features.checkSample('root ::= "a"\n', "b").message, /sample rejected at 1:1/);
});

test("expected-item names from the matcher follow the language (no English leaks into ko)", () => {
  const anyEn = lib.matchSample('root ::= "a" .\n', "a");
  assert.deepEqual(anyEn.expected, ["any character"]);
  const anyKo = lib.matchSample('root ::= "a" .\n', "a", { lang: "ko" });
  assert.deepEqual(anyKo.expected, ["아무 문자"]);
  const endEn = lib.matchSample('root ::= "a"\n', "ab");
  assert.deepEqual(endEn.expected, ["end of input"]);
  const endKo = lib.matchSample('root ::= "a"\n', "ab", { lang: "ko" });
  assert.deepEqual(endKo.expected, ["입력의 끝"]);
  const cli = run(["check", "fixtures/grammars/json.gbnf", "--sample-text", "x", "--lang", "ko"]);
  assert.doesNotMatch(cli.stdout, /any character|end of input/);
});

test("--lang may come before the command", () => {
  assert.match(run(["--lang", "ko", ...bad]).stdout, /정의가 없습니다/);
  assert.match(run(["--lang=ko", ...bad]).stdout, /정의가 없습니다/);
});
