/**
 * Thin VS Code adapter: every decision is made in features.ts, this file only connects it to the editor.
 */
import * as vscode from "vscode";
import { checkSample, computeDiagnostics, findDefinition, languageFor, llamaSays } from "./features.js";

const LANGUAGE_ID = "gbnf";
const DEBOUNCE_MS = 250;

const SEVERITY: Record<string, vscode.DiagnosticSeverity> = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  info: vscode.DiagnosticSeverity.Information,
};

export function activate(context: vscode.ExtensionContext): void {
  const collection = vscode.languages.createDiagnosticCollection("gbnf-lens");
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const refresh = (doc: vscode.TextDocument): void => {
    if (doc.languageId !== LANGUAGE_ID) return;
    const diagnostics = computeDiagnostics(doc.getText(), languageFor(vscode.env.language)).map((d) => {
      const range = new vscode.Range(d.startLine, d.startCharacter, d.endLine, d.endCharacter);
      const item = new vscode.Diagnostic(range, d.message, SEVERITY[d.severity]);
      item.source = "gbnf-lens";
      item.code = d.code;
      if (d.llamaMessage) {
        item.relatedInformation = [
          new vscode.DiagnosticRelatedInformation(new vscode.Location(doc.uri, range), llamaSays(d.llamaMessage)),
        ];
      }
      return item;
    });
    collection.set(doc.uri, diagnostics);
  };

  const schedule = (doc: vscode.TextDocument): void => {
    const key = doc.uri.toString();
    const old = timers.get(key);
    if (old) clearTimeout(old);
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key);
        refresh(doc);
      }, DEBOUNCE_MS),
    );
  };

  context.subscriptions.push(
    collection,
    { dispose: () => timers.forEach((t) => clearTimeout(t)) },
    vscode.workspace.onDidOpenTextDocument(refresh),
    vscode.workspace.onDidChangeTextDocument((e) => schedule(e.document)),
    vscode.workspace.onDidCloseTextDocument((doc) => collection.delete(doc.uri)),
    vscode.languages.registerDefinitionProvider(
      { language: LANGUAGE_ID },
      {
        provideDefinition(doc, position) {
          const loc = findDefinition(doc.getText(), position.line, position.character);
          if (!loc) return undefined;
          return new vscode.Location(doc.uri, new vscode.Range(loc.line, loc.character, loc.endLine, loc.endCharacter));
        },
      },
    ),
    vscode.commands.registerCommand("gbnf-lens.checkSample", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== LANGUAGE_ID) {
        void vscode.window.showWarningMessage(vscode.l10n.t("GBNF: open a .gbnf file first."));
        return;
      }
      // The selection is the sample; with no selection, ask for a file.
      let sample: string;
      if (!editor.selection.isEmpty) sample = editor.document.getText(editor.selection);
      else {
        const picked = await vscode.window.showOpenDialog({ canSelectMany: false, openLabel: vscode.l10n.t("Use as sample") });
        const uri = picked?.[0];
        if (!uri) return;
        sample = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8");
      }
      const result = checkSample(editor.document.getText(), sample, languageFor(vscode.env.language));
      if (result.ok === true) void vscode.window.showInformationMessage(vscode.l10n.t("GBNF: {0}", result.message));
      else void vscode.window.showWarningMessage(vscode.l10n.t("GBNF: {0}", result.message));
    }),
  );

  vscode.workspace.textDocuments.forEach(refresh);
}

export function deactivate(): void {
  // Everything is disposed through context.subscriptions.
}
