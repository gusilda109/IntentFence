import { STORE_PAGE_HTML, type StorePageContentKey } from "./content";
import type { CatalogEntry, StorePageDefinition, StoreRegistration } from "./types";

export const LOCAL_STORE_ORIGIN = "http://localhost:3000";

export const STORE_REGISTRY: readonly StoreRegistration[] = Object.freeze([
  Object.freeze({
    storeId: "tablet-hub",
    name: "Tablet Hub",
    publisherId: "publisher-tablet-hub",
    ownershipGroup: "tablet-hub-retail",
    sourceClass: "seller",
    baseUrl: `${LOCAL_STORE_ORIGIN}/stores/tablet-hub`,
  }),
  Object.freeze({
    storeId: "pos-supply",
    name: "POS Supply",
    publisherId: "publisher-pos-supply",
    ownershipGroup: "pos-supply-retail",
    sourceClass: "seller",
    baseUrl: `${LOCAL_STORE_ORIGIN}/stores/pos-supply`,
  }),
  Object.freeze({
    storeId: "maker-docs",
    name: "Maker Docs",
    publisherId: "publisher-maker-docs",
    ownershipGroup: "maker-docs-publication",
    sourceClass: "manufacturer",
    baseUrl: `${LOCAL_STORE_ORIGIN}/stores/maker-docs`,
  }),
  Object.freeze({
    storeId: "checkout-bundles",
    name: "Checkout Bundles",
    publisherId: "publisher-checkout-bundles",
    ownershipGroup: "checkout-bundles-retail",
    sourceClass: "seller",
    baseUrl: `${LOCAL_STORE_ORIGIN}/stores/checkout-bundles`,
  }),
]);

const page = (
  storeId: string,
  slug: string,
  title: string,
  kind: StorePageDefinition["kind"],
  demoLabel?: string,
): StorePageDefinition => {
  const key = `${storeId}/${slug}` as StorePageContentKey;
  const rawHtml = STORE_PAGE_HTML[key];
  if (!rawHtml) throw new Error(`Missing HTML fixture for ${key}`);
  const registration = STORE_REGISTRY.find((entry) => entry.storeId === storeId);
  if (!registration) throw new Error(`Missing store registration for ${storeId}`);

  return Object.freeze({
    captureId: `capture-${storeId}-${slug.replaceAll("/", "-")}`,
    storeId,
    slug,
    title,
    kind,
    demoLabel,
    url: `${registration.baseUrl}/${slug}`,
    rawHtml,
  });
};

export const STORE_PAGES: readonly StorePageDefinition[] = Object.freeze([
  page("tablet-hub", "catalog", "Tablet Hub catalog", "catalog"),
  page("tablet-hub", "products/hubtab-s10", "HubTab S10", "product"),
  page("tablet-hub", "specs/hubtab-s10", "HubTab S10 specifications", "document"),
  page("pos-supply", "catalog", "POS Supply catalog", "catalog"),
  page("pos-supply", "products/rp-80-printer", "RP-80 Thermal Receipt Printer", "product"),
  page("pos-supply", "products/rp-90-serial-printer", "RP-90 Serial Receipt Printer", "product"),
  page("pos-supply", "products/linkbridge-usbc-adapter", "LinkBridge USB-C Receipt Adapter", "product"),
  page("maker-docs", "catalog", "Maker Docs index", "catalog"),
  page("maker-docs", "compatibility/hubtab-s10-rp-80", "HubTab S10 + RP-80 compatibility", "document"),
  page("maker-docs", "compatibility/hubtab-s10-rp-90", "HubTab S10 + RP-90 incompatibility", "document"),
  page("maker-docs", "compatibility/linkbridge-adapter", "LinkBridge interface requirements", "document"),
  page("checkout-bundles", "catalog", "Checkout Bundles catalog", "catalog"),
  page("checkout-bundles", "bundles/counter-start", "Counter Start Bundle", "product"),
  page(
    "checkout-bundles",
    "products/calibration-license",
    "Calibration License — infected demo fixture",
    "product",
    "INFECTED DEMO FIXTURE — hidden agent-directed instructions",
  ),
]);

const pagesByUrl = new Map(STORE_PAGES.map((entry) => [entry.url, entry]));

export class StoreAllowlistError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StoreAllowlistError";
  }
}

export function getStoreRegistration(storeId: string): StoreRegistration {
  const registration = STORE_REGISTRY.find((entry) => entry.storeId === storeId);
  if (!registration) throw new StoreAllowlistError(`Unknown store: ${storeId}`);
  return registration;
}

export function canonicalizeStoreUrl(input: string): string {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new StoreAllowlistError("Store URL is invalid");
  }

  if (parsed.protocol !== "http:" || parsed.hostname !== "localhost" || parsed.port !== "3000") {
    throw new StoreAllowlistError("Store URL is outside the local allowlist");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new StoreAllowlistError("Store URL contains disallowed components");
  }

  const normalizedPath = parsed.pathname.replace(/\/+$/, "");
  const candidate = `${LOCAL_STORE_ORIGIN}${normalizedPath}`;
  const trusted = pagesByUrl.get(candidate);
  if (!trusted) throw new StoreAllowlistError(`URL is not a registered demo page: ${input}`);
  return trusted.url;
}

export function getStorePageByUrl(input: string): StorePageDefinition {
  return pagesByUrl.get(canonicalizeStoreUrl(input)) as StorePageDefinition;
}

export function getStorePageByPath(storeId: string, slug: readonly string[]): StorePageDefinition | undefined {
  const registration = getStoreRegistration(storeId);
  const normalizedSlug = slug.join("/").replace(/^\/+|\/+$/g, "");
  return STORE_PAGES.find((entry) => entry.url === `${registration.baseUrl}/${normalizedSlug}`);
}

export function listCatalog(storeId?: string): CatalogEntry[] {
  if (storeId) getStoreRegistration(storeId);
  return STORE_PAGES
    .filter((entry) => !storeId || entry.storeId === storeId)
    .map((entry) => {
      const registration = getStoreRegistration(entry.storeId);
      return {
        storeId: entry.storeId,
        storeName: registration.name,
        publisherId: registration.publisherId,
        sourceClass: registration.sourceClass,
        title: entry.title,
        url: entry.url,
        kind: entry.kind,
        ...(entry.demoLabel ? { demoLabel: entry.demoLabel } : {}),
      };
    });
}

export function isAllowlistedProductUrl(storeId: string, input: string): boolean {
  try {
    const entry = getStorePageByUrl(input);
    return entry.storeId === storeId && entry.kind === "product";
  } catch {
    return false;
  }
}
