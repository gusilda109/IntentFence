export {
  LOCAL_STORE_ORIGIN,
  STORE_PAGES,
  STORE_REGISTRY,
  StoreAllowlistError,
  canonicalizeStoreUrl,
  getStorePageByPath,
  getStorePageByUrl,
  getProductListing,
  getStoreRegistration,
  isAllowlistedProductUrl,
  listCatalog,
} from "./registry";
export { extractBodyHtml, extractVisibleText } from "./html";
export type {
  CatalogEntry,
  ProductListing,
  StorePageDefinition,
  StorePageKind,
  StoreRegistration,
  StoreSourceClass,
} from "./types";
