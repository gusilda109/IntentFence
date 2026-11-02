import { describe, expect, it, vi } from "vitest";
import { Channel3Client, Channel3Error } from "@/modules/catalog/channel3-client";
import { normalizeProduct, toMinorUnits } from "@/modules/catalog/channel3";
import { coffeeMandate } from "../../fixtures/stores/mandates";

vi.mock("server-only", () => ({}));

const product = {
  id: "product-1",
  title: "Test tablet",
  description: "A tablet for a point of sale",
  brands: [{ id: "brand-1", name: "Test brand" }],
  structured_attributes: { color: ["black"], connectivity: ["USB-C"] },
  variants: {
    options: [{ name: "Size", values: [{ label: '10"', exists: true, available: "InStock" as const }] }],
    selected: [{ name: "Size", label: '10"' }],
  },
  offers: [{
    url: "https://merchant.example/tablet",
    domain: "merchant.example",
    price: { price: 129.99, currency: "USD" },
    availability: "InStock" as const,
    max_commission_rate: 0.9,
  }],
};

function jsonResponse(body: unknown, status = 200, headers?: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

describe("Channel3 client contracts", () => {
  it("uses only documented HTTPS Search and Product Detail endpoints with a server API key", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ products: [product], next_page_token: null }))
      .mockResolvedValueOnce(jsonResponse(product));
    const client = new Channel3Client({ apiKey: "server-secret", fetch: fetchMock, maxRetries: 0 });

    await client.search("point of sale tablet", 80_000);
    await client.getProduct("product-1");

    const searchUrl = new URL(String(fetchMock.mock.calls[0][0]));
    expect(searchUrl.origin).toBe("https://api.trychannel3.com");
    expect(searchUrl.pathname).toBe("/v1/search");
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ "x-api-key": "server-secret" });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      query: "point of sale tablet",
      config: { country: "US", currency: "USD", mode: "agentic" },
      filters: { availability: ["InStock"], price: { max_price: 800 } },
    });
    expect(String(fetchMock.mock.calls[1][0])).toContain("/v1/products/product-1?");
    expect(String(fetchMock.mock.calls[1][0])).toContain("currency=USD");
  });

  it("rejects missing configuration without making a request", () => {
    const fetchMock = vi.fn<typeof fetch>();
    expect(() => new Channel3Client({ apiKey: "", fetch: fetchMock })).toThrowError(Channel3Error);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("handles empty search and malformed responses safely", async () => {
    const empty = new Channel3Client({ apiKey: "key", fetch: vi.fn().mockResolvedValue(jsonResponse({ products: [] })), maxRetries: 0 });
    await expect(empty.search("nothing", 10_000)).rejects.toMatchObject({ code: "CHANNEL3_EMPTY" });

    const malformed = new Channel3Client({ apiKey: "key", fetch: vi.fn().mockResolvedValue(jsonResponse({ products: [{ unexpected: true }] })), maxRetries: 0 });
    await expect(malformed.search("bad", 10_000)).rejects.toMatchObject({ code: "CHANNEL3_INVALID_RESPONSE" });
  });

  it("retries rate limits a bounded number of times", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ detail: "limited" }, 429, { "retry-after": "0" }));
    const client = new Channel3Client({ apiKey: "key", fetch: fetchMock, maxRetries: 1, retryDelayMs: 0 });
    await expect(client.search("tablet", 10_000)).rejects.toMatchObject({ code: "CHANNEL3_RATE_LIMITED" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("maps an aborted request to a timeout", async () => {
    const fetchMock = vi.fn<typeof fetch>((_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    const client = new Channel3Client({ apiKey: "key", fetch: fetchMock, timeoutMs: 5, maxRetries: 0 });
    await expect(client.search("tablet", 10_000)).rejects.toMatchObject({ code: "CHANNEL3_TIMEOUT" });
  });
});

describe("Channel3 product mapping", () => {
  it("maps price, selected offer, availability, attributes, and variants without commission influence", () => {
    const mapped = normalizeProduct(product);
    expect(mapped).toMatchObject({
      amountMinor: 12_999,
      merchant: "merchant.example",
      availability: "InStock",
      selectedVariant: [{ name: "Size", label: '10"' }],
      attributes: { connectivity: ["USB-C"] },
    });
    expect(JSON.stringify(mapped)).not.toContain("commission");
    const zeroCommissionProduct = {
      ...product,
      offers: [{ ...product.offers[0], max_commission_rate: 0 }],
    };
    expect(normalizeProduct(zeroCommissionProduct)).toEqual(mapped);
    expect(toMinorUnits(10.001)).toBeNull();
  });

  it("rejects an unavailable selected variant even when a generic offer is in stock", () => {
    expect(normalizeProduct({
      ...product,
      variants: {
        ...product.variants,
        options: [{ name: "Size", values: [{ label: '10"', exists: true, available: "OutOfStock" as const }] }],
      },
    })).toBeNull();
  });

  it("excludes unavailable, non-USD, invalid-price, and non-HTTPS offers", () => {
    const mapped = normalizeProduct({
      ...product,
      offers: [
        { ...product.offers[0], availability: "OutOfStock" },
        { ...product.offers[0], price: { price: 10, currency: "EUR" } },
        { ...product.offers[0], price: { price: 10.001, currency: "USD" } },
        { ...product.offers[0], url: "http://merchant.example/tablet" },
      ],
    });
    expect(mapped).toBeNull();
  });

  it("does not use the local fixture catalog", async () => {
    const client = new Channel3Client({ apiKey: "key", fetch: vi.fn().mockResolvedValue(jsonResponse({ products: [product] })), maxRetries: 0 });
    const results = await client.search(coffeeMandate().goal, 80_000);
    expect(results[0].id).toBe("product-1");
  });
});
