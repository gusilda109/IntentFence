import { describe, expect, it } from "vitest";

import { buildApprovedOrder } from "@/modules/orchestration/approval-builder";
import { createSupervisor } from "@/modules/supervisor";
import { dependencyPolicyScenario } from "../../fixtures/policy/scenarios";

describe("approval builder mandate coverage", () => {
  it("rejects a forged accessory-only partial approval without the core item", async () => {
    const scenario = dependencyPolicyScenario();
    const [base, dependent] = scenario.proposedOrder.items;
    dependent.compatibility = [];
    const baseline = await createSupervisor({ mode: "replay" }).evaluateWithEvidence(
      scenario.mandate,
      scenario.proposedOrder,
      scenario.evidence,
    );

    expect(() => buildApprovedOrder(scenario.mandate, scenario.proposedOrder, {
      ...baseline,
      decision: "PARTIAL_ALLOW",
      itemDecisions: [
        { itemId: base.id, decision: "BLOCK", reasons: [] },
        { itemId: dependent.id, decision: "ALLOW", reasons: [] },
      ],
    })).toThrow("ORDER_NOT_APPROVABLE");
  });
});
