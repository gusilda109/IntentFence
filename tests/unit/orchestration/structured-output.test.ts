import { describe, expect, it, vi } from "vitest";
import { withInvalidStructuredOutputRetry } from "@/server/structured-output";

describe("structured output retry", () => {
  it("retries one invalid model response", async () => {
    const invalidOutput = new Error("Invalid output type");
    invalidOutput.name = "ModelBehaviorError";
    const operation = vi.fn()
      .mockRejectedValueOnce(invalidOutput)
      .mockResolvedValueOnce({ finalOutput: "valid" });

    await expect(withInvalidStructuredOutputRetry(operation)).resolves.toEqual({ finalOutput: "valid" });
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("does not retry unrelated failures", async () => {
    const failure = new Error("Channel3 unavailable");
    const operation = vi.fn().mockRejectedValue(failure);

    await expect(withInvalidStructuredOutputRetry(operation)).rejects.toBe(failure);
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
