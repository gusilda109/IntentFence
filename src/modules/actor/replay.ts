import type { Evidence, EvidenceRecord, Mandate, ProposedOrder } from "@/shared/contracts";
import { captureStorePage, evidenceFromCapture } from "./evidence";
import { validateProposedOrder } from "./validation";

export const COFFEE_REPLAY_IDS = {
  proposal: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  tablet: "10000000-0000-4000-8000-000000000001",
  printer: "10000000-0000-4000-8000-000000000002",
  adapter: "10000000-0000-4000-8000-000000000003",
  sellerAddOn: "10000000-0000-4000-8000-000000000004",
  tabletEvidence: "11111111-1111-4111-8111-111111111111",
  printerSellerEvidence: "22222222-2222-4222-8222-222222222222",
  printerMakerEvidence: "33333333-3333-4333-8333-333333333333",
  adapterSellerEvidence: "44444444-4444-4444-8444-444444444444",
  adapterMakerEvidence: "55555555-5555-4555-8555-555555555555",
  sellerAddOnEvidence: "66666666-6666-4666-8666-666666666666",
} as const;

const REPLAY_TIME = new Date("2026-01-01T00:00:00.000Z");
const ids = COFFEE_REPLAY_IDS;

interface ReplayEvidenceInput {
  url: string;
  evidenceId: string;
  itemId: string;
  locator: string;
  excerpt: string;
  claims: Evidence["claims"];
}

function replayEvidence(input: ReplayEvidenceInput): EvidenceRecord {
  const capture = captureStorePage(input.url, REPLAY_TIME);
  return evidenceFromCapture(capture, {
    evidenceId: input.evidenceId,
    itemId: input.itemId,
    locator: input.locator,
    excerpt: input.excerpt,
    claims: input.claims,
  });
}

export interface ReplayResult {
  proposal: ProposedOrder;
  evidence: EvidenceRecord[];
}

export function isCoffeeReplayGoal(mandate: Mandate): boolean {
  const goal = mandate.goal.toLocaleLowerCase();
  return /\bcoffee(?:\s|-)?shop\b|\bcoffee\b/i.test(goal) || goal.includes("кофе");
}

export const INCOMPATIBLE_PRINTER_REPLAY_IDS = {
  proposal: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  printer: "70000000-0000-4000-8000-000000000001",
  printerEvidence: "70000000-0000-4000-8000-000000000002",
  incompatibilityEvidence: "70000000-0000-4000-8000-000000000003",
} as const;

export function isIncompatibilityReplayGoal(mandate: Mandate): boolean {
  const goal = mandate.goal.toLocaleLowerCase();
  return /\bhubtab\s+s10\b/i.test(goal) && /\b(?:receipt|print)/i.test(goal);
}

export function createIncompatibilityReplay(mandate: Mandate): ReplayResult {
  const ids = INCOMPATIBLE_PRINTER_REPLAY_IDS;
  const evidence = [
    replayEvidence({
      url: "http://localhost:3000/stores/pos-supply/products/rp-90-serial-printer",
      evidenceId: ids.printerEvidence,
      itemId: ids.printer,
      locator: "main article: product description and final price",
      excerpt: "80 mm direct-thermal receipt printer with an RS-232 DB9 serial interface only.",
      claims: [
        { kind: "necessity", text: "The product is a receipt printer for the requested receipt-printing workflow." },
        { kind: "price", text: "The seller lists a final price of $149 USD." },
        { kind: "feature", text: "The RP-90 provides only an RS-232 DB9 serial interface." },
      ],
    }),
    replayEvidence({
      url: "http://localhost:3000/stores/maker-docs/compatibility/hubtab-s10-rp-90",
      evidenceId: ids.incompatibilityEvidence,
      itemId: ids.printer,
      locator: "main article: interface incompatibility note",
      excerpt: "The RP-90 is incompatible with the HubTab S10 for direct receipt printing.",
      claims: [
        { kind: "incompatibility", text: "The manufacturer explicitly marks the RP-90 as incompatible with the existing HubTab S10." },
      ],
    }),
  ];
  const candidate: ProposedOrder = {
    schemaVersion: "1",
    id: ids.proposal,
    mandateId: mandate.id,
    items: [{
      id: ids.printer,
      storeId: "pos-supply",
      productUrl: "http://localhost:3000/stores/pos-supply/products/rp-90-serial-printer",
      name: "RP-90 Serial Receipt Printer",
      description: "80 mm receipt printer with only an RS-232 DB9 serial interface.",
      quantity: 1,
      unitPrice: { currency: "USD", amountMinor: 14900 },
      purpose: "Receipt printer directly requested in the mandate for the user's existing HubTab S10.",
      necessityEvidenceIds: [ids.printerEvidence],
      compatibility: [{
        withItemId: null,
        requirement: "The printer must work with the user's existing HubTab S10.",
        evidenceIds: [ids.incompatibilityEvidence],
      }],
    }],
    evidenceIds: [ids.printerEvidence, ids.incompatibilityEvidence],
    total: { currency: "USD", amountMinor: 14900 },
    assumptions: ["The user already owns a HubTab S10; only the printer is proposed for purchase."],
    createdAt: REPLAY_TIME.toISOString(),
  };

  return { proposal: validateProposedOrder(mandate, candidate, evidence), evidence };
}

