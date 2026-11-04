import { describe, expect, it, vi } from "vitest";
import { Channel3CatalogProvider } from "@/modules/catalog/channel3";
import { Channel3Error, type Channel3Client, type Channel3Product } from "@/modules/catalog/channel3-client";
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

function searchHit(id: string, category?: { slug: string } | null): Channel3Product {
  return {
    id,
    title: `Product ${id}`,
    ...(category === undefined ? {} : { category }),
  };
}

function productDetail(id: string, productUrl = `https://merchant.example/${id}`): Channel3Product {
  return {
    ...detail,
    id,
    title: `Product ${id}`,
    offers: [{ ...detail.offers![0], url: productUrl }],
  };
}

function discoveryClient(
  hits: Channel3Product[],
  getProduct: (id: string) => Channel3Product | Promise<Channel3Product>,
): Channel3Client {
  return {
    search: vi.fn().mockResolvedValue(hits),
    getProduct: vi.fn().mockImplementation(getProduct),
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

  it("covers compound categories with deterministic round-robin ordering", async () => {
    const hits = [
      searchHit("tv-1", { slug: "tv" }),
      searchHit("tv-2", { slug: "tv" }),
      searchHit("sofa-1", { slug: "sofa" }),
      searchHit("tv-3", { slug: "tv" }),
      searchHit("sofa-2", { slug: "sofa" }),
    ];
    const client = discoveryClient(hits, (id) => productDetail(id));
    const candidates = await new Channel3CatalogProvider(client).discover(coffeeMandate());

    expect(candidates.map((candidate) => candidate.product?.productId)).toEqual([
      "tv-1", "sofa-1", "tv-2", "sofa-2", "tv-3",
    ]);
    expect(vi.mocked(client.getProduct).mock.calls.map(([id]) => id)).toEqual([
      "tv-1", "sofa-1", "tv-2", "sofa-2", "tv-3",
    ]);
  });

  it("backfills after missing details and products that normalize to null", async () => {
    const hits = [searchHit("gone"), searchHit("empty"), searchHit("valid")];
    const client = discoveryClient(hits, (id) => {
      if (id === "gone") return Promise.reject(new Channel3Error("CHANNEL3_NOT_FOUND"));
      if (id === "empty") return { ...productDetail(id), offers: [] };
      return productDetail(id);
    });
    const candidates = await new Channel3CatalogProvider(client).discover(coffeeMandate());

    expect(candidates.map((candidate) => candidate.product?.productId)).toEqual(["valid"]);
    expect(vi.mocked(client.getProduct).mock.calls.map(([id]) => id)).toEqual(["gone", "empty", "valid"]);
  });

  it("stops after 12 valid unique candidates", async () => {
    const hits = Array.from({ length: 14 }, (_, index) => searchHit(`product-${index + 1}`));
    const client = discoveryClient(hits, (id) => productDetail(id));
    const candidates = await new Channel3CatalogProvider(client).discover(coffeeMandate());

    expect(candidates).toHaveLength(12);
    expect(candidates.map((candidate) => candidate.product?.productId)).toEqual(
      hits.slice(0, 12).map((hit) => hit.id),
    );
    expect(client.getProduct).toHaveBeenCalledTimes(12);
    expect(client.getProduct).not.toHaveBeenCalledWith("product-13");
  });

  it("deduplicates IDs before detail and offer URLs after normalization", async () => {
    const hits = [
      searchHit("a"), searchHit("a"), searchHit("b"),
      searchHit("c"), searchHit("d"), searchHit("e"),
    ];
    const client = discoveryClient(hits, (id) => {
      if (id === "a" || id === "b") return productDetail(id, "https://merchant.example/shared");
      if (id === "c") return productDetail(id, "https://buy.trychannel3.com/checkout?o=offer-1&aid=first");
      if (id === "d") return productDetail(id, "https://buy.trychannel3.com/checkout?o=offer-1&aid=second");
      return productDetail(id);
    });
    const candidates = await new Channel3CatalogProvider(client).discover(coffeeMandate());

    expect(vi.mocked(client.getProduct).mock.calls.map(([id]) => id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(candidates.map((candidate) => candidate.product?.productId)).toEqual(["a", "c", "e"]);
  });

  it("uses missing and null categories as one fallback group", async () => {
    const hits = [
      searchHit("categorized-1", { slug: "categorized" }),
      searchHit("missing"),
      searchHit("null", null),
      searchHit("categorized-2", { slug: "categorized" }),
    ];
    const client = discoveryClient(hits, (id) => productDetail(id));
    const candidates = await new Channel3CatalogProvider(client).discover(coffeeMandate());

    expect(candidates.map((candidate) => candidate.product?.productId)).toEqual([
      "categorized-1", "missing", "categorized-2", "null",
    ]);
  });

  it("produces the same candidate order for identical search results", async () => {
    const hits = [
      searchHit("a-1", { slug: "a" }),
      searchHit("b-1", { slug: "b" }),
      searchHit("a-2", { slug: "a" }),
      searchHit("b-2", { slug: "b" }),
      searchHit("fallback"),
    ];
    const discover = async () => {
      const client = discoveryClient(hits, (id) => productDetail(id));
      const candidates = await new Channel3CatalogProvider(client).discover(coffeeMandate());
      return candidates.map((candidate) => candidate.product?.productId);
    };

    await expect(discover()).resolves.toEqual(["a-1", "b-1", "fallback", "a-2", "b-2"]);
    await expect(discover()).resolves.toEqual(["a-1", "b-1", "fallback", "a-2", "b-2"]);
  });
});
