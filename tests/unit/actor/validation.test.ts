import { describe, expect, it } from "vitest";
import { ProposedOrderSchema, type EvidenceRecord, type ProposedOrder } from "@/shared/contracts";
import { createCoffeeReplay } from "@/modules/actor/replay";
import { validateProposedOrder } from "@/modules/actor/validation";
import { coffeeMandate } from "../../fixtures/stores/mandates";

const setup = () => {
  const mandate = coffeeMandate();
  const { proposal, evidence } = createCoffeeReplay(mandate);
  return { mandate, proposal, evidence };
};

const editProposal = (proposal: ProposedOrder, edit: (draft: ProposedOrder) => void): ProposedOrder => {
  const draft = structuredClone(proposal);
  edit(draft);
  return draft;
};

 describe("proposal validation", () => {
  it("accepts the complete trusted replay graph and arithmetic", () => {
    const { mandate, proposal, evidence } = setup();
    expect(ProposedOrderSchema.parse(validateProposedOrder(mandate, proposal, evidence))).toEqual(proposal);
    expect(proposal.total.amountMinor).toBe(32900 + 18900 + 3900 + 9900);
  });

  it("rejects unknown and omitted evidence references", () => {
    const { mandate, proposal, evidence } = setup();
    const unknown = editProposal(proposal, (draft) => {
      draft.evidenceIds[0] = "77777777-7777-4777-8777-777777777777";
    });
    expect(() => validateProposedOrder(mandate, unknown, evidence)).toThrow(/Unknown proposal evidence/);

    const omitted = editProposal(proposal, (draft) => {
      draft.evidenceIds = draft.evidenceIds.slice(1);
    });
    expect(() => validateProposedOrder(mandate, omitted, evidence)).toThrow(/missing from proposal.evidenceIds/);
  });

  it("rejects invalid arithmetic and non-allowlisted product URLs", () => {
    const { mandate, proposal, evidence } = setup();
    const badTotal = editProposal(proposal, (draft) => { draft.total.amountMinor += 1; });
    expect(() => validateProposedOrder(mandate, badTotal, evidence)).toThrow(/arithmetic/);

    const badUrl = editProposal(proposal, (draft) => {
      draft.items[0].productUrl = "https://example.com/tablet";
    });
    expect(() => validateProposedOrder(mandate, badUrl, evidence)).toThrow(/allowlisted/);
  });

  it("rejects tampered trusted capture and publisher metadata", () => {
    const { mandate, proposal, evidence } = setup();
    const badHash = structuredClone(evidence);
    badHash[0].evidence.contentHash = "0".repeat(64);
    expect(() => validateProposedOrder(mandate, proposal, badHash)).toThrow(/hash mismatch/);

    const badPublisher: EvidenceRecord[] = structuredClone(evidence);
    badPublisher[0].evidence.source.publisherId = "actor-claimed-publisher";
    expect(() => validateProposedOrder(mandate, proposal, badPublisher)).toThrow(/Publisher mismatch/);
  });

  it("rejects item evidence bound to a different product", () => {
    const { mandate, proposal, evidence } = setup();
    const badOwner = structuredClone(evidence);
    badOwner[0].evidence.itemId = proposal.items[1].id;

    expect(() => validateProposedOrder(mandate, proposal, badOwner)).toThrow(/belongs to another item/);
  });

  it("rejects a proposal attached to another mandate", () => {
    const { mandate, proposal, evidence } = setup();
    const otherMandate = { ...mandate, id: "77777777-7777-4777-8777-777777777777" };
    expect(() => validateProposedOrder(otherMandate, proposal, evidence)).toThrow(/mandateId/);
  });
});
