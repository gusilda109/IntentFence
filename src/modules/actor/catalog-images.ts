import type { ProposedOrder } from "@/shared/contracts";
import type { CatalogCandidate } from "@/modules/catalog/types";

/**
 * Attach server-discovered display metadata after validating the Actor draft.
 * Any image URL supplied by the model is discarded rather than trusted.
 */
export function attachCatalogImages(
  proposal: ProposedOrder,
  candidates: readonly CatalogCandidate[],
): ProposedOrder {
  const imageByProductUrl = new Map(
    candidates.flatMap((candidate) => candidate.product?.imageUrl
      ? [[candidate.product.productUrl, candidate.product.imageUrl] as const]
      : []),
  );

  return {
    ...proposal,
    items: proposal.items.map((item) => {
      const attached = { ...item };
      delete attached.imageUrl;
      const imageUrl = imageByProductUrl.get(item.productUrl);
      return imageUrl ? { ...attached, imageUrl } : attached;
    }),
  };
}
