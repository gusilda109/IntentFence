import { randomUUID } from "node:crypto";
import type { Mandate, ProposedOrder } from "@/shared/contracts";
import type { CatalogProvider } from "@/modules/catalog/types";
import type { ActorEvidenceSession } from "./session";
import { attachCatalogImages } from "./catalog-images";
import { fixtureCatalogListing, validateProposedOrder } from "./validation";

export async function runDeterministicChannel3Actor(
  mandate: Mandate,
  session: ActorEvidenceSession,
  provider: CatalogProvider,
): Promise<ProposedOrder> {
  const candidates = await provider.discover(mandate);
  const items = [];
  const evidenceIds: string[] = [];
  let totalMinor = 0;

  for (const candidate of candidates) {
    const product = candidate.product;
    if (!product || totalMinor + product.amountMinor > mandate.budget.amountMinor) continue;
    const capture = session.registerCandidate(candidate);
    const itemId = randomUUID();
    const excerpt = capture.visibleText.split("\n").slice(0, 2).join("\n");
    const record = session.acquire(mandate.id, {
      itemId,
      url: capture.url,
      locator: "Channel3 Product Detail: title and selected merchant offer",
      excerpt,
      claims: [
        { kind: "necessity", text: "This product was returned as a candidate for the active purchase goal; necessity remains subject to policy review." },
        { kind: "price", text: `Selected in-stock merchant offer: USD ${(product.amountMinor / 100).toFixed(2)}.` },
        { kind: "feature", text: "Product and merchant attributes are untrusted aggregated data, not manufacturer confirmation." },
      ],
    });
    evidenceIds.push(record.evidence.id);
    items.push({
      id: itemId,
      storeId: capture.storeId,
      productUrl: capture.url,
      name: product.title.slice(0, 120),
      description: (product.description || "Channel3 aggregated product candidate.").slice(0, 1_000),
      quantity: 1,
      unitPrice: { currency: "USD" as const, amountMinor: product.amountMinor },
      purpose: `Channel3 candidate for the mandate: ${mandate.goal}`.slice(0, 1_000),
      necessityEvidenceIds: [record.evidence.id],
      compatibility: [],
    });
    totalMinor += product.amountMinor;
  }

  if (items.length === 0) throw new Error("CHANNEL3_NO_OFFERS");
  const proposal = validateProposedOrder(mandate, {
    schemaVersion: "1",
    id: randomUUID(),
    mandateId: mandate.id,
    items,
    evidenceIds,
    total: { currency: "USD", amountMinor: totalMinor },
    assumptions: [
      "Channel3 is an aggregator; its product and merchant claims are not independent manufacturer evidence.",
      "Only the selected in-stock USD offer is used; commission and monetization fields are ignored.",
    ],
    createdAt: new Date().toISOString(),
  }, session.list(mandate.id), {
    getCapture: (url) => session.getCapture(url),
    isAllowedProductUrl: (storeId, url) => session.isRegisteredProductUrl(storeId, url),
    getCatalogListing: (storeId, url) => session.getCatalogListing(storeId, url)
      ?? fixtureCatalogListing(storeId, url),
  });
  await provider.validateSelection(proposal);
  return attachCatalogImages(proposal, candidates);
}