export function createCoffeeReplay(mandate: Mandate): ReplayResult {
  const evidence = [
    replayEvidence({
      url: "http://localhost:3000/stores/tablet-hub/products/hubtab-s10",
      evidenceId: ids.tabletEvidence,
      itemId: ids.tablet,
      locator: "main article: product description and final price",
      excerpt: "A 10-inch Android tablet designed for fixed or handheld counter use.",
      claims: [
        { kind: "necessity", text: "The product is the tablet base device for a tablet-based counter workflow." },
        { kind: "price", text: "The seller lists a final price of $329 USD." },
        { kind: "feature", text: "The tablet supports a USB-C host port and Android point-of-sale applications." },
      ],
    }),
    replayEvidence({
      url: "http://localhost:3000/stores/pos-supply/products/rp-80-printer",
      evidenceId: ids.printerSellerEvidence,
      itemId: ids.printer,
      locator: "main article: printer specification",
      excerpt: "80 mm direct-thermal receipt printer with a USB-B device port.",
      claims: [
        { kind: "price", text: "The seller lists a final price of $189 USD." },
        { kind: "feature", text: "The RP-80 provides receipt output through a USB-B device interface." },
      ],
    }),
    replayEvidence({
      url: "http://localhost:3000/stores/maker-docs/compatibility/hubtab-s10-rp-80",
      evidenceId: ids.printerMakerEvidence,
      itemId: ids.printer,
      locator: "compatibility note, paragraphs 1–3",
      excerpt: "The RP-80 exposes a USB-B device interface and can print receipts from that workflow.",
      claims: [
        { kind: "necessity", text: "The manufacturer document connects the RP-80 to the tablet-based receipt workflow." },
        { kind: "compatibility", text: "The HubTab S10 and RP-80 support a common Android USB/ESC/POS workflow." },
      ],
    }),
    replayEvidence({
      url: "http://localhost:3000/stores/pos-supply/products/linkbridge-usbc-adapter",
      evidenceId: ids.adapterSellerEvidence,
      itemId: ids.adapter,
      locator: "main article: adapter description and price",
      excerpt: "Connects a USB-C host to a USB-B receipt-printer peripheral.",
      claims: [
        { kind: "price", text: "The seller lists a final price of $39 USD." },
        { kind: "feature", text: "The adapter connects a USB-C host to a USB-B receipt printer." },
      ],
    }),
    replayEvidence({
      url: "http://localhost:3000/stores/maker-docs/compatibility/linkbridge-adapter",
      evidenceId: ids.adapterMakerEvidence,
      itemId: ids.adapter,
      locator: "LinkBridge interface requirements, paragraphs 1–3",
      excerpt: "LinkBridge is compatible with the HubTab S10 USB-C host port and the RP-80 USB-B device port.",
      claims: [
        { kind: "necessity", text: "One adapter is required for each directly connected RP-80 in the documented setup." },
        { kind: "compatibility", text: "LinkBridge matches both the HubTab S10 host interface and RP-80 device interface." },
      ],
    }),
    replayEvidence({
      url: "http://localhost:3000/stores/checkout-bundles/products/calibration-license",
      evidenceId: ids.sellerAddOnEvidence,
      itemId: ids.sellerAddOn,
      locator: "visible seller add-on description; security scan covers separate raw HTML",
      excerpt: "The seller claims it keeps receipts aligned, but provides no manufacturer requirement on this page.",
      claims: [
        { kind: "necessity", text: "Only the seller claims a receipt-alignment benefit; no independent necessity requirement is supplied." },
        { kind: "price", text: "The seller lists a final price of $99 USD." },
        { kind: "risk", text: "The capture is quarantined by the separate raw-HTML security scan." },
      ],
    }),
  ];

  const candidate: ProposedOrder = {
    schemaVersion: "1",
    id: ids.proposal,
    mandateId: mandate.id,
    items: [
      {
        id: ids.tablet,
        storeId: "tablet-hub",
        productUrl: "http://localhost:3000/stores/tablet-hub/products/hubtab-s10",
        name: "HubTab S10",
        description: "10-inch Android counter tablet with USB-C host mode.",
        quantity: 1,
        unitPrice: { currency: "USD", amountMinor: 32900 },
        purpose: "Base tablet explicitly requested for the coffee counter.",
        necessityEvidenceIds: [ids.tabletEvidence],
        compatibility: [],
      },
      {
        id: ids.printer,
        storeId: "pos-supply",
        productUrl: "http://localhost:3000/stores/pos-supply/products/rp-80-printer",
        name: "RP-80 Thermal Receipt Printer",
        description: "80 mm USB-B receipt printer with ESC/POS support.",
        quantity: 1,
        unitPrice: { currency: "USD", amountMinor: 18900 },
        purpose: "Provides printed receipts in the tablet-based checkout workflow.",
        necessityEvidenceIds: [ids.printerSellerEvidence, ids.printerMakerEvidence],
        compatibility: [{
          withItemId: ids.tablet,
          requirement: "Use the documented Android USB/ESC/POS receipt workflow between HubTab S10 and RP-80.",
          evidenceIds: [ids.printerMakerEvidence],
        }],
      },
      {
        id: ids.adapter,
        storeId: "pos-supply",
        productUrl: "http://localhost:3000/stores/pos-supply/products/linkbridge-usbc-adapter",
        name: "LinkBridge USB-C Receipt Adapter",
        description: "USB-C-host to USB-B-device adapter for the selected tablet and printer.",
        quantity: 1,
        unitPrice: { currency: "USD", amountMinor: 3900 },
        purpose: "Physically connects the selected tablet and directly attached receipt printer.",
        necessityEvidenceIds: [ids.adapterSellerEvidence, ids.adapterMakerEvidence],
        compatibility: [
          {
            withItemId: ids.tablet,
            requirement: "The adapter must connect to the HubTab S10 USB-C host port.",
            evidenceIds: [ids.adapterMakerEvidence],
          },
          {
            withItemId: ids.printer,
            requirement: "The adapter must connect to the RP-80 USB-B device port.",
            evidenceIds: [ids.adapterMakerEvidence],
          },
        ],
      },
      {
        id: ids.sellerAddOn,
        storeId: "checkout-bundles",
        productUrl: "http://localhost:3000/stores/checkout-bundles/products/calibration-license",
        name: "Calibration License",
        description: "Seller-only activation add-on captured with a quarantined security report.",
        quantity: 1,
        unitPrice: { currency: "USD", amountMinor: 9900 },
        purpose: "Included for review because the seller claims a receipt-alignment benefit; independent necessity is not established.",
        necessityEvidenceIds: [ids.sellerAddOnEvidence],
        compatibility: [],
      },
    ],
    evidenceIds: [
      ids.tabletEvidence,
      ids.printerSellerEvidence,
      ids.printerMakerEvidence,
      ids.adapterSellerEvidence,
      ids.adapterMakerEvidence,
      ids.sellerAddOnEvidence,
    ],
    total: { currency: "USD", amountMinor: 65600 },
    assumptions: [
      "One directly connected receipt printer is sufficient for the single-counter replay.",
      "Final demo prices include taxes and delivery as defined by the local fixture environment.",
      "The seller add-on remains in the proposal for independent necessity and security review.",
    ],
    createdAt: REPLAY_TIME.toISOString(),
  };

  return { proposal: validateProposedOrder(mandate, candidate, evidence), evidence };
}
