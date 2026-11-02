import { beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  run: vi.fn(),
  agentOptions: [] as unknown[],
}));

vi.mock("@openai/agents", () => ({
  Agent: class {
    constructor(options: unknown) {
      sdk.agentOptions.push(options);
    }
  },
  run: sdk.run,
}));

import { createSupervisor } from "@/modules/supervisor";
import { createCoffeeReplay } from "@/modules/actor/replay";
import { VerdictSchema } from "@/shared/contracts";
import { coffeePolicyScenario } from "../../fixtures/policy/scenarios";
import { coffeeMandate } from "../../fixtures/stores/mandates";

describe("live Supervisor SDK boundary", () => {
  beforeEach(() => {
    sdk.run.mockReset();
    sdk.agentOptions.length = 0;
  });

  it("uses a tool-free structured Verdict agent and deterministic post-merge", async () => {
    const scenario = coffeePolicyScenario();
    const replay = await createSupervisor({ mode: "replay" }).evaluateWithEvidence(
      scenario.mandate,
      scenario.proposedOrder,
      scenario.evidence,
    );
    sdk.run.mockResolvedValue({
      finalOutput: {
        ...replay,
        decision: "ALLOW",
        itemDecisions: scenario.proposedOrder.items.map((item) => ({
          itemId: item.id,
          decision: "ALLOW",
          reasons: [],
        })),
        findings: [],
      },
    });

    const verdict = await createSupervisor({ mode: "live" }).evaluateWithEvidence(
      scenario.mandate,
      scenario.proposedOrder,
      scenario.evidence,
    );

    expect(sdk.agentOptions).toHaveLength(1);
    expect(sdk.agentOptions[0]).toMatchObject({ outputType: VerdictSchema, tools: [] });
    expect(sdk.run).toHaveBeenCalledTimes(1);
    expect(verdict.decision).toBe("PARTIAL_ALLOW");
    expect(verdict.itemDecisions.find((item) => item.itemId === scenario.proposedOrder.items[3].id))
      .toMatchObject({ decision: "BLOCK" });
  });

  it("accepts a semantically confirmed direct request across languages", async () => {
    const mandate = coffeeMandate();
    const replay = createCoffeeReplay(mandate);
    const baseline = await createSupervisor({ mode: "replay" }).evaluateWithEvidence(
      mandate,
      replay.proposal,
      replay.evidence,
    );
    sdk.run.mockResolvedValue({
      finalOutput: {
        ...baseline,
        decision: "ALLOW",
        itemDecisions: replay.proposal.items.map((item) => ({
          itemId: item.id,
          decision: "ALLOW",
          reasons: [],
        })),
        findings: [],
      },
    });

    const verdict = await createSupervisor({ mode: "live" }).evaluateWithEvidence(
      mandate,
      replay.proposal,
      replay.evidence,
    );

    expect(verdict.decision).toBe("PARTIAL_ALLOW");
    expect(verdict.itemDecisions[0]).toMatchObject({ decision: "ALLOW" });
    expect(verdict.itemDecisions[3]).toMatchObject({ decision: "BLOCK" });
  });

  it("rejects cross-item evidence and recovers missing semantic decisions", async () => {
    const mandate = coffeeMandate();
    const replay = createCoffeeReplay(mandate);
    const baseline = await createSupervisor({ mode: "replay" }).evaluateWithEvidence(
      mandate,
      replay.proposal,
      replay.evidence,
    );
    const [tablet, printer, adapter, license] = replay.proposal.items;
    const foreignReason = {
      code: "OTHER" as const,
      severity: "critical" as const,
      message: "The optional quarantined add-on is unnecessary.",
      evidenceIds: license.necessityEvidenceIds,
    };
    sdk.run.mockResolvedValue({
      finalOutput: {
        ...baseline,
        decision: "BLOCK",
        itemDecisions: [
          {
            itemId: tablet.id,
            decision: "BLOCK",
            reasons: [{ ...foreignReason, itemId: tablet.id }],
          },
          {
            itemId: adapter.id,
            decision: "BLOCK",
            reasons: [{ ...foreignReason, itemId: adapter.id }],
          },
        ],
        findings: [],
      },
    });

    const verdict = await createSupervisor({ mode: "live" }).evaluateWithEvidence(
      mandate,
      replay.proposal,
      replay.evidence,
    );

    expect(verdict.decision).toBe("PARTIAL_ALLOW");
    expect(verdict.itemDecisions).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemId: tablet.id, decision: "ALLOW" }),
      expect.objectContaining({ itemId: printer.id, decision: "ALLOW" }),
      expect.objectContaining({ itemId: adapter.id, decision: "ALLOW" }),
      expect.objectContaining({ itemId: license.id, decision: "BLOCK" }),
    ]));
  });

  it("validates external contracts before calling the model", async () => {
    const scenario = coffeePolicyScenario();
    scenario.proposedOrder.total.amountMinor = -1;

    await expect(createSupervisor({ mode: "live" }).evaluateWithEvidence(
      scenario.mandate,
      scenario.proposedOrder,
      scenario.evidence,
    )).rejects.toThrow();
    expect(sdk.run).not.toHaveBeenCalled();
  });
});
