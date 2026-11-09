import { randomUUID } from "node:crypto";
import { z } from "zod";

import { sha256 } from "@/server/canonical-json";
import {
  EvidenceRecordSchema,
  MandateSchema,
  ProposedOrderSchema,
  VerdictSchema,
  type Evidence,
  type EvidenceRecord,
  type ItemDecision,
  type Mandate,
  type PolicyFinding,
  type ProposedOrder,
  type ProposedOrderItem,
  type Verdict,
} from "@/shared/contracts";

export const POLICY_VERSION = "intentfence-supervisor-1.2.0";

const semanticFindingCodes = new Set<PolicyFinding["code"]>([
  "MANDATE_CONFLICT",
  "INSUFFICIENT_NECESSITY",
  "INSUFFICIENT_COMPATIBILITY",
  "INCOMPATIBLE",
  "OTHER",
]);

const stopWords = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in",
  "into", "is", "it", "of", "on", "or", "that", "the", "their", "this",
  "to", "using", "with", "без", "в", "для", "и", "из", "к", "на", "о",
  "от", "по", "при", "с", "через", "это",
]);

type Decision = ItemDecision["decision"];
type MutableDecision = { decision: Decision; reasons: PolicyFinding[] };

export interface PolicyEvaluationInput {
  mandate: Mandate;
  proposedOrder: ProposedOrder;
  evidence: EvidenceRecord[];
  semanticVerdict?: Verdict;
}

export function computeSupervisorInputHash(
  mandate: Mandate,
  proposedOrder: ProposedOrder,
  evidence: EvidenceRecord[],
): string {
  return sha256({
    mandate,
    proposedOrder,
    trustedEvidenceMetadata: evidence.map((record) => record.evidence),
    securityReports: evidence.map((record) => record.security),
  });
}

