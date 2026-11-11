import { describe, expect, it, vi } from "vitest";
import { createActor } from "@/modules/actor";
import { Channel3CatalogProvider } from "@/modules/catalog/channel3";
import type { Channel3Client, Channel3Product } from "@/modules/catalog/channel3-client";
import { createSupervisor } from "@/modules/supervisor";
import { buildApprovedOrder } from "@/modules/orchestration/approval-builder";
import { DeterministicPaymentExecutor } from "@/modules/payment/executor";
import type { PayPalClient } from "@/modules/payment/types";
import { coffeeMandate } from "../../fixtures/stores/mandates";
import { InMemoryPaymentExecutionStore } from "../../unit/payment/test-helpers";

vi.mock("server-only", () => ({}));

function product(overrides: Partial<Channel3Product> = {}): Channel3Product {
  return {
    id: "tablet-live-1",
    title: "Point of sale tablet",
    description: "A tablet for taking orders and processing checkout",
    structured_attributes: { connectivity: ["USB-C"] },
    offers: [{
      url: "https://merchant.example/tablet",
      domain: "merchant.example",
      price: { price: 300, currency: "USD" },
      availability: "InStock",
    }],
    ...overrides,
  };
}

function providerFor(detail: Channel3Product) {
  const client = {
    search: vi.fn().mockResolvedValue([{ id: detail.id, title: detail.title }]),
    getProduct: vi.fn().mockResolvedValue(detail),
  } as unknown as Channel3Client;
  return { client, provider: new Channel3CatalogProvider(client) };
}

describe("mocked Channel3 end-to-end run", () => {
  it("uses Channel3 evidence through approval and idempotent PayPal order creation without exposing credentials", async () => {
    // Direct-request status is matched against the Channel3 title, so the goal
    // must name the product in the same language as the catalog.
    const mandate = { ...coffeeMandate(), goal: "Set up coffee shop checkout on a point of sale tablet" };
    const { client, provider } = providerFor(product());
    const actor = createActor({ mode: "replay", catalogSource: "channel3", catalogProvider: provider });
    const proposal = await actor.propose(mandate);
    const evidence = await actor.getEvidence(mandate.id);
    const verdict = await createSupervisor({ mode: "replay" }).evaluateWithEvidence(mandate, proposal, evidence);

    expect(proposal.items[0].productUrl).toBe("https://merchant.example/tablet");
    expect(evidence.every((record) => record.evidence.source.sourceClass === "aggregator")).toBe(true);
    expect(verdict.decision).toBe("ALLOW");
    expect(client.getProduct).toHaveBeenCalledTimes(2);

    const approval = buildApprovedOrder(mandate, proposal, verdict);
    const createOrder = vi.fn().mockResolvedValue({ id: "CHANNEL3-MOCK-ORDER", status: "CREATED" });
    const paypalClient: PayPalClient = { createOrder };
    const store = new InMemoryPaymentExecutionStore({
      status: "APPROVED",
      mandateJson: mandate,
      verdictJson: verdict,
      approvedOrderJson: approval,
      approvalHash: approval.approvalHash,
    });
    const executor = new DeterministicPaymentExecutor({ store, paypalClient });

    const first = await executor.execute(approval);
    const second = await executor.execute(approval);
    expect(first.status).toBe("PAYPAL_CREATED");
    expect(second).toEqual(first);
    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(JSON.stringify({ proposal, evidence, verdict, approval })).not.toContain("server-secret");
    expect(JSON.stringify({ proposal, evidence, verdict, approval })).not.toContain("max_commission_rate");
  });

  it("requires review for an aggregator-only optional add-on with zero PayPal calls", async () => {
    const mandate = { ...coffeeMandate(), goal: "Buy a point of sale tablet" };
    const { provider } = providerFor(product({
      id: "warranty-1",
      title: "Extended warranty",
      description: "Optional merchant protection plan",
      offers: [{
        url: "https://merchant.example/warranty",
        domain: "merchant.example",
        price: { price: 99, currency: "USD" },
        availability: "InStock",
      }],
    }));
    const actor = createActor({ mode: "replay", catalogSource: "channel3", catalogProvider: provider });
    const proposal = await actor.propose(mandate);
    const evidence = await actor.getEvidence(mandate.id);
    const verdict = await createSupervisor({ mode: "replay" }).evaluateWithEvidence(mandate, proposal, evidence);
    const createOrder = vi.fn();

    expect(verdict.decision).toBe("REVIEW");
    expect(verdict.findings.map((finding) => finding.code)).toContain("INSUFFICIENT_NECESSITY");
    expect(verdict.itemDecisions).toHaveLength(1);
    expect(createOrder).not.toHaveBeenCalled();
  });

  it("does not treat an add-on as requested because its purpose repeats a long goal", async () => {
    // The deterministic Channel3 Actor copies the whole goal into `purpose`.
    // That text must not make an unrelated catalog title count as requested.
    const mandate = {
      ...coffeeMandate(),
      goal: "Buy a point of sale tablet for the cafe counter checkout and protect it",
    };
    const { provider } = providerFor(product({
      id: "warranty-2",
      title: "Extended warranty",
      description: "Optional merchant protection plan",
      offers: [{
        url: "https://merchant.example/warranty-2",
        domain: "merchant.example",
        price: { price: 99, currency: "USD" },
        availability: "InStock",
      }],
    }));
    const actor = createActor({ mode: "replay", catalogSource: "channel3", catalogProvider: provider });
    const proposal = await actor.propose(mandate);
    const evidence = await actor.getEvidence(mandate.id);
    const verdict = await createSupervisor({ mode: "replay" }).evaluateWithEvidence(mandate, proposal, evidence);

    expect(proposal.items[0].purpose).toContain(mandate.goal);
    expect(proposal.items[0].catalogListing).toMatchObject({ source: "channel3", title: "Extended warranty" });
    expect(verdict.decision).toBe("REVIEW");
  });
});
