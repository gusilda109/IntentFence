import { describe, expect, it } from "vitest";
import { CHANNEL3_EXAMPLES } from "@/components/channel3-examples";

describe("real Channel3 demo examples", () => {
  it("covers the four product verdicts with unique presets", () => {
    expect(new Set(CHANNEL3_EXAMPLES.map((example) => example.id)).size).toBe(CHANNEL3_EXAMPLES.length);
    expect(new Set(CHANNEL3_EXAMPLES.map((example) => example.expectedVerdict))).toEqual(
      new Set(["ALLOW", "PARTIAL_ALLOW", "BLOCK", "REVIEW"]),
    );
  });

  it("contains complete human-readable mandates and constraints", () => {
    for (const example of CHANNEL3_EXAMPLES) {
      expect(example.label.length).toBeGreaterThan(0);
      expect(example.goal.length).toBeGreaterThan(20);
      expect(Number(example.budget)).toBeGreaterThan(0);
      expect(example.constraints.length).toBeGreaterThan(0);
      for (const constraint of example.constraints) {
        expect(constraint.text.length).toBeGreaterThan(10);
        expect(constraint.enforcement).toMatch(/^(hard|soft)$/);
      }
    }
  });

  it("marks the modes needed for the two mode-sensitive verdicts", () => {
    expect(CHANNEL3_EXAMPLES.find((example) => example.expectedVerdict === "PARTIAL_ALLOW")?.requiresReplay).toBe(true);
    expect(CHANNEL3_EXAMPLES.find((example) => example.expectedVerdict === "BLOCK")?.requiresLive).toBe(true);
  });
});
