import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

const sourceExtension = /\.(?:[cm]?[jt]sx?)$/;

export function sourceFiles(...roots: string[]): string[] {
  const files: string[] = [];

  function visit(absolutePath: string) {
    if (!existsSync(absolutePath)) return;
    const entries = readdirSync(absolutePath, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(absolutePath, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
      } else if (entry.isFile() && sourceExtension.test(entry.name)) {
        files.push(entryPath);
      }
    }
  }

  for (const root of roots) visit(path.resolve(repoRoot, root));
  return files.sort();
}

export function relativeName(absolutePath: string): string {
  return path.relative(repoRoot, absolutePath).split(path.sep).join("/");
}

export function readSource(absolutePath: string): string {
  return readFileSync(absolutePath, "utf8");
}

export interface SourceAnalysis {
  imports: string[];
  envAccesses: string[];
  strings: string[];
  captureCalls: string[];
}

export function analyzeSource(absolutePath: string): SourceAnalysis {
  const text = readSource(absolutePath);
  const sourceFile = ts.createSourceFile(
    absolutePath,
    text,
    ts.ScriptTarget.Latest,
    true,
    absolutePath.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const analysis: SourceAnalysis = {
    imports: [],
    envAccesses: [],
    strings: [],
    captureCalls: [],
  };

  function visit(node: ts.Node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      analysis.imports.push(node.moduleSpecifier.text);
    }

    if (ts.isCallExpression(node)) {
      const [firstArgument] = node.arguments;
      if (
        firstArgument &&
        ts.isStringLiteralLike(firstArgument) &&
        ((node.expression.kind === ts.SyntaxKind.ImportKeyword) ||
          (ts.isIdentifier(node.expression) && node.expression.text === "require"))
      ) {
        analysis.imports.push(firstArgument.text);
      }

      if (ts.isPropertyAccessExpression(node.expression)) {
        const method = node.expression.name.text;
        if (method === "capture" || method === "captureOrder") {
          analysis.captureCalls.push(node.expression.getText(sourceFile));
        }
      }
    }

    if (ts.isPropertyAccessExpression(node) && node.name.text === "env") {
      const target = node.expression.getText(sourceFile);
      if (["process", "import.meta", "Deno", "Bun"].includes(target)) {
        analysis.envAccesses.push(node.getText(sourceFile));
      }
    }

    if (
      ts.isElementAccessExpression(node) &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      node.argumentExpression.text === "env"
    ) {
      const target = node.expression.getText(sourceFile);
      if (["process", "import.meta", "Deno", "Bun"].includes(target)) {
        analysis.envAccesses.push(node.getText(sourceFile));
      }
    }

    if (ts.isStringLiteralLike(node)) analysis.strings.push(node.text);
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return analysis;
}
