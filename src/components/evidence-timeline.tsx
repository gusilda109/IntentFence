import type { CatalogSource, Evidence, EvidenceRecord, ProposedOrderItem } from "@/shared/contracts";
import { EvidenceIcon, ExternalLinkIcon } from "@/components/icons";
import { SectionPanel } from "@/components/section-panel";
import { StatusBadge } from "@/components/status-badge";
import { formatDateTime } from "@/components/format";

type SourceClass = Evidence["source"]["sourceClass"];

const sourceLabels: Record<SourceClass, string> = {
  seller: "Seller",
  aggregator: "Aggregator",
  manufacturer: "Manufacturer",
  independent_reference: "Independent reference",
  user: "User provided",
};

const independenceLabels: Record<SourceClass, string> = {
  seller: "Not independent of seller",
  aggregator: "Not independent; aggregated merchant data",
  manufacturer: "Manufacturer perspective",
  independent_reference: "Independent publisher",
  user: "User-supplied context",
};

interface EvidenceTimelineProps {
  records: EvidenceRecord[];
  items: ProposedOrderItem[];
  catalogSource: CatalogSource;
}

export function EvidenceTimeline({ records, items, catalogSource }: EvidenceTimelineProps) {
  const orderedRecords = [...records].sort((a, b) => a.evidence.retrievedAt.localeCompare(b.evidence.retrievedAt));
  const itemNames = new Map(items.map((item) => [item.id, item.name]));

  return (
    <SectionPanel
      title="Evidence behind the recommendation"
      description={`Sources, excerpts, and security checks supporting these items. Catalog: ${catalogSource === "channel3" ? "Channel3 · live data" : "Demo fixtures"}.`}
      icon={<EvidenceIcon />}
      testId="evidence-timeline"
      action={<StatusBadge tone="neutral">{records.length} {records.length === 1 ? "capture" : "captures"}</StatusBadge>}
    >
      {orderedRecords.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state-icon"><EvidenceIcon /></span>
          <strong>No evidence captured yet</strong>
          <p>The timeline will include source excerpts, independence metadata, item relationships, and security results.</p>
        </div>
      ) : (
        <ol className="timeline">
          {orderedRecords.map(({ evidence, security }) => {
            const relatedItem = evidence.itemId ? itemNames.get(evidence.itemId) : undefined;
            return (
              <li className="timeline-item" key={evidence.id}>
                <span className={`timeline-dot ${security.status === "QUARANTINED" ? "timeline-dot-quarantined" : ""}`} aria-hidden="true" />
                <time className="timeline-time" dateTime={evidence.retrievedAt}>{formatDateTime(evidence.retrievedAt)}</time>
                <div className="timeline-source">
                  <strong>{evidence.source.storeId}</strong>
                  <StatusBadge tone={evidence.source.sourceClass === "independent_reference" ? "success" : "info"}>
                    {sourceLabels[evidence.source.sourceClass]}
                  </StatusBadge>
                  <StatusBadge tone={security.status === "CLEAN" ? "success" : "danger"} dot>
                    {security.status}
                  </StatusBadge>
                </div>
                <div className="timeline-metadata">
                  <span>Publisher <b>{evidence.source.publisherId}</b></span>
                  <span>Independence <b>{independenceLabels[evidence.source.sourceClass]}</b></span>
                  <span>Item <b>{relatedItem ?? (evidence.itemId ? evidence.itemId : "Order-level evidence")}</b></span>
                </div>
                <blockquote className="timeline-excerpt">“{evidence.excerpt}”</blockquote>
                <ul className="timeline-claims" aria-label="Evidence claims">
                  {evidence.claims.map((claim, index) => (
                    <li className="claim-chip" key={`${claim.kind}-${index}`}><b>{claim.kind}</b>{claim.text}</li>
                  ))}
                </ul>
                {security.findings.length > 0 ? (
                  <div className="security-findings">
                    <strong>Security findings</strong>
                    <ul>
                      {security.findings.map((finding, index) => (
                        <li key={`${finding.code}-${index}`}><code>{finding.code}</code> — {finding.message}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <div className="timeline-footer">
                  <a href={evidence.source.url} target="_blank" rel="noreferrer">View source <ExternalLinkIcon /></a>
                  <details className="timeline-details">
                    <summary>Capture details</summary>
                    <p>Capture: {evidence.captureId}</p>
                    <p>Locator: {evidence.locator}</p>
                  </details>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </SectionPanel>
  );
}
