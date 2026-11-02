import { describe, expect, it, vi } from "vitest";
import { Channel3CatalogProvider } from "@/modules/catalog/channel3";
import type { Channel3Client, Channel3Product } from "@/modules/catalog/channel3-client";
import { coffeeMandate } from "../../fixtures/stores/mandates";

vi.mock("server-only", () => ({}));

const detail: Channel3Product = {
  id: "tablet-1",
  title: "Point of sale tablet",
  description: "A tablet for checkout workflows",
  structured_attributes: { connectivity: ["USB-C"] },
  variants: {
    options: [{ name: "Color", values: [{ label: "Black", exists: true, available: "InStock" }] }],
    selected: [{ name: "Color", label: "Black" }],
  },
  offers: [{
    url: "https://merchant.example/tablet",
    domain: "merchant.example",
    price: { price: 200, currency: "USD" },
    availability: "InStock",
  }],
};

function clientMock(getProduct: Channel3Product = detail) {
  return {
    search: vi.fn().mockResolvedValue([{ id: detail.id, title: detail.title }]),
    getProduct: vi.fn().mockResolvedValue(getProduct),
  } as unknown as Channel3Client;
}

describe("Channel3CatalogProvider", () => {
  it("hydrates search hits and stores only bounded aggregator snapshots", async () => {
    const client = clientMock();
    const provider = new Channel3CatalogProvider(client);
    const candidates = await provider.discover(coffeeMandate());

    expect(client.search).toHaveBeenCalledOnce();
    expect(client.getProduct).toHaveBeenCalledWith("tablet-1");
    expect(candidates).toHaveLength(1);
    expect(candidates[0].capture.sourceClass).toBe("aggregator");
    expect(candidates[0].capture.publisherId).toBe("channel3-aggregator");
    expect(candidates[0].capture.visibleText).toContain("InStock");
    expect(candidates[0].capture.rawHtml).not.toContain("max_commission_rate");
    expect(candidates[0].capture.rawHtml.length).toBeLessThan(10_000);
  });

  it("rejects a product whose price or availability changes before approval", async () => {
    const client = clientMock();
    const provider = new Channel3CatalogProvider(client);
    const [candidate] = await provider.discover(coffeeMandate());
    vi.mocked(client.getProduct).mockResolvedValue({
      ...detail,
      offers: [{ ...detail.offers![0], availability: "OutOfStock" }],
    });

    await expect(provider.validateSelection({
      schemaVersion: "1",
      id: crypto.randomUUID(),
      mandateId: coffeeMandate().id,
      items: [{
        id: crypto.randomUUID(),
        storeId: candidate.capture.storeId,
        productUrl: candidate.capture.url,
        name: candidate.title,
        description: "test",
        quantity: 1,
        unitPrice: { currency: "USD", amountMinor: 20_000 },
        purpose: "test",
        necessityEvidenceIds: [crypto.randomUUID()],
        compatibility: [],
      }],
      evidenceIds: [crypto.randomUUID()],
      total: { currency: "USD", amountMinor: 20_000 },
      assumptions: [],
      createdAt: new Date().toISOString(),
    })).rejects.toMatchObject({ code: "CHANNEL3_PRODUCT_CHANGED" });
  });

  it("ignores a rotated Channel3 tracking ID but not a changed offer", async () => {
    const channel3Detail = {
      ...detail,
      offers: [{
        ...detail.offers![0],
        url: "https://buy.trychannel3.com/tablet-1?o=offer-1&aid=first",
      }],
    };
    const client = clientMock(channel3Detail);
    const provider = new Channel3CatalogProvider(client);
    const [candidate] = await provider.discover(coffeeMandate());
    const proposal = {
      schemaVersion: "1" as const,
      id: crypto.randomUUID(),
      mandateId: coffeeMandate().id,
      items: [{
        id: crypto.randomUUID(),
        storeId: candidate.capture.storeId,
        productUrl: candidate.capture.url,
        name: candidate.title,
        description: "test",
        quantity: 1,
        unitPrice: { currency: "USD" as const, amountMinor: 20_000 },
        purpose: "test",
        necessityEvidenceIds: [crypto.randomUUID()],
        compatibility: [],
      }],
      evidenceIds: [crypto.randomUUID()],
      total: { currency: "USD" as const, amountMinor: 20_000 },
      assumptions: [],
      createdAt: new Date().toISOString(),
    };

    vi.mocked(client.getProduct).mockResolvedValue({
      ...channel3Detail,
      offers: [{
        ...channel3Detail.offers[0],
        url: "https://buy.trychannel3.com/tablet-1?o=offer-1&aid=second",
      }],
    });
    await expect(provider.validateSelection(proposal)).resolves.toBeUndefined();

    vi.mocked(client.getProduct).mockResolvedValue({
      ...channel3Detail,
      offers: [{
        ...channel3Detail.offers[0],
        url: "https://buy.trychannel3.com/tablet-1?o=offer-2&aid=third",
      }],
    });
    await expect(provider.validateSelection(proposal)).rejects.toMatchObject({ code: "CHANNEL3_PRODUCT_CHANGED" });
  });
});
