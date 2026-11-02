import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  analyzeSource,
  readSource,
  relativeName,
  repoRoot,
  sourceFiles,
} from "./source-utils.js";

const actorFiles = sourceFiles("src/modules/actor");
const supervisorFiles = sourceFiles("src/modules/supervisor");
const frontendFiles = sourceFiles("src/app", "src/components").filter(
  (file) => !relativeName(file).startsWith("src/app/api/"),
);
const runtimeFiles = sourceFiles("src", "scripts");

function forbiddenImports(file: string, imports: string[]): string[] {
  const name = relativeName(file);
  const frontend = name.startsWith("src/app/") || name.startsWith("src/components/");
  return imports.filter((specifier) => {
    if (/(?:^|\/)modules\/payment(?:\/|$)/.test(specifier)) return true;
    if (/(?:^|\/)payment\/server(?:\/|$)/.test(specifier)) return true;
    if (/(?:^|\/)@paypal(?:\/|$)/.test(specifier) || specifier.startsWith("@paypal/")) {
      return true;
    }
    if (!frontend) return false;
    return (
      /(?:^|\/)modules\/(?:actor|supervisor|orchestration)(?:\/|$)/.test(specifier) ||
      /(?:^|\/)server(?:\/|$)/.test(specifier) ||
      specifier === "server-only" ||
      specifier === "prisma" ||
      specifier.startsWith("@prisma/")
    );
  });
}

describe("module trust boundaries", () => {
  it("actor, supervisor, and frontend have no forbidden payment/server imports or environment access", () => {
    for (const file of [...actorFiles, ...supervisorFiles, ...frontendFiles]) {
      const analysis = analyzeSource(file);
      expect(
        forbiddenImports(file, analysis.imports),
        `${relativeName(file)} must not cross a payment or server boundary`,
      ).toEqual([]);
      expect(
        analysis.envAccesses,
        `${relativeName(file)} must not read environment variables`,
      ).toEqual([]);
    }
  });

  it("PayPal credential names occur only inside payment/server", () => {
    const credentialName = /\bPAYPAL_(?:CLIENT_ID|CLIENT_SECRET|ACCESS_TOKEN|REFRESH_TOKEN)\b/g;
    const violations: string[] = [];

    for (const file of runtimeFiles) {
      const name = relativeName(file);
      if (name.startsWith("src/modules/payment/server/")) continue;
      const matches = readSource(file).match(credentialName) ?? [];
      if (matches.length > 0) violations.push(`${name}: ${matches.join(", ")}`);
    }

    expect(violations).toEqual([]);
  });

  it(".env.example documents credential names without credential values", () => {
    const envExample = readFileSync(path.join(repoRoot, ".env.example"), "utf8");
    for (const name of ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "OPENAI_API_KEY"]) {
      const line = envExample.split(/\r?\n/).find((candidate) => candidate.startsWith(`${name}=`));
      expect(line, `${name} must be present but empty`).toBe(`${name}=""`);
    }
  });

  it("client source contains no credential names, tokens, or bearer secrets", () => {
    const secretPattern =
      /\bPAYPAL_(?:CLIENT_ID|CLIENT_SECRET|ACCESS_TOKEN|REFRESH_TOKEN)\b|\bOPENAI_API_KEY\b|\b(?:access[_]?token|refresh[_]?token|client[_]?secret)\b|\bBearer\s+[A-Za-z0-9._~-]{8,}|\bsk-[A-Za-z0-9]{16,}/gi;
    const violations: string[] = [];

    for (const file of frontendFiles) {
      const matches = readSource(file).match(secretPattern) ?? [];
      if (matches.length > 0) {
        violations.push(`${relativeName(file)}: ${matches.join(", ")}`);
      }
    }

    expect(violations).toEqual([]);
  });

  it("has no capture route, capture endpoint string, or capture call in payment code", () => {
    const paymentAndApiFiles = sourceFiles("src/modules/payment", "src/app/api");
    const violations: string[] = [];

    for (const file of paymentAndApiFiles) {
      const name = relativeName(file);
      if (/(?:^|\/)capture(?:\/|\.)/i.test(name)) violations.push(`${name}: capture route/file`);

      const analysis = analyzeSource(file);
      for (const value of analysis.strings) {
        if (/v2\/checkout\/orders\/.*\/capture/i.test(value) || /^\/api\/.*capture/i.test(value)) {
          violations.push(`${name}: capture endpoint ${value}`);
        }
      }
      for (const call of analysis.captureCalls) {
        violations.push(`${name}: capture call ${call}`);
      }
    }

    expect(violations).toEqual([]);
  });
});
