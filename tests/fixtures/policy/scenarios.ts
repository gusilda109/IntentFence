import { sha256 } from "@/server/canonical-json";
import type {
  EvidenceRecord,
  Mandate,
  ProposedOrder,
  ProposedOrderItem,
} from "@/shared/contracts";

export interface PolicyScenario {
  mandate: Mandate;
  proposedOrder: ProposedOrder;
  evidence: EvidenceRecord[];
}

const retrievedAt = "2026-01-01T00:00:00.000Z";
const createdAt = "2026-01-01T00:00:00.000Z";

const coffeeIds = {
  mandate: "10000000-0000-4000-8000-000000000001",
  order: "10000000-0000-4000-8000-000000000002",
  tablet: "10000000-0000-4000-8000-000000000003",
  printer: "10000000-0000-4000-8000-000000000004",
  adapter: "10000000-0000-4000-8000-000000000005",
  upsell: "10000000-0000-4000-8000-000000000006",
  tabletEvidence: "20000000-0000-4000-8000-000000000001",
  printerEvidence: "20000000-0000-4000-8000-000000000002",
  printerCompatibility: "20000000-0000-4000-8000-000000000003",
  adapterEvidence: "20000000-0000-4000-8000-000000000004",
  adapterCompatibility: "20000000-0000-4000-8000-000000000005",
  upsellEvidence: "20000000-0000-4000-8000-000000000006",
} as const;

export function coffeePolicyScenario(): PolicyScenario {
  const mandate = makeMandate(
    coffeeIds.mandate,
    "Organize checkout for a cafe based on a tablet",
    80_000,
  );
  const items: ProposedOrderItem[] = [
    makeItem({
      id: coffeeIds.tablet,
      storeId: "tablet-hub",
      name: "Checkout Tablet",
      description: "A general-purpose touch device.",
      amountMinor: 25_000,
      purpose: "Tablet for the requested checkout workflow",
      necessityEvidenceIds: [coffeeIds.tabletEvidence],
    }),
    makeItem({
      id: coffeeIds.printer,
      storeId: "pos-supply",
      name: "Receipt Printer",
      description: "A transaction output device.",
      amountMinor: 12_000,
      purpose: "Produce receipts for completed orders",
      necessityEvidenceIds: [coffeeIds.printerEvidence],
      compatibility: [{
        withItemId: coffeeIds.tablet,
        requirement: "The two stated interfaces must interoperate.",
        evidenceIds: [coffeeIds.printerCompatibility],
      }],
    }),
    makeItem({
      id: coffeeIds.adapter,
      storeId: "pos-supply",
      name: "Interface Adapter",
      description: "A connector between two documented interfaces.",
      amountMinor: 4_000,
      purpose: "Connect the printer interface to the tablet",
      necessityEvidenceIds: [coffeeIds.adapterEvidence],
      compatibility: [{
        withItemId: coffeeIds.printer,
        requirement: "The connector must match the documented interface.",
        evidenceIds: [coffeeIds.adapterCompatibility],
      }],
    }),
    makeItem({
      id: coffeeIds.upsell,
      storeId: "checkout-bundles",
      name: "Calibration License",
      description: "An optional enablement offered with the order.",
      amountMinor: 9_900,
      purpose: "Enable an optional calibration service",
      necessityEvidenceIds: [coffeeIds.upsellEvidence],
    }),
  ];
  const evidence = [
    makeEvidence(coffeeIds.tabletEvidence, coffeeIds.tablet, "tablet-hub", "tablet-publisher", "seller", "necessity"),
    makeEvidence(coffeeIds.printerEvidence, coffeeIds.printer, "pos-supply", "supply-publisher", "seller", "necessity"),
    makeEvidence(coffeeIds.printerCompatibility, coffeeIds.printer, "maker-docs", "maker-publisher", "manufacturer", "compatibility"),
    makeEvidence(coffeeIds.adapterEvidence, coffeeIds.adapter, "pos-supply", "supply-publisher", "seller", "necessity"),
    makeEvidence(coffeeIds.adapterCompatibility, coffeeIds.adapter, "maker-docs", "maker-publisher", "manufacturer", "compatibility"),
    makeEvidence(coffeeIds.upsellEvidence, coffeeIds.upsell, "checkout-bundles", "bundle-publisher", "seller", "necessity", "QUARANTINED"),
  ];
  return { mandate, proposedOrder: makeOrder(coffeeIds.order, mandate.id, items, evidence), evidence };
}

export function workshopPolicyScenario(): PolicyScenario {
  const ids = {
    mandate: "30000000-0000-4000-8000-000000000001",
    order: "30000000-0000-4000-8000-000000000002",
    base: "30000000-0000-4000-8000-000000000003",
    attachment: "30000000-0000-4000-8000-000000000004",
    extra: "30000000-0000-4000-8000-000000000005",
    baseEvidence: "40000000-0000-4000-8000-000000000001",
    attachmentEvidence: "40000000-0000-4000-8000-000000000002",
    attachmentCompatibility: "40000000-0000-4000-8000-000000000003",
    extraEvidence: "40000000-0000-4000-8000-000000000004",
  } as const;
  const mandate = makeMandate(ids.mandate, "Assemble a home workshop around a benchtop drill", 60_000);
  const items = [
    makeItem({
      id: ids.base,
      storeId: "tool-store",
      name: "Benchtop Drill",
      description: "The primary workstation.",
      amountMinor: 22_000,
      purpose: "Benchtop drill for the home workshop",
      necessityEvidenceIds: [ids.baseEvidence],
    }),
    makeItem({
      id: ids.attachment,
      storeId: "tool-store",
      name: "Fence Assembly",
      description: "A documented attachment for repeatable work.",
      amountMinor: 5_000,
      purpose: "Guide material during repeated operations",
      necessityEvidenceIds: [ids.attachmentEvidence],
      compatibility: [{
        withItemId: ids.base,
        requirement: "The mounting geometry must match.",
        evidenceIds: [ids.attachmentCompatibility],
      }],
    }),
    makeItem({
      id: ids.extra,
      storeId: "tool-store",
      name: "Concierge Membership",
      description: "A separately offered service.",
      amountMinor: 7_500,
      purpose: "Provide an optional concierge session",
      necessityEvidenceIds: [ids.extraEvidence],
    }),
  ];
  const evidence = [
    makeEvidence(ids.baseEvidence, ids.base, "tool-store", "tool-publisher", "seller", "necessity"),
    makeEvidence(ids.attachmentEvidence, ids.attachment, "workshop-reference", "reference-publisher", "independent_reference", "necessity"),
    makeEvidence(ids.attachmentCompatibility, ids.attachment, "tool-docs", "tool-documentation-publisher", "manufacturer", "compatibility"),
    makeEvidence(ids.extraEvidence, ids.extra, "tool-store", "tool-publisher", "seller", "necessity"),
  ];
  return { mandate, proposedOrder: makeOrder(ids.order, mandate.id, items, evidence), evidence };
}

