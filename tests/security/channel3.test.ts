import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CreateRunInputSchema, RunViewSchema } from "@/shared/contracts";
import { repoRoot, sourceFiles, relativeName, readSource } from "./source-utils.js";

describe("Channel3 secret and fallback boundaries", () => {
  it("keeps server authentication headers and environment access out of frontend source", () => {
    const violations: string[] = [];
    for (const file of sourceFiles("src/app", "src/components")) {
      if (relativeName(file).startsWith("src/app/api/")) continue;
      const source = readSource(file);
      if (/process\.env|x-api-key|CHANNEL3_API_BASE_URL/.test(source)) violations.push(relativeName(file));
    }
    expect(violations).toEqual([]);
  });

  it("documents an empty server-only key and fixes the API origin in server code", () => {
    const envExample = readFileSync(path.join(repoRoot, ".env.example"), "utf8");
    expect(envExample.split(/\r?\n/)).toContain('CHANNEL3_API_KEY=""');
    const client = readFileSync(path.join(repoRoot, "src/modules/catalog/channel3-client.ts"), "utf8");
    expect(client).toContain('https://api.trychannel3.com');
    expect(client).not.toContain("console.");
  });

  it("defaults create-run input to Channel3 and rejects secret fields in public contracts", () => {
    expect(CreateRunInputSchema.parse({ goal: "tablet", budget: 10_000, constraints: [] }).catalogSource).toBe("channel3");
    expect(CreateRunInputSchema.safeParse({ goal: "tablet", budget: 10_000, constraints: [], apiKey: "secret" }).success).toBe(false);
    expect("apiKey" in RunViewSchema.shape).toBe(false);
    expect("channel3ApiKey" in RunViewSchema.shape).toBe(false);
  });
});
