import { describe, expect, it } from "vitest";

import { sha256 } from "@/server/canonical-json";
import { VerdictSchema, type Verdict } from "@/shared/contracts";
import { createSupervisor } from "@/modules/supervisor";
import {
  evaluatePolicy,
  computeSupervisorInputHash,
  isMandateCoreItem,
} from "@/modules/supervisor/policy-engine";
import {
  coffeePolicyScenario,
  dependencyPolicyScenario,
  workshopPolicyScenario,
  type PolicyScenario,
} from "../../fixtures/policy/scenarios";

async function evaluate(scenario: PolicyScenario): Promise<Verdict> {
  return createSupervisor({ mode: "replay" }).evaluateWithEvidence(
    scenario.mandate,
    scenario.proposedOrder,
    scenario.evidence,
  );
}

function itemDecision(verdict: Verdict, itemId: string) {
  const decision = verdict.itemDecisions.find((item) => item.itemId === itemId);
  expect(decision).toBeDefined();
  return decision!;
}

describe("Supervisor replay policy", () => {
  it("allows viable coffee equipment and blocks only the infected seller-only addition", async () => {
    const scenario = coffeePolicyScenario();
    const verdict = await evaluate(scenario);
    const [tablet, printer, adapter, upsell] = scenario.proposedOrder.items;

    expect(VerdictSchema.parse(verdict)).toEqual(verdict);
    expect(verdict.decision).toBe("PARTIAL_ALLOW");
    expect(itemDecision(verdict, tablet.id).decision).toBe("ALLOW");
    expect(itemDecision(verdict, printer.id).decision).toBe("ALLOW");
    expect(itemDecision(verdict, adapter.id).decision).toBe("ALLOW");
    expect(itemDecision(verdict, upsell.id).decision).toBe("BLOCK");
    expect(itemDecision(verdict, upsell.id).reasons.map((reason) => reason.code)).toEqual(
      expect.arrayContaining(["SELLER_ONLY_NECESSITY", "PROMPT_INJECTION"]),
    );
  });

  it("retains the affordable core coffee subset when the proposal exceeds budget", async () => {
    const scenario = coffeePolicyScenario();
    scenario.mandate.budget.amountMinor = 45_000;
    const [tablet, printer, adapter, upsell] = scenario.proposedOrder.items;

    const verdict = await evaluate(scenario);

    expect(verdict.decision).toBe("PARTIAL_ALLOW");
    expect(itemDecision(verdict, tablet.id).decision).toBe("ALLOW");
    expect(itemDecision(verdict, printer.id).decision).toBe("ALLOW");
    expect(itemDecision(verdict, adapter.id).decision).toBe("ALLOW");
    expect(itemDecision(verdict, upsell.id).decision).toBe("BLOCK");
    expect(verdict.findings.map((finding) => finding.code)).toContain("BUDGET_EXCEEDED");
    const retainedTotal = scenario.proposedOrder.items
      .filter((item) => itemDecision(verdict, item.id).decision === "ALLOW")
      .reduce((sum, item) => sum + item.unitPrice.amountMinor * item.quantity, 0);
    expect(retainedTotal).toBe(41_000);
  });

  it("excludes an over-budget dependency while retaining an affordable core-only subset", async () => {
    const scenario = dependencyPolicyScenario();
    scenario.mandate.budget.amountMinor = 18_000;
    const [base, dependent] = scenario.proposedOrder.items;

    const verdict = await evaluate(scenario);

    expect(verdict.decision).toBe("PARTIAL_ALLOW");
    expect(itemDecision(verdict, base.id).decision).toBe("ALLOW");
    expect(itemDecision(verdict, dependent.id).decision).toBe("REVIEW");
    expect(itemDecision(verdict, dependent.id).reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "BUDGET_EXCEEDED",
        severity: "warning",
        message: expect.stringContaining("excluded from the payable subset"),
      }),
    ]));
  });

  it("does not retain an incomplete budget-feasible subset when every item is core", async () => {
    const scenario = dependencyPolicyScenario();
    const [base, dependent] = scenario.proposedOrder.items;
    scenario.mandate.goal = "Set up a base console and sensor module for field work";
    base.purpose = "Base console explicitly requested by the mandate for field work";
    dependent.purpose = "Sensor module explicitly requested by the mandate for field work";

    expect(scenario.proposedOrder.items.every((item) =>
      isMandateCoreItem(scenario.mandate, item))).toBe(true);
    const baseline = await evaluate(scenario);
    expect(baseline.decision).toBe("ALLOW");
    expect(baseline.itemDecisions.every((item) => item.decision === "ALLOW")).toBe(true);
    expect(base.unitPrice.amountMinor * base.quantity).toBeLessThan(18_000);
    expect(scenario.proposedOrder.total.amountMinor).toBeGreaterThan(18_000);

    scenario.mandate.budget.amountMinor = 18_000;
    const verdict = await evaluate(scenario);

    expect(verdict.decision).toBe("BLOCK");
    expect(verdict.itemDecisions.every((item) => item.decision === "BLOCK")).toBe(true);
    for (const item of scenario.proposedOrder.items) {
      expect(itemDecision(verdict, item.id).reasons).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "BUDGET_EXCEEDED", severity: "critical" }),
      ]));
    }
    expect(itemDecision(verdict, dependent.id).reasons.map((reason) => reason.code)).not.toContain(
      "UNMET_DEPENDENCY",
    );
  });

  it("blocks every baseline ALLOW item when no all-core budget-feasible subset exists", async () => {
    const scenario = dependencyPolicyScenario();
    scenario.mandate.budget.amountMinor = 14_000;
    const [base] = scenario.proposedOrder.items;

    const verdict = await evaluate(scenario);

    expect(verdict.decision).toBe("BLOCK");
    expect(verdict.itemDecisions.every((item) => item.decision === "BLOCK")).toBe(true);
    expect(itemDecision(verdict, base.id).reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "BUDGET_EXCEEDED", severity: "critical" }),
    ]));
  });

  it("allows the complete dependency graph at the exact budget", async () => {
    const scenario = dependencyPolicyScenario();
    scenario.mandate.budget.amountMinor = 21_000;

    const verdict = await evaluate(scenario);

    expect(verdict.decision).toBe("ALLOW");
    expect(verdict.itemDecisions.every((item) => item.decision === "ALLOW")).toBe(true);
  });

  it("keeps invalid arithmetic fail-closed when the order is also over budget", async () => {
    const scenario = dependencyPolicyScenario();
    scenario.mandate.budget.amountMinor = 1_000;
    scenario.proposedOrder.total.amountMinor += 1;

    const verdict = await evaluate(scenario);

    expect(verdict.decision).toBe("BLOCK");
    expect(verdict.itemDecisions.every((item) => item.decision === "BLOCK")).toBe(true);
    expect(verdict.findings.map((finding) => finding.code)).toEqual(expect.arrayContaining([
      "INVALID_ARITHMETIC",
      "BUDGET_EXCEEDED",
    ]));
  });

  it("uses the persisted replay purpose for the required Russian coffee goal", async () => {
    const scenario = coffeePolicyScenario();
    scenario.mandate.goal = "Организуй кассу кофейни на базе планшета";
    const [tablet, printer, adapter, upsell] = scenario.proposedOrder.items;
    tablet.purpose = "Base tablet explicitly requested for the coffee counter.";

    const verdict = await evaluate(scenario);

    expect(verdict.decision).toBe("PARTIAL_ALLOW");
    expect(itemDecision(verdict, tablet.id).decision).toBe("ALLOW");
    expect(itemDecision(verdict, printer.id).decision).toBe("ALLOW");
    expect(itemDecision(verdict, adapter.id).decision).toBe("ALLOW");
    expect(itemDecision(verdict, upsell.id).decision).toBe("BLOCK");
    expect(itemDecision(verdict, upsell.id).reasons.map((reason) => reason.code)).toContain(
      "SELLER_ONLY_NECESSITY",
    );
  });

  it("requires REVIEW for an explicit hard human-review constraint", async () => {
    const scenario = coffeePolicyScenario();
    scenario.mandate.constraints = [{
      id: "manual-gate",
      text: "Require human review before any purchase; do not create an order automatically.",
      enforcement: "hard",
    }];

    const verdict = await evaluate(scenario);

    expect(VerdictSchema.parse(verdict)).toEqual(verdict);
    expect(verdict.decision).toBe("REVIEW");
    expect(verdict.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "MANDATE_CONFLICT" }),
    ]));
    expect(verdict.itemDecisions).toHaveLength(scenario.proposedOrder.items.length);
  });

  it("keeps the seller-only decision after a complete product rename", async () => {
    const scenario = coffeePolicyScenario();
    const upsell = scenario.proposedOrder.items[3];
    upsell.name = "Service Enablement Pass";
    upsell.description = "A differently named optional entitlement.";
    upsell.purpose = "Provide an optional account entitlement";

    const verdict = await evaluate(scenario);

    expect(verdict.decision).toBe("PARTIAL_ALLOW");
    expect(itemDecision(verdict, upsell.id).decision).toBe("BLOCK");
    expect(itemDecision(verdict, upsell.id).reasons.map((reason) => reason.code)).toContain(
      "SELLER_ONLY_NECESSITY",
    );
  });

  it("recognizes an explicitly requested TV with aggregator necessity evidence", async () => {
    const scenario = coffeePolicyScenario();
    const tv = scenario.proposedOrder.items[0];
    const tvEvidence = scenario.evidence[0];
    scenario.mandate.goal = "buy tv and sofa for my living room";
    tv.name = "Smart TV";
    tv.purpose = "TV entertainment display";
    tvEvidence.evidence.source.sourceClass = "aggregator";
    scenario.proposedOrder.items = [tv];
    scenario.proposedOrder.evidenceIds = [tvEvidence.evidence.id];
    scenario.proposedOrder.total = { ...tv.unitPrice };
    scenario.evidence = [tvEvidence];

    const verdict = await evaluate(scenario);

    expect(verdict.decision).toBe("ALLOW");
    expect(itemDecision(verdict, tv.id)).toMatchObject({ decision: "ALLOW", reasons: [] });
  });

  it("does not let semantic necessity doubt reject a directly requested item with clean evidence", async () => {
    const scenario = coffeePolicyScenario();
    const tv = scenario.proposedOrder.items[0];
    const tvEvidence = scenario.evidence[0];
    scenario.mandate.goal = "Buy a Samsung The Frame Pro TV for my living room";
    tv.name = "Samsung The Frame Pro 65-inch TV";
    tv.purpose = "Samsung The Frame Pro TV explicitly requested by the mandate for the living room";
    tvEvidence.evidence.source.sourceClass = "aggregator";
    scenario.proposedOrder.items = [tv];
    scenario.proposedOrder.evidenceIds = [tvEvidence.evidence.id];
    scenario.proposedOrder.total = { ...tv.unitPrice };
    scenario.evidence = [tvEvidence];
    const baseline = await evaluate(scenario);

    const verdict = evaluatePolicy({
      ...scenario,
      semanticVerdict: {
        ...baseline,
        decision: "REVIEW",
        itemDecisions: [{
          itemId: tv.id,
          decision: "REVIEW",
          reasons: [{
            code: "INSUFFICIENT_NECESSITY",
            severity: "warning",
            message: "Necessity is not established.",
            itemId: tv.id,
            evidenceIds: tv.necessityEvidenceIds,
          }],
        }],
        findings: [],
      },
    });

    expect(verdict.decision).toBe("ALLOW");
    expect(itemDecision(verdict, tv.id)).toMatchObject({ decision: "ALLOW", reasons: [] });
  });

  it("turns a critical hard-constraint conflict into BLOCK even when the model says REVIEW", async () => {
    const scenario = coffeePolicyScenario();
    const bundledTv = scenario.proposedOrder.items[0];
    const tvEvidence = scenario.evidence[0];
    scenario.mandate.goal = "Buy a Samsung The Frame Pro TV with a 26 Month Protection Pack";
    scenario.mandate.constraints = [{
      id: "no-protection-pack",
      text: "Do not include extended warranties, protection packs, or protection plans.",
      enforcement: "hard",
    }];
    bundledTv.name = "Samsung The Frame Pro TV + 26 Month Protection Pack";
    bundledTv.purpose = "Samsung The Frame Pro TV with a 26 Month Protection Pack";
    tvEvidence.evidence.source.sourceClass = "aggregator";
    scenario.proposedOrder.items = [bundledTv];
    scenario.proposedOrder.evidenceIds = [tvEvidence.evidence.id];
    scenario.proposedOrder.total = { ...bundledTv.unitPrice };
    scenario.evidence = [tvEvidence];
    const baseline = await evaluate(scenario);

    const verdict = evaluatePolicy({
      ...scenario,
      semanticVerdict: {
        ...baseline,
        decision: "REVIEW",
        itemDecisions: [{
          itemId: bundledTv.id,
          decision: "REVIEW",
          reasons: [{
            code: "MANDATE_CONFLICT",
            severity: "critical",
            message: "The bundled protection pack violates the hard constraint.",
            itemId: bundledTv.id,
            evidenceIds: bundledTv.necessityEvidenceIds,
          }],
        }],
        findings: [],
      },
    });

    expect(verdict.decision).toBe("BLOCK");
    expect(itemDecision(verdict, bundledTv.id).decision).toBe("BLOCK");
    expect(itemDecision(verdict, bundledTv.id).reasons.map((reason) => reason.code)).toContain(
      "MANDATE_CONFLICT",
    );
  });

  it("keeps semantic necessity review for an optional seller add-on", async () => {
    const scenario = coffeePolicyScenario();
    const optionalAddOn = scenario.proposedOrder.items[3];
    const baseline = await evaluate(scenario);

    const verdict = evaluatePolicy({
      ...scenario,
      semanticVerdict: {
        ...baseline,
        decision: "REVIEW",
        itemDecisions: scenario.proposedOrder.items.map((item) => ({
          itemId: item.id,
          decision: item.id === optionalAddOn.id ? "REVIEW" as const : "ALLOW" as const,
          reasons: item.id === optionalAddOn.id ? [{
            code: "INSUFFICIENT_NECESSITY" as const,
            severity: "warning" as const,
            message: "The optional add-on lacks independent necessity evidence.",
            itemId: item.id,
            evidenceIds: item.necessityEvidenceIds,
          }] : [],
        })),
        findings: [],
      },
    });

    expect(itemDecision(verdict, optionalAddOn.id).decision).not.toBe("ALLOW");
    expect(itemDecision(verdict, optionalAddOn.id).reasons.map((reason) => reason.code)).toContain(
      "SELLER_ONLY_NECESSITY",
    );
  });

  it("applies the same evidence-graph rules in a different product domain", async () => {
    const scenario = workshopPolicyScenario();
    const verdict = await evaluate(scenario);
    const [base, attachment, extra] = scenario.proposedOrder.items;

    expect(verdict.decision).toBe("PARTIAL_ALLOW");
    expect(itemDecision(verdict, base.id).decision).toBe("ALLOW");
    expect(itemDecision(verdict, attachment.id).decision).toBe("ALLOW");
    expect(itemDecision(verdict, extra.id).decision).toBe("REVIEW");
    expect(itemDecision(verdict, extra.id).reasons.map((reason) => reason.code)).toContain(
      "SELLER_ONLY_NECESSITY",
    );
  });

  it("uses publisher identity rather than sourceClass claims for independence", async () => {
    const scenario = workshopPolicyScenario();
    const attachment = scenario.proposedOrder.items[1];
    for (const record of scenario.evidence.slice(1, 3)) {
      record.evidence.source.publisherId = "tool-publisher";
    }

    const verdict = await evaluate(scenario);

    expect(itemDecision(verdict, attachment.id).decision).toBe("REVIEW");
    expect(itemDecision(verdict, attachment.id).reasons.map((reason) => reason.code)).toContain(
      "INSUFFICIENT_NECESSITY",
    );
  });

  it("returns REVIEW when clean evidence contains no necessity claim", async () => {
    const scenario = dependencyPolicyScenario();
    const base = scenario.proposedOrder.items[0];
    scenario.evidence[0].evidence.claims = [{ kind: "feature", text: "A feature description only." }];

    const verdict = await evaluate(scenario);

    expect(verdict.decision).toBe("REVIEW");
    expect(itemDecision(verdict, base.id).decision).toBe("REVIEW");
    expect(itemDecision(verdict, base.id).reasons.map((reason) => reason.code)).toContain(
      "INSUFFICIENT_NECESSITY",
    );
  });

  it("blocks an accessory when trusted evidence explicitly establishes incompatibility", async () => {
    const scenario = dependencyPolicyScenario();
    const dependent = scenario.proposedOrder.items[1];
    scenario.evidence[2].evidence.claims = [{
      kind: "incompatibility",
      text: "The manufacturer states that the accessory interface is incompatible with the base console.",
    }];

    const verdict = await evaluate(scenario);

    expect(verdict.decision).toBe("PARTIAL_ALLOW");
    expect(itemDecision(verdict, dependent.id).decision).toBe("BLOCK");
    expect(itemDecision(verdict, dependent.id).reasons.map((reason) => reason.code)).toContain(
      "INCOMPATIBLE",
    );
  });

  it("quarantines a directly requested item when its supporting capture is infected", async () => {
    const scenario = dependencyPolicyScenario();
    const base = scenario.proposedOrder.items[0];
    scenario.evidence[0].security.status = "QUARANTINED";
    scenario.evidence[0].security.findings = [{ code: "HIDDEN_INSTRUCTION", message: "Hidden instruction." }];

    const verdict = await evaluate(scenario);

    expect(verdict.decision).toBe("BLOCK");
    expect(itemDecision(verdict, base.id).decision).toBe("BLOCK");
    expect(itemDecision(verdict, base.id).reasons.map((reason) => reason.code)).toContain(
      "PROMPT_INJECTION",
    );
  });

  it("enforces budget independently of semantic allow decisions", async () => {
    const scenario = dependencyPolicyScenario();
    scenario.mandate.budget.amountMinor = 1_000;
    const semanticVerdict = allAllowVerdict(await evaluate({
      ...scenario,
      mandate: { ...scenario.mandate, budget: { currency: "USD", amountMinor: 40_000 } },
    }), scenario);

    const verdict = evaluatePolicy({ ...scenario, semanticVerdict });

    expect(verdict.decision).toBe("BLOCK");
    expect(verdict.itemDecisions.every((item) => item.decision === "BLOCK")).toBe(true);
    expect(verdict.findings.map((finding) => finding.code)).toContain("BUDGET_EXCEEDED");
  });

  it("rejects invalid arithmetic before any payable subset can be produced", async () => {
    const scenario = dependencyPolicyScenario();
    scenario.proposedOrder.total.amountMinor += 1;

    const verdict = await evaluate(scenario);

    expect(verdict.decision).toBe("BLOCK");
    expect(verdict.findings.map((finding) => finding.code)).toContain("INVALID_ARITHMETIC");
  });
});

