import {
  EvidenceRecordSchema,
  MandateSchema,
  ProposedOrderSchema,
  type EvidenceRecord,
  type Mandate,
  type ProposedOrder,
} from "@/shared/contracts";
import { getStorePageByUrl, getStoreRegistration, isAllowlistedProductUrl } from "@/modules/demo-stores";
import { captureStorePage } from "./evidence";

export class ActorValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ActorValidationError";
  }
}

function requireInvariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ActorValidationError(message);
}

export function validateProposedOrder(
  mandateInput: Mandate,
  candidate: unknown,
  trustedRecords: readonly EvidenceRecord[],
  options: {
    getCapture?: (url: string) => ReturnType<typeof captureStorePage> | undefined;
    isAllowedProductUrl?: (storeId: string, url: string) => boolean;
  } = {},
): ProposedOrder {
  const mandate = MandateSchema.parse(mandateInput);
  const parsedProposal = ProposedOrderSchema.parse(candidate);
  const proposal: ProposedOrder = {
    ...parsedProposal,
    items: parsedProposal.items.map((item) => {
      try {
        // Canonicalize legacy Replay URLs to the active public demo-store origin.
        return { ...item, productUrl: getStorePageByUrl(item.productUrl).url };
      } catch {
        return item;
      }
    }),
  };
  requireInvariant(proposal.mandateId === mandate.id, "Proposal mandateId does not match the active mandate");

  const itemIds = new Set<string>();
  for (const item of proposal.items) {
    requireInvariant(!itemIds.has(item.id), `Duplicate item ID: ${item.id}`);
    itemIds.add(item.id);
    requireInvariant(
      (options.isAllowedProductUrl ?? isAllowlistedProductUrl)(item.storeId, item.productUrl),
      `Product URL is not an allowlisted product in store ${item.storeId}`,
    );
  }

  const recordsById = new Map<string, EvidenceRecord>();
  for (const untrustedRecord of trustedRecords) {
    const record = EvidenceRecordSchema.parse(untrustedRecord);
    const { evidence, security } = record;
    requireInvariant(!recordsById.has(evidence.id), `Duplicate trusted evidence ID: ${evidence.id}`);

    const capture = options.getCapture?.(evidence.source.url)
      ?? captureStorePage(evidence.source.url, new Date(evidence.retrievedAt));
    const registration = capture.sourceClass === "aggregator"
      ? capture
      : getStoreRegistration(capture.storeId);
    requireInvariant(evidence.captureId === capture.captureId, `Capture ID mismatch for evidence ${evidence.id}`);
    requireInvariant(evidence.contentHash === capture.contentHash, `Content hash mismatch for evidence ${evidence.id}`);
    requireInvariant(evidence.source.storeId === registration.storeId, `Store metadata mismatch for evidence ${evidence.id}`);
    requireInvariant(evidence.source.publisherId === registration.publisherId, `Publisher mismatch for evidence ${evidence.id}`);
    requireInvariant(evidence.source.sourceClass === registration.sourceClass, `Source class mismatch for evidence ${evidence.id}`);
    requireInvariant(security.captureId === capture.captureId, `Security capture mismatch for evidence ${evidence.id}`);
    requireInvariant(
      JSON.stringify(security) === JSON.stringify(capture.securityScan.report),
      `Security metadata mismatch for evidence ${evidence.id}`,
    );
    requireInvariant(!evidence.itemId || itemIds.has(evidence.itemId), `Evidence ${evidence.id} references an unknown item`);
    recordsById.set(evidence.id, record);
  }

  const listedEvidenceIds = new Set<string>();
  for (const evidenceId of proposal.evidenceIds) {
    requireInvariant(!listedEvidenceIds.has(evidenceId), `Duplicate proposal evidence ID: ${evidenceId}`);
    requireInvariant(recordsById.has(evidenceId), `Unknown proposal evidence ID: ${evidenceId}`);
    listedEvidenceIds.add(evidenceId);
  }

  for (const item of proposal.items) {
    for (const evidenceId of item.necessityEvidenceIds) {
      requireInvariant(recordsById.has(evidenceId), `Unknown necessity evidence ID: ${evidenceId}`);
      requireInvariant(listedEvidenceIds.has(evidenceId), `Necessity evidence ${evidenceId} is missing from proposal.evidenceIds`);
    }
    for (const compatibility of item.compatibility) {
      requireInvariant(
        compatibility.withItemId === null || itemIds.has(compatibility.withItemId),
        `Compatibility claim references an unknown item for ${item.id}`,
      );
      for (const evidenceId of compatibility.evidenceIds) {
        requireInvariant(recordsById.has(evidenceId), `Unknown compatibility evidence ID: ${evidenceId}`);
        requireInvariant(listedEvidenceIds.has(evidenceId), `Compatibility evidence ${evidenceId} is missing from proposal.evidenceIds`);
      }
    }
  }

  const expectedTotal = proposal.items.reduce(
    (sum, item) => sum + item.unitPrice.amountMinor * item.quantity,
    0,
  );
  requireInvariant(proposal.total.currency === "USD", "Proposal total must use USD");
  requireInvariant(proposal.total.amountMinor === expectedTotal, "Proposal total does not match item arithmetic");
  requireInvariant(
    proposal.items.every((item) => item.unitPrice.currency === proposal.total.currency),
    "Proposal contains mixed currencies",
  );

  return proposal;
}
