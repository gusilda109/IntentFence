import { describe, expect, it, vi } from "vitest";
import { createActor } from "@/modules/actor";
import { COFFEE_REPLAY_IDS, INCOMPATIBLE_PRINTER_REPLAY_IDS } from "@/modules/actor/replay";
import { coffeeMandate, unmatchedMandate } from "../../fixtures/stores/mandates";

vi.mock("server-only", () => ({}));

 describe("Actor integration surface", () => {
  it("returns four items and the full trusted evidence graph in coffee replay", async () => {
    const actor = createActor({ mode: "replay" });
    const mandate = coffeeMandate();
    const proposal = await actor.propose(mandate);
    const evidence = await actor.getEvidence(mandate.id);

    expect(proposal.items).toHaveLength(4);
    expect(proposal.items.map((item) => item.id)).toEqual([
      COFFEE_REPLAY_IDS.tablet,
      COFFEE_REPLAY_IDS.printer,
      COFFEE_REPLAY_IDS.adapter,
      COFFEE_REPLAY_IDS.sellerAddOn,
    ]);
    expect(evidence).toHaveLength(6);
    expect(evidence.map((record) => record.evidence.id)).toEqual(proposal.evidenceIds);
    expect(evidence.at(-1)?.security.status).toBe("QUARANTINED");
    expect(evidence.at(-1)?.evidence.source.publisherId).toBe("publisher-checkout-bundles");
  });

  it("loads the incompatible printer replay with manufacturer evidence", async () => {
    const actor = createActor({ mode: "replay" });
    const mandate = {
      ...coffeeMandate(),
      goal: "Set up receipt printing for my existing HubTab S10 tablet.",
      budget: { currency: "USD" as const, amountMinor: 25_000 },
    };

    const proposal = await actor.propose(mandate);
    const evidence = await actor.getEvidence(mandate.id);

    expect(proposal.items).toHaveLength(1);
    expect(proposal.items[0]).toMatchObject({
      id: INCOMPATIBLE_PRINTER_REPLAY_IDS.printer,
      name: "RP-90 Serial Receipt Printer",
      compatibility: [{
        withItemId: null,
        evidenceIds: [INCOMPATIBLE_PRINTER_REPLAY_IDS.incompatibilityEvidence],
      }],
    });
    expect(evidence).toHaveLength(2);
    expect(evidence[1].evidence.claims).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "incompatibility" }),
    ]));
    expect(evidence.every((record) => record.security.status === "CLEAN")).toBe(true);
  });

  it("is deterministic and isolates evidence by mandate", async () => {
    const actor = createActor({ mode: "replay" });
    const mandate = coffeeMandate();
    const first = await actor.propose(mandate);
    const firstEvidence = await actor.getEvidence(mandate.id);

    expect(await actor.propose(mandate)).toEqual(first);
    expect(await actor.getEvidence(mandate.id)).toEqual(firstEvidence);
    expect(await actor.getEvidence("77777777-7777-4777-8777-777777777777")).toEqual([]);
  });

  it("does not silently invent a replay for an unrelated open goal", async () => {
    const actor = createActor({ mode: "replay" });
    await expect(actor.propose(unmatchedMandate())).rejects.toThrow(/No saved replay/);
  });
});