describe("dependency closure", () => {
  it("allows a complete supported dependency graph", async () => {
    const scenario = dependencyPolicyScenario();
    const verdict = await evaluate(scenario);

    expect(verdict.decision).toBe("ALLOW");
    expect(verdict.itemDecisions.every((item) => item.decision === "ALLOW")).toBe(true);
  });

  it("blocks an independently supported accessory when its required base is blocked", async () => {
    const scenario = dependencyPolicyScenario();
    const [base, dependent] = scenario.proposedOrder.items;
    scenario.evidence[0].security.status = "QUARANTINED";

    const verdict = await evaluate(scenario);

    expect(verdict.decision).toBe("BLOCK");
    expect(itemDecision(verdict, base.id).decision).toBe("BLOCK");
    expect(itemDecision(verdict, dependent.id).decision).toBe("BLOCK");
    expect(itemDecision(verdict, dependent.id).reasons.map((reason) => reason.code)).toContain(
      "UNMET_DEPENDENCY",
    );
  });

  it("does not emit PARTIAL_ALLOW when the required base needs review", async () => {
    const scenario = dependencyPolicyScenario();
    const dependent = scenario.proposedOrder.items[1];
    scenario.evidence[0].evidence.claims = [{ kind: "feature", text: "No necessity is established." }];

    const verdict = await evaluate(scenario);

    expect(verdict.decision).toBe("REVIEW");
    expect(itemDecision(verdict, dependent.id).decision).toBe("REVIEW");
    expect(itemDecision(verdict, dependent.id).reasons.map((reason) => reason.code)).toContain(
      "UNMET_DEPENDENCY",
    );
  });

  it("keeps only the viable base when a dependency target is absent", async () => {
    const scenario = dependencyPolicyScenario();
    const [base, dependent] = scenario.proposedOrder.items;
    dependent.compatibility[0].withItemId = "50000000-0000-4000-8000-000000000099";

    const verdict = await evaluate(scenario);

    expect(verdict.decision).toBe("PARTIAL_ALLOW");
    expect(itemDecision(verdict, base.id).decision).toBe("ALLOW");
    expect(itemDecision(verdict, dependent.id).decision).toBe("BLOCK");
    expect(itemDecision(verdict, dependent.id).reasons.map((reason) => reason.code)).toContain(
      "UNMET_DEPENDENCY",
    );
  });
});