export function evaluatePolicy(input: PolicyEvaluationInput): Verdict {
  const mandate = MandateSchema.parse(input.mandate);
  const proposedOrder = ProposedOrderSchema.parse(input.proposedOrder);
  const evidence = z.array(EvidenceRecordSchema).parse(input.evidence);

  assertUniqueIds(proposedOrder, evidence);

  const recordsById = new Map(evidence.map((record) => [record.evidence.id, record]));
  const decisions = new Map<string, MutableDecision>();
  const globalFindings: PolicyFinding[] = [];
  const globalBlockingFindings: PolicyFinding[] = [];

  for (const item of proposedOrder.items) {
    decisions.set(item.id, { decision: "ALLOW", reasons: [] });
  }

  const addGlobalFinding = (finding: PolicyFinding, blockAll = false) => {
    addFinding(globalFindings, finding);
    if (blockAll) {
      globalBlockingFindings.push(finding);
      for (const item of proposedOrder.items) {
        downgrade(decisions.get(item.id)!, "BLOCK", { ...finding, itemId: item.id });
      }
    }
  };

  if (proposedOrder.mandateId !== mandate.id) {
    addGlobalFinding(finding(
      "MANDATE_CONFLICT",
      "critical",
      "The proposal belongs to a different mandate.",
    ), true);
  }

  const calculatedTotal = proposedOrder.items.reduce(
    (sum, item) => sum + item.unitPrice.amountMinor * item.quantity,
    0,
  );
  if (calculatedTotal !== proposedOrder.total.amountMinor) {
    addGlobalFinding(finding(
      "INVALID_ARITHMETIC",
      "critical",
      "The proposed total does not equal the sum of item prices multiplied by quantities.",
    ), true);
  }
  if (proposedOrder.total.amountMinor > mandate.budget.amountMinor) {
    addGlobalFinding(finding(
      "BUDGET_EXCEEDED",
      "critical",
      "The proposed total exceeds the mandate budget.",
    ), true);
  }

  if (new Set(proposedOrder.evidenceIds).size !== proposedOrder.evidenceIds.length) {
    addGlobalFinding(finding(
      "UNTRUSTED_EVIDENCE",
      "critical",
      "The proposal contains duplicate evidence references.",
    ), true);
  }

  const unknownOrderEvidence = proposedOrder.evidenceIds.filter((id) => !recordsById.has(id));
  if (unknownOrderEvidence.length > 0) {
    addGlobalFinding(finding(
      "UNTRUSTED_EVIDENCE",
      "critical",
      "The proposal references evidence that is absent from the trusted evidence set.",
      undefined,
      unknownOrderEvidence,
    ), true);
  }

  const orphanedEvidence = evidence.filter((record) =>
    record.evidence.itemId !== undefined
    && !proposedOrder.items.some((item) => item.id === record.evidence.itemId),
  );
  if (orphanedEvidence.length > 0) {
    addGlobalFinding(finding(
      "UNTRUSTED_EVIDENCE",
      "critical",
      "Trusted evidence metadata refers to an item outside the proposal.",
      undefined,
      orphanedEvidence.map((record) => record.evidence.id),
    ), true);
  }

  const semanticDecisions = input.semanticVerdict
    ? mergeSemanticDecisions(mandate, proposedOrder, evidence, input.semanticVerdict)
    : evaluateReplaySemantics(mandate, proposedOrder, evidence);

  for (const item of proposedOrder.items) {
    const target = decisions.get(item.id)!;
    const semantic = semanticDecisions.get(item.id)!;
    target.decision = semantic.decision;
    target.reasons = [...semantic.reasons];
    for (const globalFinding of globalBlockingFindings) {
      downgrade(target, "BLOCK", { ...globalFinding, itemId: item.id });
    }

    const references = allEvidenceReferences(item);
    const invalidReferences = [
      ...invalidEvidenceReferences(item.necessityEvidenceIds, item, proposedOrder, recordsById),
      ...item.compatibility.flatMap((compatibility) => invalidEvidenceReferences(
        compatibility.evidenceIds,
        item,
        proposedOrder,
        recordsById,
        compatibility.withItemId,
      )),
    ];
    if (invalidReferences.length > 0) {
      downgrade(target, "BLOCK", finding(
        "UNTRUSTED_EVIDENCE",
        "critical",
        "An evidence reference, capture binding, or product identity is inconsistent with trusted metadata.",
        item.id,
        invalidReferences,
      ));
    }

    if (!item.catalogListing) {
      downgrade(target, "BLOCK", finding(
        "UNTRUSTED_EVIDENCE",
        "critical",
        "The item has no trusted catalog listing, so its identity and price cannot be verified.",
        item.id,
      ));
    } else if (item.catalogListing.unitPrice.currency !== item.unitPrice.currency
      || item.catalogListing.unitPrice.amountMinor !== item.unitPrice.amountMinor) {
      downgrade(target, "BLOCK", finding(
        "PRICE_MISMATCH",
        "critical",
        "The proposed unit price differs from the trusted catalog price for this offer.",
        item.id,
      ));
    }

    const quarantinedIds = references.filter((id) =>
      recordsById.get(id)?.security.status === "QUARANTINED",
    );
    if (quarantinedIds.length > 0) {
      downgrade(target, "BLOCK", finding(
        "PROMPT_INJECTION",
        "critical",
        "Quarantined evidence cannot support an item approval.",
        item.id,
        quarantinedIds,
      ));
    }

    const usableNecessity = usableEvidence(
      item.necessityEvidenceIds,
      item,
      proposedOrder,
      recordsById,
    ).filter((record) => hasClaim(record.evidence, "necessity"));
    if (usableNecessity.length === 0 && target.decision === "ALLOW") {
      downgrade(target, "REVIEW", finding(
        "INSUFFICIENT_NECESSITY",
        "warning",
        "No clean necessity claim is available in the trusted evidence graph.",
        item.id,
        item.necessityEvidenceIds,
      ));
    }

    for (const compatibility of item.compatibility) {
      if (compatibility.withItemId !== null
        && !proposedOrder.items.some((candidate) => candidate.id === compatibility.withItemId)) {
        downgrade(target, "BLOCK", finding(
          "UNMET_DEPENDENCY",
          "critical",
          "A required compatibility target is absent from the proposed order.",
          item.id,
          compatibility.evidenceIds,
        ));
        continue;
      }

      const compatibilityRecords = usableEvidence(
        compatibility.evidenceIds,
        item,
        proposedOrder,
        recordsById,
        compatibility.withItemId,
      );
      const incompatibilityEvidence = compatibilityRecords.filter((record) =>
        hasClaim(record.evidence, "incompatibility"),
      );
      if (incompatibilityEvidence.length > 0) {
        downgrade(target, "BLOCK", finding(
          "INCOMPATIBLE",
          "critical",
          "Trusted evidence explicitly marks the item as incompatible with a required device.",
          item.id,
          incompatibilityEvidence.map((record) => record.evidence.id),
        ));
        continue;
      }

      const compatibilityEvidence = compatibilityRecords.filter((record) =>
        hasClaim(record.evidence, "compatibility"),
      );
      if (compatibilityEvidence.length === 0 && target.decision === "ALLOW") {
        downgrade(target, "REVIEW", finding(
          "INSUFFICIENT_COMPATIBILITY",
          "warning",
          "A compatibility requirement lacks a clean compatibility claim.",
          item.id,
          compatibility.evidenceIds,
        ));
      }
    }

    const necessityRecords = item.necessityEvidenceIds.flatMap((id) => {
      const record = recordsById.get(id);
      return record && hasClaim(record.evidence, "necessity") ? [record] : [];
    });
    const directlyRequested = necessityRecords.some((record) => record.evidence.source.sourceClass === "user")
      || ((input.semanticVerdict === undefined || semantic.decision === "ALLOW")
        && isDirectlyRequested(mandate.goal, item));
    const independentNecessity = usableNecessity.some((record) =>
      isIndependentFromSeller(record, item, evidence),
    );
    const independentCompatibility = item.compatibility.some((compatibility) =>
      usableEvidence(
        compatibility.evidenceIds,
        item,
        proposedOrder,
        recordsById,
        compatibility.withItemId,
      )
        .filter((record) => hasClaim(record.evidence, "compatibility"))
        .some((record) => isIndependentFromSeller(record, item, evidence)),
    );
    const sellerOnly = necessityRecords.length > 0
      && necessityRecords.every((record) => record.evidence.source.sourceClass === "seller");
    const unprovenNecessity = necessityRecords.length > 0
      && !directlyRequested
      && !independentNecessity
      && !independentCompatibility;

    if (unprovenNecessity) {
      downgrade(target, "REVIEW", finding(
        sellerOnly ? "SELLER_ONLY_NECESSITY" : "INSUFFICIENT_NECESSITY",
        "warning",
        sellerOnly
          ? "Seller-owned evidence alone cannot establish the necessity of an additional item."
          : "The available evidence does not independently establish this additional item's necessity.",
        item.id,
        necessityRecords.map((record) => record.evidence.id),
      ));
    }
  }

  enforceDependencyClosure(proposedOrder, decisions);

  const itemDecisions: ItemDecision[] = proposedOrder.items.map((item) => {
    const decision = decisions.get(item.id)!;
    if (decision.decision !== "ALLOW" && decision.reasons.length === 0) {
      decision.reasons.push(finding(
        "OTHER",
        decision.decision === "BLOCK" ? "critical" : "warning",
        "The item requires review because no approval rationale was supplied.",
        item.id,
      ));
    }
    return {
      itemId: item.id,
      decision: decision.decision,
      reasons: decision.reasons.slice(0, 20),
    };
  });

  const allowedIds = new Set(
    itemDecisions.filter((item) => item.decision === "ALLOW").map((item) => item.itemId),
  );
  const hasBlocked = itemDecisions.some((item) => item.decision === "BLOCK");
  const coreItems = proposedOrder.items.filter((item) => isMandateCoreItem(mandate, item));
  const coreBlocked = coreItems.some((item) => decisions.get(item.id)?.decision === "BLOCK");
  const coreReview = coreItems.some((item) => decisions.get(item.id)?.decision === "REVIEW");
  const ungroundedPartial = coreItems.length === 0
    && allowedIds.size > 0
    && allowedIds.size < itemDecisions.length;
  if (coreBlocked || coreReview) {
    addGlobalFinding(finding(
      "MANDATE_CONFLICT",
      coreBlocked ? "critical" : "warning",
      "An explicitly requested core item is not approvable, so an accessory-only or incomplete order cannot be paid automatically.",
    ));
  }
  if (ungroundedPartial) {
    addGlobalFinding(finding(
      "INSUFFICIENT_NECESSITY",
      "warning",
      "No explicitly requested core item can be identified for the remaining partial order.",
    ));
  }
  const humanReviewRequired = hasExplicitHumanReviewConstraint(mandate);
  if (humanReviewRequired) {
    addGlobalFinding(finding(
      "MANDATE_CONFLICT",
      "warning",
      "A hard mandate constraint requires human review or manual approval; automatic order creation is disabled.",
    ));
  }
  // A partial order is payable only while every identifiable core requirement survives.
  const decision: Verdict["decision"] = humanReviewRequired && globalBlockingFindings.length === 0
    ? "REVIEW"
    : coreBlocked
      ? "BLOCK"
      : coreReview || ungroundedPartial
        ? "REVIEW"
        : aggregateDecision(itemDecisions, allowedIds);
  const allFindings = [...globalFindings];
  for (const itemDecision of itemDecisions) {
    for (const reason of itemDecision.reasons) addFinding(allFindings, reason);
  }

  const summary = buildSummary(decision, itemDecisions.length, allowedIds.size, hasBlocked);
  return VerdictSchema.parse({
    schemaVersion: "1",
    id: randomUUID(),
    mandateId: mandate.id,
    proposedOrderId: proposedOrder.id,
    decision,
    itemDecisions,
    findings: allFindings.slice(0, 50),
    summary,
    policyVersion: POLICY_VERSION,
    inputHash: computeSupervisorInputHash(mandate, proposedOrder, evidence),
    evaluatedAt: new Date().toISOString(),
  });
}

