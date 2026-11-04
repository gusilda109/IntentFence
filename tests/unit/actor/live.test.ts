import { beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  run: vi.fn(),
  agentOptions: [] as Array<Record<string, unknown>>,
}));

vi.mock("@openai/agents", () => ({
  Agent: class {
    constructor(options: Record<string, unknown>) {
      sdk.agentOptions.push(options);
    }
  },
  run: sdk.run,
  tool: (options: unknown) => options,
}));

import { runLiveActor } from "@/modules/actor/live";
import { ActorEvidenceSession } from "@/modules/actor/session";
import { createCoffeeReplay } from "@/modules/actor/replay";
import { coffeeMandate } from "../../fixtures/stores/mandates";

describe("live Actor provider compatibility", () => {
  beforeEach(() => {
    sdk.run.mockReset();
    sdk.agentOptions.length = 0;
  });

  it("uses one structured snapshot call and materializes trusted evidence locally", async () => {
    const mandate = coffeeMandate();
    const replay = createCoffeeReplay(mandate);
    const session = new ActorEvidenceSession();
    const evidenceById = new Map(replay.evidence.map((record) => [record.evidence.id, record.evidence]));
    const draftEvidence = (id: string) => {
      const evidence = evidenceById.get(id)!;
      return {
        url: evidence.source.url,
        locator: evidence.locator,
        excerpt: evidence.excerpt,
        claims: evidence.claims,
      };
    };
    const draft = {
      ...replay.proposal,
      items: replay.proposal.items.map((item) => {
        const { necessityEvidenceIds, compatibility, ...base } = item;
        return {
          ...base,
          necessityEvidence: necessityEvidenceIds.map(draftEvidence),
          compatibility: compatibility.map((entry) => ({
            withItemId: entry.withItemId,
            requirement: entry.requirement,
            evidence: entry.evidenceIds.map(draftEvidence),
          })),
        };
      }),
    };
    delete (draft as { evidenceIds?: string[] }).evidenceIds;
    sdk.run.mockResolvedValue({ finalOutput: draft });

    const proposal = await runLiveActor(mandate, session, "test-model");

    expect(proposal.items).toHaveLength(4);
    expect(proposal.total).toEqual(replay.proposal.total);
    expect(proposal.evidenceIds).toHaveLength(6);
    const trustedEvidence = session.list(mandate.id);
    expect(trustedEvidence).toHaveLength(6);
    for (const item of proposal.items) {
      const references = [
        ...item.necessityEvidenceIds,
        ...item.compatibility.flatMap((entry) => entry.evidenceIds),
      ];
      for (const evidenceId of references) {
        expect(trustedEvidence.find((record) => record.evidence.id === evidenceId)?.evidence.itemId)
          .toBe(item.id);
      }
    }
    expect(sdk.agentOptions).toHaveLength(1);
    expect(sdk.agentOptions[0]).toHaveProperty("outputType");
    expect(sdk.agentOptions[0]?.tools).toEqual([]);
    expect(sdk.agentOptions[0]?.instructions).toContain("select one best-fit candidate per requested category");
    expect(sdk.agentOptions[0]?.instructions).toContain("never silently omit one category or drop it merely to fit the budget");
    expect(sdk.run).toHaveBeenCalledTimes(1);
  });
});