describe("mandate coverage and evidence ownership", () => {
  it("never creates an accessory-only PARTIAL_ALLOW when the core item is blocked", async () => {
    const scenario = dependencyPolicyScenario();
    const [base, dependent] = scenario.proposedOrder.items;
    dependent.compatibility = [];
    scenario.evidence[0].security.status = "QUARANTINED";

    const verdict = await evaluate(scenario);

    expect(verdict.decision).toBe("BLOCK");
    expect(itemDecision(verdict, base.id).decision).toBe("BLOCK");
    expect(itemDecision(verdict, dependent.id).decision).toBe("ALLOW");
  });

  it("requires order review when the core item is uncertain even if an accessory is allowed", async () => {
    const scenario = dependencyPolicyScenario();
    const [base, dependent] = scenario.proposedOrder.items;
    dependent.compatibility = [];
    scenario.evidence[0].evidence.claims = [{ kind: "feature", text: "No necessity is established." }];

    const verdict = await evaluate(scenario);

    expect(verdict.decision).toBe("REVIEW");
    expect(itemDecision(verdict, base.id).decision).toBe("REVIEW");
    expect(itemDecision(verdict, dependent.id).decision).toBe("ALLOW");
  });

  it("requires review rather than blocking an optional aggregator-only addition", async () => {
    const scenario = workshopPolicyScenario();
    const extra = scenario.proposedOrder.items[2];
    scenario.evidence[3].evidence.source.sourceClass = "aggregator";

    const verdict = await evaluate(scenario);

    expect(verdict.decision).toBe("PARTIAL_ALLOW");
    expect(itemDecision(verdict, extra.id).decision).toBe("REVIEW");
    expect(itemDecision(verdict, extra.id).reasons.map((reason) => reason.code)).toContain(
      "INSUFFICIENT_NECESSITY",
    );
  });

  it("accepts compatibility evidence from either endpoint but rejects a third product", async () => {
    const validScenario = dependencyPolicyScenario();
    const [base] = validScenario.proposedOrder.items;
    base.storeId = "base-store";
    validScenario.evidence[0].evidence.source.storeId = "base-store";
    validScenario.evidence[2].evidence.source.sourceClass = "aggregator";
    validScenario.evidence[2].evidence.source.storeId = "base-store";

    const validVerdict = await evaluate(validScenario);
    expect(validVerdict.decision).toBe("ALLOW");

    const invalidScenario = dependencyPolicyScenario();
    const dependent = invalidScenario.proposedOrder.items[1];
    invalidScenario.evidence[2].evidence.source.sourceClass = "aggregator";
    invalidScenario.evidence[2].evidence.source.storeId = "unrelated-store";

    const invalidVerdict = await evaluate(invalidScenario);
    expect(itemDecision(invalidVerdict, dependent.id).decision).toBe("BLOCK");
    expect(itemDecision(invalidVerdict, dependent.id).reasons.map((reason) => reason.code)).toContain(
      "UNTRUSTED_EVIDENCE",
    );
  });
});