function evaluateReplaySemantics(
  mandate: Mandate,
  proposedOrder: ProposedOrder,
  evidence: EvidenceRecord[],
): Map<string, MutableDecision> {
  const recordsById = new Map(evidence.map((record) => [record.evidence.id, record]));
  const result = new Map<string, MutableDecision>();
  const necessityByItem = new Map<string, EvidenceRecord[]>();

  for (const item of proposedOrder.items) {
    const necessity = usableEvidence(
      item.necessityEvidenceIds,
      item,
      proposedOrder,
      recordsById,
    ).filter((record) => hasClaim(record.evidence, "necessity"));
    necessityByItem.set(item.id, necessity);
    const direct = necessity.some((record) => record.evidence.source.sourceClass === "user")
      || isDirectlyRequested(mandate.goal, item);
    const independent = necessity.some((record) => isIndependentFromSeller(record, item, evidence));
    result.set(item.id, {
      decision: necessity.length > 0 && (direct || independent) ? "ALLOW" : "REVIEW",
      reasons: [],
    });
  }

  // Compatibility edges propagate necessity from a viable, already supported item.
  // This is graph evaluation, not a list of product names or categories.
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of proposedOrder.items) {
      const current = result.get(item.id)!;
      if (current.decision === "ALLOW") continue;
      const supportedByDependency = item.compatibility.some((compatibility) => {
        if (compatibility.withItemId === null
          || result.get(compatibility.withItemId)?.decision !== "ALLOW") return false;
        return usableEvidence(
          compatibility.evidenceIds,
          item,
          proposedOrder,
          recordsById,
          compatibility.withItemId,
        )
          .filter((record) => hasClaim(record.evidence, "compatibility"))
          .some((record) => isIndependentFromSeller(record, item, evidence));
      });
      if (supportedByDependency && (necessityByItem.get(item.id)?.length ?? 0) > 0) {
        current.decision = "ALLOW";
        current.reasons = [];
        changed = true;
      }
    }
  }

  for (const item of proposedOrder.items) {
    const current = result.get(item.id)!;
    if (current.decision === "ALLOW") continue;
    const necessity = necessityByItem.get(item.id) ?? [];
    current.decision = "REVIEW";
    current.reasons = [finding(
      necessity.length > 0 && necessity.every((record) => record.evidence.source.sourceClass === "seller")
        ? "SELLER_ONLY_NECESSITY"
        : "INSUFFICIENT_NECESSITY",
      "warning",
      "The mandate and trusted evidence do not establish item necessity strongly enough for automatic purchase.",
      item.id,
      item.necessityEvidenceIds,
    )];
  }
  return result;
}

