import type { PolicyFinding, RunView, Verdict } from "@/shared/contracts";
import { VerdictIcon } from "@/components/icons";
import { SectionPanel } from "@/components/section-panel";
import { StatusBadge, type BadgeTone } from "@/components/status-badge";
import { formatDateTime } from "@/components/format";

const verdictTones: Record<Verdict["decision"], BadgeTone> = {
  ALLOW: "success",
  PARTIAL_ALLOW: "success",
  BLOCK: "danger",
  REVIEW: "warning",
};

const severityTones: Record<PolicyFinding["severity"], BadgeTone> = {
  info: "info",
  warning: "warning",
  critical: "danger",
};

export function VerdictPanel({ run }: { run: RunView }) {
  const verdict = run.verdict;

  return (
    <SectionPanel
      title="Verdict"
      description="The saved policy decision for this exact proposal."
      icon={<VerdictIcon />}
      testId="verdict-panel"
      action={verdict ? <StatusBadge tone={verdictTones[verdict.decision]} dot>{verdict.decision}</StatusBadge> : null}
    >
      {!verdict ? (
        <div className="empty-state">
          <span className="empty-state-icon"><VerdictIcon /></span>
          <strong>Verdict not available</strong>
          <p>The supervisor has not produced a validated decision for this snapshot.</p>
        </div>
      ) : (
        <>
          <div className={`verdict-summary verdict-summary-${verdict.decision.toLowerCase()}`}>
            <p>{verdict.summary}</p>
          </div>
          <div className="verdict-meta">
            <span>Evaluated {formatDateTime(verdict.evaluatedAt)}</span>
            <span>Policy {verdict.policyVersion}</span>
          </div>
          <div className="decision-counts" aria-label="Item decision counts">
            {(["ALLOW", "REVIEW", "BLOCK"] as const).map((decision) => (
              <div className="decision-count" key={decision}>
                <strong>{verdict.itemDecisions.filter((item) => item.decision === decision).length}</strong>
                <span>{decision}</span>
              </div>
            ))}
          </div>
          <h3 className="findings-heading">Order-level findings</h3>
          {verdict.findings.length === 0 ? (
            <p className="no-findings">No additional order-level findings were recorded.</p>
          ) : (
            <ul className="findings-list">
              {verdict.findings.map((finding, index) => (
                <li className={`finding finding-${finding.severity}`} key={`${finding.code}-${index}`}>
                  <div className="finding-top">
                    <code>{finding.code}</code>
                    <StatusBadge tone={severityTones[finding.severity]}>{finding.severity}</StatusBadge>
                  </div>
                  <p>{finding.message}</p>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </SectionPanel>
  );
}