export function dependencyPolicyScenario(): PolicyScenario {
  const ids = {
    mandate: "50000000-0000-4000-8000-000000000001",
    order: "50000000-0000-4000-8000-000000000002",
    base: "50000000-0000-4000-8000-000000000003",
    dependent: "50000000-0000-4000-8000-000000000004",
    baseEvidence: "60000000-0000-4000-8000-000000000001",
    dependentEvidence: "60000000-0000-4000-8000-000000000002",
    compatibilityEvidence: "60000000-0000-4000-8000-000000000003",
  } as const;
  const mandate = makeMandate(ids.mandate, "Set up a base console for field work", 40_000);
  const items = [
    makeItem({
      id: ids.base,
      storeId: "field-store",
      name: "Base Console",
      description: "The primary device.",
      amountMinor: 15_000,
      purpose: "Base console for field work",
      necessityEvidenceIds: [ids.baseEvidence],
    }),
    makeItem({
      id: ids.dependent,
      storeId: "field-store",
      name: "Sensor Module",
      description: "A module requiring the primary device.",
      amountMinor: 6_000,
      purpose: "Add sensing capability to the primary device",
      necessityEvidenceIds: [ids.dependentEvidence],
      compatibility: [{
        withItemId: ids.base,
        requirement: "The module requires the documented host interface.",
        evidenceIds: [ids.compatibilityEvidence],
      }],
    }),
  ];
  const evidence = [
    makeEvidence(ids.baseEvidence, ids.base, "field-store", "field-publisher", "seller", "necessity"),
    makeEvidence(ids.dependentEvidence, ids.dependent, "field-reference", "field-reference-publisher", "independent_reference", "necessity"),
    makeEvidence(ids.compatibilityEvidence, ids.dependent, "field-docs", "field-docs-publisher", "manufacturer", "compatibility"),
  ];
  return { mandate, proposedOrder: makeOrder(ids.order, mandate.id, items, evidence), evidence };
}

function makeMandate(id: string, goal: string, amountMinor: number): Mandate {
  return {
    schemaVersion: "1",
    id,
    goal,
    budget: { currency: "USD", amountMinor },
    constraints: [],
    createdAt,
  };
}

function makeItem(input: {
  id: string;
  storeId: string;
  name: string;
  description: string;
  amountMinor: number;
  purpose: string;
  necessityEvidenceIds: string[];
  compatibility?: ProposedOrderItem["compatibility"];
}): ProposedOrderItem {
  return {
    id: input.id,
    storeId: input.storeId,
    productUrl: `https://${input.storeId}.example/items/${input.id}`,
    name: input.name,
    description: input.description,
    quantity: 1,
    unitPrice: { currency: "USD", amountMinor: input.amountMinor },
    purpose: input.purpose,
    necessityEvidenceIds: input.necessityEvidenceIds,
    compatibility: input.compatibility ?? [],
  };
}

function makeEvidence(
  id: string,
  itemId: string,
  storeId: string,
  publisherId: string,
  sourceClass: EvidenceRecord["evidence"]["source"]["sourceClass"],
  claimKind: EvidenceRecord["evidence"]["claims"][number]["kind"],
  securityStatus: EvidenceRecord["security"]["status"] = "CLEAN",
): EvidenceRecord {
  const captureId = `capture-${id}`;
  return {
    evidence: {
      schemaVersion: "1",
      id,
      captureId,
      itemId,
      source: {
        storeId,
        publisherId,
        url: `https://${storeId}.example/evidence/${id}`,
        sourceClass,
      },
      locator: "main content",
      excerpt: "Structured fixture excerpt.",
      claims: [{ kind: claimKind, text: "A structured claim linked to this item and requirement." }],
      contentHash: sha256({ captureId, claimKind }),
      retrievedAt,
    },
    security: {
      captureId,
      status: securityStatus,
      findings: securityStatus === "QUARANTINED"
        ? [{ code: "AGENT_DIRECTED_INSTRUCTION", message: "Untrusted agent-directed content was concealed." }]
        : [],
    },
  };
}

function makeOrder(
  id: string,
  mandateId: string,
  items: ProposedOrderItem[],
  evidence: EvidenceRecord[],
): ProposedOrder {
  return {
    schemaVersion: "1",
    id,
    mandateId,
    items,
    evidenceIds: evidence.map((record) => record.evidence.id),
    total: {
      currency: "USD",
      amountMinor: items.reduce((sum, item) => sum + item.unitPrice.amountMinor * item.quantity, 0),
    },
    assumptions: [],
    createdAt,
  };
}