function mergeSemanticDecisions(
  mandate: Mandate,
  proposedOrder: ProposedOrder,
  evidence: EvidenceRecord[],
  semanticVerdict: Verdict,
): Map<string, MutableDecision> {
  const parsed = VerdictSchema.parse(semanticVerdict);
  // Missing or malformed model output falls back to deterministic graph semantics.
  // The independent policy checks below still apply to every resulting decision.
  const byItem = evaluateReplaySemantics(mandate, proposedOrder, evidence);
  const recordsById = new Map(evidence.map((record) => [record.evidence.id, record]));

  const seen = new Set<string>();
  for (const semantic of parsed.itemDecisions) {
    const target = byItem.get(semantic.itemId);
    const item = proposedOrder.items.find((candidate) => candidate.id === semantic.itemId);
    if (!target || !item) continue;

    const reasons = semantic.reasons
      .filter((reason) => semanticFindingCodes.has(reason.code))
      .map((reason) => ({ ...reason, itemId: semantic.itemId }));
    const itemEvidenceIds = new Set(allEvidenceReferences(item));
    const hasForeignEvidence = reasons.some((reason) =>
      reason.evidenceIds.some((evidenceId) => !itemEvidenceIds.has(evidenceId)),
    );
    const hasMismatchedReasonItem = semantic.reasons.some((reason) =>
      reason.itemId !== undefined && reason.itemId !== semantic.itemId,
    );
    // Never let the model transfer one item's rationale to another item.
    if (hasForeignEvidence || hasMismatchedReasonItem) continue;

    const cleanNecessity = usableEvidence(
      item.necessityEvidenceIds,
      item,
      proposedOrder,
      recordsById,
    ).filter((record) => hasClaim(record.evidence, "necessity"));
    const directlyRequested = isDirectlyRequested(mandate.goal, item)
      || cleanNecessity.some((record) => record.evidence.source.sourceClass === "user");
    const isContradictoryNecessityReview = semantic.decision === "REVIEW"
      && reasons.length > 0
      && reasons.every((reason) => reason.code === "INSUFFICIENT_NECESSITY")
      && directlyRequested
      && cleanNecessity.length > 0;
    // A direct mandate plus clean necessity evidence already establishes necessity.
    // Keep every other semantic objection, including BLOCK and mandate conflicts.
    if (isContradictoryNecessityReview) continue;

    const hasBlockingViolation = reasons.some((reason) => reason.severity === "critical"
      && (reason.code === "MANDATE_CONFLICT" || reason.code === "INCOMPATIBLE"));
    const semanticDecision = hasBlockingViolation ? "BLOCK" : semantic.decision;
    const decision = seen.has(semantic.itemId)
      ? moreRestrictive(target.decision, semanticDecision)
      : semanticDecision;
    const combinedReasons = seen.has(semantic.itemId)
      ? [...target.reasons, ...reasons]
      : reasons;
    byItem.set(semantic.itemId, {
      decision,
      reasons: decision === "ALLOW" ? [] : combinedReasons,
    });
    seen.add(semantic.itemId);
  }

  for (const [itemId, decision] of byItem) {
    if (decision.decision === "ALLOW") {
      decision.reasons = [];
    } else if (decision.reasons.length === 0) {
      decision.reasons = [finding(
        "OTHER",
        decision.decision === "BLOCK" ? "critical" : "warning",
        "The semantic supervisor rejected the item without a structured reason.",
        itemId,
      )];
    }
  }
  return byItem;
}

