import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACTOR_TOOL_NAMES } from "@/modules/actor/live";

 describe("Actor capability boundary", () => {
  it("exposes only local read-only catalog, page, and evidence tools", () => {
    expect(ACTOR_TOOL_NAMES).toEqual([
      "catalog_list",
      "page_read",
      "evidence_acquire",
      "evidence_list",
    ]);
  });

  it("contains no executor imports, credential reads, or arbitrary network calls", () => {
    const actorRoot = join(process.cwd(), "src/modules/actor");
    const files = readdirSync(actorRoot, { recursive: true })
      .filter((entry): entry is string => typeof entry === "string" && entry.endsWith(".ts"));
    const source = files.map((file) => readFileSync(join(actorRoot, file), "utf8")).join("\n");

    expect(source).not.toMatch(/modules\/payment/);
    expect(source).not.toMatch(/PAYPAL_[A-Z_]+/);
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect([...source.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((match) => match[1])).toEqual([]);
  });
});
