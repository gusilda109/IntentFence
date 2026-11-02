import type { CatalogSource, Mandate, ProposedOrder } from "@/shared/contracts";
import type { TrustedCapture } from "@/modules/actor/evidence";

export interface CatalogProductSnapshot {
  productId: string;
  title: string;
  description: string;
  productUrl: string;
  merchant: string;
  amountMinor: number;
  availability: "InStock";
  attributes: Record<string, string[]>;
  selectedVariant: Array<{ name: string; label: string }>;
}

export interface CatalogCandidate {
  capture: TrustedCapture;
  title: string;
  kind: "catalog" | "product" | "document";
  product?: CatalogProductSnapshot;
}

export interface CatalogProvider {
  readonly source: CatalogSource;
  discover(mandate: Mandate): Promise<CatalogCandidate[]>;
  validateSelection(proposal: ProposedOrder): Promise<void>;
}