function enforceDependencyClosure(
  proposedOrder: ProposedOrder,
  decisions: Map<string, MutableDecision>,
): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of proposedOrder.items) {
      const current = decisions.get(item.id)!;
      for (const compatibility of item.compatibility) {
        if (compatibility.withItemId === null) continue;
        const dependency = decisions.get(compatibility.withItemId);
        if (dependency?.decision === "ALLOW") continue;
        const previousDecision = current.decision;
        const nextDecision = previousDecision === "ALLOW"
          ? dependency?.decision === "REVIEW" ? "REVIEW" : "BLOCK"
          : previousDecision;
        downgrade(current, nextDecision, finding(
          "UNMET_DEPENDENCY",
          nextDecision === "REVIEW" ? "warning" : "critical",
          "The item cannot be approved without its required dependency.",
          item.id,
          compatibility.evidenceIds,
        ));
        if (nextDecision !== previousDecision) changed = true;
      }
    }
  }
}

function aggregateDecision(
  itemDecisions: ItemDecision[],
  allowedIds: Set<string>,
): Verdict["decision"] {
  if (allowedIds.size === itemDecisions.length) return "ALLOW";
  if (allowedIds.size > 0) return "PARTIAL_ALLOW";
  return itemDecisions.some((item) => item.decision === "BLOCK") ? "BLOCK" : "REVIEW";
}

