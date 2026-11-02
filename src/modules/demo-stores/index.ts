export {
  LOCAL_STORE_ORIGIN,
  STORE_PAGES,
  STORE_REGISTRY,
  StoreAllowlistError,
  canonicalizeStoreUrl,
  getStorePageByPath,
  getStorePageByUrl,
  getStoreRegistration,
  isAllowlistedProductUrl,
  listCatalog,
} from "./registry";
export { extractBodyHtml, extractVisibleText } from "./html";
export type {
  CatalogEntry,
  StorePageDefinition,
  StorePageKind,
  StoreRegistration,
  StoreSourceClass,
} from "./types";
