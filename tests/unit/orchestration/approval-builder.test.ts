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

  it("refuses to approve an item whose price differs from the trusted listing", async () => {
    const scenario = dependencyPolicyScenario();
    const verdict = await createSupervisor({ mode: "replay" }).evaluateWithEvidence(
      scenario.mandate,
      scenario.proposedOrder,
      scenario.evidence,
    );
    const tampered = structuredClone(scenario.proposedOrder);
    tampered.items[0].unitPrice = { currency: "USD", amountMinor: 1 };
    tampered.total = {
      currency: "USD",
      amountMinor: tampered.items.reduce((sum, item) => sum + item.unitPrice.amountMinor * item.quantity, 0),
    };

    expect(verdict.decision).toBe("ALLOW");
    expect(() => buildApprovedOrder(scenario.mandate, tampered, verdict)).toThrow("PRICE_MISMATCH");
  });
});