function invalidEvidenceReferences(
  ids: string[],
  item: ProposedOrderItem,
  proposedOrder: ProposedOrder,
  recordsById: Map<string, EvidenceRecord>,
  relatedItemId?: string | null,
): string[] {
  const relatedItem = proposedOrder.items.find((candidate) => candidate.id === relatedItemId);
  return [...new Set(ids)].filter((id) => {
    const record = recordsById.get(id);
    if (!record
      || !proposedOrder.evidenceIds.includes(id)
      || record.security.captureId !== record.evidence.captureId
      || record.evidence.itemId !== item.id) return true;
    if (record.evidence.source.sourceClass === "seller"
      || record.evidence.source.sourceClass === "aggregator") {
      return record.evidence.source.storeId !== item.storeId
        && record.evidence.source.storeId !== relatedItem?.storeId;
    }
    return false;
  });
}

function usableEvidence(
  ids: string[],
  item: ProposedOrderItem,
  proposedOrder: ProposedOrder,
  recordsById: Map<string, EvidenceRecord>,
  relatedItemId?: string | null,
): EvidenceRecord[] {
  const invalid = new Set(invalidEvidenceReferences(
    ids,
    item,
    proposedOrder,
    recordsById,
    relatedItemId,
  ));
  return [...new Set(ids)].flatMap((id) => {
    const record = recordsById.get(id);
    if (!record || invalid.has(id) || record.security.status !== "CLEAN") return [];
    return [record];
  });
}

function isIndependentFromSeller(
  record: EvidenceRecord,
  item: ProposedOrderItem,
  allEvidence: EvidenceRecord[],
): boolean {
  if (record.evidence.source.sourceClass === "seller"
    || record.evidence.source.sourceClass === "aggregator") return false;
  const sellerPublishers = new Set(
    allEvidence
      .filter((candidate) => candidate.evidence.source.sourceClass === "seller"
        && candidate.evidence.source.storeId === item.storeId)
      .map((candidate) => candidate.evidence.source.publisherId),
  );
  return !sellerPublishers.has(record.evidence.source.publisherId);
}

