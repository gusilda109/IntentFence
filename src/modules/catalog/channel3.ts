import "server-only";
import { createHash } from "node:crypto";
import type { Mandate, ProposedOrder } from "@/shared/contracts";
import { hashRawContent, type TrustedCapture } from "@/modules/actor/evidence";
import { scanPageSecurity } from "@/modules/actor/security";
import { Channel3Client, Channel3Error, type Channel3Product } from "./channel3-client";
import type { CatalogCandidate, CatalogProductSnapshot, CatalogProvider } from "./types";

const PUBLISHER_ID = "channel3-aggregator";
const MAX_CANDIDATES = 4;

export class Channel3CatalogProvider implements CatalogProvider {
  readonly source = "channel3" as const;
  private readonly discovered = new Map<string, CatalogProductSnapshot>();

  constructor(private readonly client: Channel3Client = new Channel3Client()) {}

  async discover(mandate: Mandate): Promise<CatalogCandidate[]> {
    const searchResults = await this.client.search(mandate.goal, mandate.budget.amountMinor);
    const candidates: CatalogCandidate[] = [];

    for (const result of searchResults.slice(0, MAX_CANDIDATES)) {
      let detail: Channel3Product;
      try {
        detail = await this.client.getProduct(result.id);
      } catch (error) {
        if (error instanceof Channel3Error && error.code === "CHANNEL3_NOT_FOUND") continue;
        throw error;
      }
      const product = normalizeProduct(detail);
      if (!product) continue;
      this.discovered.set(product.productUrl, product);
      candidates.push(toCandidate(product));
    }

    if (candidates.length === 0) throw new Channel3Error("CHANNEL3_NO_OFFERS");
    return candidates;
  }

  async validateSelection(proposal: ProposedOrder): Promise<void> {
    for (const item of proposal.items) {
      const previous = this.discovered.get(item.productUrl);
      if (!previous) throw new Channel3Error("CHANNEL3_PRODUCT_CHANGED");
      let currentProduct: Channel3Product;
      try {
        currentProduct = await this.client.getProduct(previous.productId);
      } catch (error) {
        if (error instanceof Channel3Error && error.code === "CHANNEL3_NOT_FOUND") {
          throw new Channel3Error("CHANNEL3_PRODUCT_CHANGED", { cause: error });
        }
        throw error;
      }
      const current = normalizeProduct(currentProduct);
      if (!current
        || !sameProductUrl(current.productUrl, previous.productUrl)
        || current.amountMinor !== item.unitPrice.amountMinor
        || current.merchant !== previous.merchant) {
        throw new Channel3Error("CHANNEL3_PRODUCT_CHANGED");
      }
    }
  }
}

export function normalizeProduct(product: Channel3Product): CatalogProductSnapshot | null {
  if (!hasAvailableSelectedVariant(product)) return null;
  const imageUrl = selectProductImageUrl(product.images);
  const offers = (product.offers ?? []).flatMap((offer) => {
    if (offer.availability !== "InStock" || offer.price.currency !== "USD") return [];
    const amountMinor = toMinorUnits(offer.price.price);
    if (amountMinor === null || !isHttpsUrl(offer.url)) return [];
    return [{
      productId: product.id,
      title: product.title,
      description: product.description ?? "",
      productUrl: offer.url,
      merchant: offer.domain,
      amountMinor,
      availability: "InStock" as const,
      ...(imageUrl ? { imageUrl } : {}),
      attributes: product.structured_attributes ?? {},
      selectedVariant: product.variants?.selected ?? [],
    }];
  });
  offers.sort((left, right) => left.amountMinor - right.amountMinor
    || left.merchant.localeCompare(right.merchant)
    || left.productUrl.localeCompare(right.productUrl));
  return offers[0] ?? null;
}

