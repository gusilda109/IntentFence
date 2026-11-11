import type { Evidence } from "@/shared/contracts";

export type StoreSourceClass = Evidence["source"]["sourceClass"];
export type StorePageKind = "catalog" | "product" | "document";

export interface StoreRegistration {
  readonly storeId: string;
  readonly name: string;
  readonly publisherId: string;
  readonly ownershipGroup: string;
  readonly sourceClass: StoreSourceClass;
  readonly baseUrl: string;
}

/**
 * Trusted catalog facts for a purchasable product page, analogous to a
 * structured merchant feed. The category is a product-type label from the
 * catalog, not a policy allowlist: it is matched against the user's own goal
 * wording to decide whether the user directly asked for this kind of product.
 */
export interface ProductListing {
  readonly category: string;
  readonly priceMinor: number;
}

export interface StorePageDefinition {
  readonly captureId: string;
  readonly storeId: string;
  readonly slug: string;
  readonly url: string;
  readonly title: string;
  readonly kind: StorePageKind;
  readonly rawHtml: string;
  readonly demoLabel?: string;
  readonly listing?: ProductListing;
}

export interface CatalogEntry {
  readonly storeId: string;
  readonly storeName: string;
  readonly publisherId: string;
  readonly sourceClass: StoreSourceClass;
  readonly title: string;
  readonly url: string;
  readonly kind: StorePageKind;
  readonly demoLabel?: string;
}