function hasExplicitHumanReviewConstraint(mandate: Mandate): boolean {
  return mandate.constraints.some((constraint) => {
    if (constraint.enforcement !== "hard") return false;
    const text = constraint.text.normalize("NFKC").toLocaleLowerCase().replace(/[’‘]/g, "'");
    const humanControl = /\b(?:(?:human|manual)\s+(?:review|approval|sign[- ]?off)|(?:review|approval|sign[- ]?off)\s+by\s+(?:an?\s+)?(?:human|person|operator))\b/i;
    const obligation = /\b(?:require[ds]?|requiring|must|obtain|get|seek|wait\s+for|before|only|do\s+not|don't|no\s+(?:automatic|automated))\b/i;
    const negated = /\b(?:do\s+not|don't|does\s+not|is\s+not|are\s+not|not|without|no)\b[^.;!?]{0,60}\b(?:human|manual)\s+(?:review|approval|sign[- ]?off)\b/i.test(text)
      || /\b(?:human|manual)\s+(?:review|approval|sign[- ]?off)\s+(?:is\s+)?not\s+required\b/i.test(text);
    return humanControl.test(text) && obligation.test(text) && !negated;
  });
}

export function isMandateCoreItem(mandate: Mandate, item: ProposedOrderItem): boolean {
  return isDirectlyRequested(mandate.goal, item);
}

/**
 * An item counts as directly requested only when the user's own goal wording
 * names the kind of product that the trusted catalog says this offer is.
 *
 * Both inputs are outside the Actor's control: the goal is written by the user
 * and the listing is attached by the server from the catalog. The Actor's
 * `name`, `description`, and `purpose` are deliberately ignored, so a proposing
 * agent cannot promote an upsell to a "requested" item by describing it that way.
 */
function isDirectlyRequested(goal: string, item: ProposedOrderItem): boolean {
  const listing = item.catalogListing;
  if (!listing) return false;
  const goalTokens = tokens(goal);
  // Prefer the catalog's product-type label; fall back to the catalog title
  // when the source (Channel3) supplies no category.
  const listingTokens = tokens(listing.category ?? listing.title);
  for (const term of listingTokens) {
    for (const word of goalTokens) {
      // Prefix matching tolerates inflection (e.g. "планшета" for "планшет").
      if (word === term || (term.length >= 5 && word.startsWith(term))) return true;
    }
  }
  return false;
}

function tokens(text: string): Set<string> {
  return new Set(
    text
      .normalize("NFKC")
      .toLocaleLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .map((token) => token.replace(/(ing|ed|es|s)$/u, ""))
      .filter((token) => (token.length > 2 || token === "tv") && !stopWords.has(token)),
  );
}

function hasClaim(evidence: Evidence, kind: Evidence["claims"][number]["kind"]): boolean {
  return evidence.claims.some((claim) => claim.kind === kind);
}

function allEvidenceReferences(item: ProposedOrderItem): string[] {
  return [...new Set([
    ...item.necessityEvidenceIds,
    ...item.compatibility.flatMap((compatibility) => compatibility.evidenceIds),
  ])];
}

function finding(
  code: PolicyFinding["code"],
  severity: PolicyFinding["severity"],
  message: string,
  itemId?: string,
  evidenceIds: string[] = [],
): PolicyFinding {
  return {
    code,
    severity,
    message,
    ...(itemId === undefined ? {} : { itemId }),
    evidenceIds: [...new Set(evidenceIds)].slice(0, 20),
  };
}

function downgrade(target: MutableDecision, decision: Decision, reason: PolicyFinding): void {
  target.decision = moreRestrictive(target.decision, decision);
  addFinding(target.reasons, reason);
}

function moreRestrictive(left: Decision, right: Decision): Decision {
  const rank: Record<Decision, number> = { ALLOW: 0, REVIEW: 1, BLOCK: 2 };
  return rank[right] > rank[left] ? right : left;
}

function addFinding(findings: PolicyFinding[], candidate: PolicyFinding): void {
  const key = canonicalFindingKey(candidate);
  if (!findings.some((existing) => canonicalFindingKey(existing) === key)) {
    findings.push(candidate);
  }
}

function canonicalFindingKey(value: PolicyFinding): string {
  return JSON.stringify([
    value.code,
    value.itemId,
    value.message,
    [...value.evidenceIds].sort(),
  ]);
}

function assertUniqueIds(proposedOrder: ProposedOrder, evidence: EvidenceRecord[]): void {
  const itemIds = proposedOrder.items.map((item) => item.id);
  if (new Set(itemIds).size !== itemIds.length) {
    throw new Error("Cannot produce verdict coverage for duplicate item IDs.");
  }
  const evidenceIds = evidence.map((record) => record.evidence.id);
  if (new Set(evidenceIds).size !== evidenceIds.length) {
    throw new Error("Trusted evidence IDs must be unique.");
  }
}

function buildSummary(
  decision: Verdict["decision"],
  itemCount: number,
  allowedCount: number,
  hasBlocked: boolean,
): string {
  switch (decision) {
    case "ALLOW":
      return `All ${itemCount} items satisfy the deterministic policy and semantic mandate checks.`;
    case "PARTIAL_ALLOW":
      return `${allowedCount} of ${itemCount} items form a viable allowed subset after dependency closure.`;
    case "REVIEW":
      return "No automatically payable subset is available; unresolved evidence or dependency questions require review.";
    case "BLOCK":
      return hasBlocked
        ? "No viable payable subset remains because one or more items have blocking findings."
        : "The proposed order is blocked by deterministic policy findings.";
  }
}