function selectProductImageUrl(images: Channel3Product["images"]): string | undefined {
  const image = images?.find((candidate) => candidate.is_main_image) ?? images?.[0];
  if (!image) return undefined;
  if (image.cleaned_url && isHttpsUrl(image.cleaned_url)) return image.cleaned_url;
  return image.url && isHttpsUrl(image.url) ? image.url : undefined;
}

function hasAvailableSelectedVariant(product: Channel3Product): boolean {
  const variants = product.variants;
  if (!variants) return true;
  if (variants.options.some((option) => option.values.length > 0) && variants.selected.length === 0) return false;
  return variants.selected.every((selected) => {
    const value = variants.options.find((option) => option.name === selected.name)
      ?.values.find((option) => option.label === selected.label);
    return Boolean(value?.exists && value.available !== "OutOfStock");
  });
}

function toCandidate(product: CatalogProductSnapshot): CatalogCandidate {
  const storeId = `channel3-${createHash("sha256").update(product.productId).digest("hex").slice(0, 24)}`;
  const captureId = `capture-${storeId}`;
  const canonical = canonicalSnapshot(product);
  const rawHtml = JSON.stringify(canonical);
  const visibleText = visibleSnapshot(product);
  const capture: TrustedCapture = Object.freeze({
    captureId,
    url: product.productUrl,
    storeId,
    publisherId: PUBLISHER_ID,
    sourceClass: "aggregator",
    rawHtml,
    visibleText,
    contentHash: hashRawContent(rawHtml),
    retrievedAt: new Date().toISOString(),
    securityScan: scanPageSecurity(rawHtml, visibleText, captureId),
  });
  return { capture, title: product.title, kind: "product", product };
}

export function visibleSnapshot(product: CatalogProductSnapshot): string {
  return [
    `Title: ${clip(product.title, 500)}`,
    `Merchant offer: ${clip(product.merchant, 200)} | USD ${(product.amountMinor / 100).toFixed(2)} | InStock | ${product.productUrl}`,
    `Description: ${clip(product.description || "Not supplied", 1_200)}`,
    `Selected variant: ${clip(JSON.stringify(product.selectedVariant.slice(0, 20)), 500)}`,
    `Attributes: ${clip(JSON.stringify(limitedAttributes(product.attributes)), 1_200)}`,
  ].join("\n");
}

function canonicalSnapshot(product: CatalogProductSnapshot) {
  return {
    productId: product.productId,
    title: clip(product.title, 500),
    description: clip(product.description, 1_200),
    offer: {
      url: product.productUrl,
      merchant: product.merchant,
      currency: "USD",
      amountMinor: product.amountMinor,
      availability: product.availability,
    },
    selectedVariant: product.selectedVariant.slice(0, 20),
    attributes: limitedAttributes(product.attributes),
  };
}

function limitedAttributes(attributes: Record<string, string[]>): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(attributes).slice(0, 20).map(([key, values]) => [clip(key, 200), values.slice(0, 20).map((value) => clip(value, 500))]),
  );
}

export function toMinorUnits(price: number): number | null {
  const scaled = price * 100;
  const amountMinor = Math.round(scaled);
  if (!Number.isSafeInteger(amountMinor)
    || amountMinor < 0
    || amountMinor > 10_000_000
    || Math.abs(scaled - amountMinor) > 1e-7) return null;
  return amountMinor;
}

function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

function sameProductUrl(left: string, right: string): boolean {
  if (left === right) return true;
  try {
    const leftUrl = new URL(left);
    const rightUrl = new URL(right);
    if (leftUrl.hostname !== "buy.trychannel3.com" || rightUrl.hostname !== "buy.trychannel3.com") return false;
    // Channel3 rotates this tracking value on every Product Detail response.
    // Offer identity and every other URL component must remain unchanged.
    leftUrl.searchParams.delete("aid");
    rightUrl.searchParams.delete("aid");
    return leftUrl.toString() === rightUrl.toString();
  } catch {
    return false;
  }
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max);
}
