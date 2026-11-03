import { createHash, randomUUID } from "node:crypto";
import {
  EvidenceRecordSchema,
  type Evidence,
  type EvidenceRecord,
} from "@/shared/contracts";
import {
  extractVisibleText,
  getStorePageByUrl,
  getStoreRegistration,
  type StorePageDefinition,
  type StoreSourceClass,
} from "@/modules/demo-stores";
import { scanPageSecurity, type PageSecurityScan } from "./security";

export interface TrustedCapture {
  readonly captureId: string;
  readonly url: string;
  readonly storeId: string;
  readonly publisherId: string;
  readonly sourceClass: StoreSourceClass;
  readonly rawHtml: string;
  readonly visibleText: string;
  readonly contentHash: string;
  readonly retrievedAt: string;
  readonly securityScan: PageSecurityScan;
}

export interface AcquireEvidenceInput {
  readonly locator: string;
  readonly excerpt: string;
  readonly claims: Evidence["claims"];
  readonly itemId?: string;
  readonly evidenceId?: string;
}

export function hashRawContent(rawHtml: string): string {
  return createHash("sha256").update(rawHtml, "utf8").digest("hex");
}

export function captureStorePage(url: string, retrievedAt = new Date()): TrustedCapture {
  const page = getStorePageByUrl(url);
  const registration = getStoreRegistration(page.storeId);
  const visibleText = extractVisibleText(page.rawHtml);
  const securityScan = scanPageSecurity(page.rawHtml, visibleText, page.captureId);

  return Object.freeze({
    captureId: page.captureId,
    url: page.url,
    storeId: page.storeId,
    publisherId: registration.publisherId,
    sourceClass: registration.sourceClass,
    rawHtml: page.rawHtml,
    visibleText,
    contentHash: hashRawContent(page.rawHtml),
    retrievedAt: retrievedAt.toISOString(),
    securityScan,
  });
}

export function evidenceFromCapture(
  capture: TrustedCapture,
  input: AcquireEvidenceInput,
): EvidenceRecord {
  const requestedExcerpt = input.excerpt.trim();
  const excerpt = capture.visibleText.includes(requestedExcerpt)
    ? requestedExcerpt
    : findWhitespaceEquivalentExcerpt(capture.visibleText, requestedExcerpt);
  if (!excerpt) {
    const error = new Error("Evidence excerpt must be non-empty visible text copied verbatim from the capture");
    // Live Actor treats this as invalid model output and retries the draft once.
    error.name = "ModelBehaviorError";
    throw error;
  }

  return EvidenceRecordSchema.parse({
    evidence: {
      schemaVersion: "1",
      id: input.evidenceId ?? randomUUID(),
      captureId: capture.captureId,
      ...(input.itemId ? { itemId: input.itemId } : {}),
      source: {
        storeId: capture.storeId,
        publisherId: capture.publisherId,
        url: capture.url,
        sourceClass: capture.sourceClass,
      },
      locator: input.locator,
      excerpt,
      claims: input.claims,
      contentHash: capture.contentHash,
      retrievedAt: capture.retrievedAt,
    },
    security: capture.securityScan.report,
  });
}

function findWhitespaceEquivalentExcerpt(visibleText: string, requestedExcerpt: string): string | undefined {
  if (!requestedExcerpt) return undefined;
  const pattern = requestedExcerpt
    .split(/\s+/u)
    .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s+");
  return new RegExp(pattern, "u").exec(visibleText)?.[0];
}

export function captureDefinition(capture: TrustedCapture): StorePageDefinition {
  return getStorePageByUrl(capture.url);
}
