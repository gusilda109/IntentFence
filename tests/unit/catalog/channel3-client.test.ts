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

  it("requests 20 results and parses present, null, and missing categories", async () => {
    const categorized = { ...product, category: { slug: "tablets" } };
    const uncategorized = { ...product, id: "product-2", category: null };
    const withoutCategory = { ...product, id: "product-3" };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      products: [categorized, uncategorized, withoutCategory],
      next_page_token: null,
    }));
    const client = new Channel3Client({ apiKey: "key", fetch: fetchMock, maxRetries: 0 });

    const results = await client.search("tablet", 80_000);

    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({ limit: 20 });
    expect(results.map((result) => result.category)).toEqual([{ slug: "tablets" }, null, undefined]);
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

  it("prefers the cleaned variant of the main product image", () => {
    const mapped = normalizeProduct({
      ...product,
      images: [
        { url: "https://cdn.example/first.jpg", is_main_image: false },
        {
          url: "https://cdn.example/main.jpg",
          cleaned_url: "https://cdn.example/main-cleaned.webp",
          is_main_image: true,
          shot_type: "hero",
          alt_text: "A black tablet",
        },
      ],
    });

    expect(mapped?.imageUrl).toBe("https://cdn.example/main-cleaned.webp");
  });

  it("falls back to the main image URL or the first available image", () => {
    expect(normalizeProduct({
      ...product,
      images: [{ url: "https://cdn.example/main.jpg", is_main_image: true }],
    })?.imageUrl).toBe("https://cdn.example/main.jpg");
    expect(normalizeProduct({
      ...product,
      images: [{ url: "https://cdn.example/first.jpg" }],
    })?.imageUrl).toBe("https://cdn.example/first.jpg");
  });

  it("omits missing or unsafe images and rejects an unsafe cleaned variant", () => {
    expect(normalizeProduct(product)?.imageUrl).toBeUndefined();
    expect(normalizeProduct({
      ...product,
      images: [{ url: "http://cdn.example/main.jpg", cleaned_url: "javascript:alert(1)" }],
    })?.imageUrl).toBeUndefined();
    expect(normalizeProduct({
      ...product,
      images: [{
        url: "https://cdn.example/main.jpg",
        cleaned_url: "https://user:password@cdn.example/cleaned.jpg",
      }],
    })?.imageUrl).toBe("https://cdn.example/main.jpg");
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
