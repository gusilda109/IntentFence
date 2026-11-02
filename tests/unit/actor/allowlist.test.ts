import { describe, expect, it } from "vitest";
import {
  STORE_PAGES,
  STORE_REGISTRY,
  canonicalizeStoreUrl,
  getStorePageByPath,
  getStorePageByUrl,
  isAllowlistedProductUrl,
} from "@/modules/demo-stores";

 describe("local store allowlist", () => {
  it("registers four distinct sources and opens every local fixture", () => {
    expect(STORE_REGISTRY.map((store) => store.name)).toEqual([
      "Tablet Hub",
      "POS Supply",
      "Maker Docs",
      "Checkout Bundles",
    ]);
    expect(new Set(STORE_REGISTRY.map((store) => store.publisherId)).size).toBe(4);

    for (const page of STORE_PAGES) {
      expect(getStorePageByUrl(page.url).rawHtml).toContain("<!doctype html>");
      expect(getStorePageByPath(page.storeId, page.slug.split("/"))?.captureId).toBe(page.captureId);
    }
  });

  it("canonicalizes only an exact registered local URL", () => {
    const url = "http://localhost:3000/stores/tablet-hub/catalog";
    expect(canonicalizeStoreUrl(`${url}/`)).toBe(url);
    expect(() => canonicalizeStoreUrl(`${url}?next=evil`)).toThrow(/disallowed/);
    expect(() => canonicalizeStoreUrl("https://example.com/stores/tablet-hub/catalog")).toThrow(/outside/);
    expect(() => canonicalizeStoreUrl("http://localhost:3000/stores/tablet-hub/unknown")).toThrow(/registered/);
  });

  it("requires item URLs to be product pages in the stated store", () => {
    expect(isAllowlistedProductUrl(
      "tablet-hub",
      "http://localhost:3000/stores/tablet-hub/products/hubtab-s10",
    )).toBe(true);
    expect(isAllowlistedProductUrl(
      "pos-supply",
      "http://localhost:3000/stores/tablet-hub/products/hubtab-s10",
    )).toBe(false);
    expect(isAllowlistedProductUrl(
      "tablet-hub",
      "http://localhost:3000/stores/tablet-hub/specs/hubtab-s10",
    )).toBe(false);
  });
});
