import "dotenv/config";
import { describe, expect, it, vi } from "vitest";
import { Channel3Client, Channel3Error } from "@/modules/catalog/channel3-client";
import { normalizeProduct } from "@/modules/catalog/channel3";

vi.mock("server-only", () => ({}));

describe.skipIf(process.env.CHANNEL3_LIVE_SMOKE !== "1")("Channel3 live smoke", () => {
  it("searches and hydrates a real product without creating an order", async () => {
    const client = new Channel3Client();
    const results = await client.search("wireless mouse", 10_000);
    expect(results.length).toBeGreaterThan(0);

    let selected: ReturnType<typeof normalizeProduct> = null;
    for (const result of results.slice(0, 4)) {
      try {
        selected = normalizeProduct(await client.getProduct(result.id));
      } catch (error) {
        if (!(error instanceof Channel3Error && error.code === "CHANNEL3_NOT_FOUND")) throw error;
      }
      if (selected) break;
    }

    expect(selected).not.toBeNull();
    console.info("Channel3 live smoke result:", JSON.stringify({
      searchResults: results.length,
      title: selected?.title,
      merchant: selected?.merchant,
      priceUsd: selected ? (selected.amountMinor / 100).toFixed(2) : null,
      availability: selected?.availability,
    }));
  }, 60_000);
});