describe("Verdict integrity", () => {
  it("computes inputHash from the exact canonical supervisor input", async () => {
    const scenario = coffeePolicyScenario();
    const expected = sha256({
      mandate: scenario.mandate,
      proposedOrder: scenario.proposedOrder,
      trustedEvidenceMetadata: scenario.evidence.map((record) => record.evidence),
      securityReports: scenario.evidence.map((record) => record.security),
    });

    const first = await evaluate(scenario);
    const second = await evaluate(scenario);

    expect(first.inputHash).toBe(expected);
    expect(first.inputHash).toBe(computeSupervisorInputHash(
      scenario.mandate,
      scenario.proposedOrder,
      scenario.evidence,
    ));
    expect(second.inputHash).toBe(expected);
    scenario.evidence[0].security.findings = [{ code: "NEW_REPORT", message: "Changed trusted report." }];
    expect((await evaluate(scenario)).inputHash).not.toBe(expected);
  });

  it("covers every item exactly once and gives every rejection a reason", async () => {
    const scenario = coffeePolicyScenario();
    const verdict = await evaluate(scenario);
    const coveredIds = verdict.itemDecisions.map((item) => item.itemId);

    expect(new Set(coveredIds).size).toBe(scenario.proposedOrder.items.length);
    expect(coveredIds).toEqual(expect.arrayContaining(scenario.proposedOrder.items.map((item) => item.id)));
    for (const item of verdict.itemDecisions) {
      if (item.decision !== "ALLOW") expect(item.reasons.length).toBeGreaterThan(0);
    }
  });

  it("does not let a semantic ALLOW overwrite quarantine or seller-only policy", async () => {
    const scenario = coffeePolicyScenario();
    const replayVerdict = await evaluate(scenario);

    const verdict = evaluatePolicy({
      ...scenario,
      semanticVerdict: allAllowVerdict(replayVerdict, scenario),
    });
    const upsell = scenario.proposedOrder.items[3];

    expect(verdict.decision).toBe("PARTIAL_ALLOW");
    expect(itemDecision(verdict, upsell.id).decision).toBe("BLOCK");
    expect(itemDecision(verdict, upsell.id).reasons.map((reason) => reason.code)).toEqual(
      expect.arrayContaining(["PROMPT_INJECTION", "SELLER_ONLY_NECESSITY"]),
    );
  });

  it("fails closed through the evidence-free SupervisorPort surface", async () => {
    const scenario = dependencyPolicyScenario();
    const verdict = await createSupervisor({ mode: "replay" }).evaluate(
      scenario.mandate,
      scenario.proposedOrder,
    );

    expect(verdict.decision).toBe("BLOCK");
    expect(verdict.findings.map((finding) => finding.code)).toContain("UNTRUSTED_EVIDENCE");
  });
});

function allAllowVerdict(base: Verdict, scenario: PolicyScenario): Verdict {
  return {
    ...base,
    decision: "ALLOW",
    itemDecisions: scenario.proposedOrder.items.map((item) => ({
      itemId: item.id,
      decision: "ALLOW",
      reasons: [],
    })),
    findings: [],
  };
}
