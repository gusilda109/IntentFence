import { describe, expect, it } from "vitest";
import type { ProposedOrderItem } from "@/shared/contracts";
import type { CatalogCandidate } from "@/modules/catalog/types";
import { attachCatalogImages } from "@/modules/actor/catalog-images";
import { createCoffeeReplay } from "@/modules/actor/replay";
import { coffeeMandate } from "../../fixtures/stores/mandates";

function candidateFor(item: ProposedOrderItem, imageUrl: string): CatalogCandidate {
  return {
    capture: {} as CatalogCandidate["capture"],
    title: item.name,
    kind: "product",
    product: {
      productId: `product-${item.id}`,
      title: item.name,
      description: item.description,
      productUrl: item.productUrl,
      merchant: "merchant.example",
      amountMinor: item.unitPrice.amountMinor,
      availability: "InStock",
      imageUrl,
      attributes: {},
      selectedVariant: [],
    },
  };
}

describe("trusted catalog images", () => {
  it("uses only server-discovered images and strips model-supplied URLs", () => {
    const proposal = createCoffeeReplay(coffeeMandate()).proposal;
    const trustedUrl = "https://cdn.trychannel3.com/product-image";
    const tampered = {
      ...proposal,
      items: proposal.items.map((item, index) => ({
        ...item,
        imageUrl: `https://untrusted.example/${index}.jpg`,
      })),
    };

    const attached = attachCatalogImages(tampered, [candidateFor(proposal.items[0], trustedUrl)]);

    expect(attached.items[0].imageUrl).toBe(trustedUrl);
    expect(attached.items.slice(1).every((item) => item.imageUrl === undefined)).toBe(true);
    expect(proposal.items.every((item) => item.imageUrl === undefined)).toBe(true);
  });
});
