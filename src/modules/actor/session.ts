import type { CatalogListing, Evidence, EvidenceRecord } from "@/shared/contracts";
import type { CatalogCandidate } from "@/modules/catalog/types";
import { captureStorePage, evidenceFromCapture, type TrustedCapture } from "./evidence";

export class ActorEvidenceSession {
  private readonly captures = new Map<string, TrustedCapture>();
  private readonly records = new Map<string, Map<string, EvidenceRecord>>();
  private readonly productUrls = new Set<string>();
  private readonly listings = new Map<string, CatalogListing>();

  readPage(url: string): TrustedCapture {
    const capture = captureStorePage(url);
    this.captures.set(capture.url, capture);
    return capture;
  }

  registerCandidate(candidate: CatalogCandidate): TrustedCapture {
    this.captures.set(candidate.capture.url, candidate.capture);
    if (candidate.kind === "product") this.productUrls.add(candidate.capture.url);
    if (candidate.product) {
      // Channel3 Product Detail is the trusted source of the selected offer's
      // title and price; the Actor's own draft values are compared against it.
      this.listings.set(candidate.capture.url, {
        source: "channel3",
        title: candidate.product.title.slice(0, 300),
        ...(candidate.product.category ? { category: candidate.product.category.slice(0, 200) } : {}),
        unitPrice: { currency: "USD", amountMinor: candidate.product.amountMinor },
      });
    }
    return candidate.capture;
  }

  getCatalogListing(storeId: string, url: string): CatalogListing | undefined {
    if (!this.isRegisteredProductUrl(storeId, url)) return undefined;
    const listing = this.listings.get(url);
    return listing ? structuredClone(listing) : undefined;
  }

  getCapture(url: string): TrustedCapture | undefined {
    return this.captures.get(url);
  }

  isRegisteredProductUrl(storeId: string, url: string): boolean {
    return this.productUrls.has(url) && this.captures.get(url)?.storeId === storeId;
  }

  acquire(
    mandateId: string,
    input: { url: string; locator: string; excerpt: string; claims: Evidence["claims"]; itemId?: string },
  ): EvidenceRecord {
    const capture = this.captures.get(input.url) ?? this.readPage(input.url);
    const record = evidenceFromCapture(capture, input);
    const mandateRecords = this.records.get(mandateId) ?? new Map<string, EvidenceRecord>();
    mandateRecords.set(record.evidence.id, record);
    this.records.set(mandateId, mandateRecords);
    return structuredClone(record);
  }

  saveReplayRecords(mandateId: string, records: readonly EvidenceRecord[]): void {
    const mandateRecords = new Map<string, EvidenceRecord>();
    for (const record of records) mandateRecords.set(record.evidence.id, structuredClone(record));
    this.records.set(mandateId, mandateRecords);
  }

  reset(mandateId: string): void {
    this.records.delete(mandateId);
  }

  list(mandateId: string): EvidenceRecord[] {
    return [...(this.records.get(mandateId)?.values() ?? [])].map((record) => structuredClone(record));
  }
}
