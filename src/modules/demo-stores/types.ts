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

export interface StorePageDefinition {
  readonly captureId: string;
  readonly storeId: string;
  readonly slug: string;
  readonly url: string;
  readonly title: string;
  readonly kind: StorePageKind;
  readonly rawHtml: string;
  readonly demoLabel?: string;
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
