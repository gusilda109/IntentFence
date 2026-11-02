"use client";

import type { RunView } from "@/shared/contracts";
import { AlertIcon, CardIcon, CheckIcon, ClockIcon, ExternalLinkIcon, LockIcon, RefreshIcon } from "@/components/icons";
import { SectionPanel } from "@/components/section-panel";
import { StatusBadge, type BadgeTone } from "@/components/status-badge";
import { formatDateTime } from "@/components/format";

type DisplayStatus = "NOT_REQUESTED" | "PENDING" | "CREATED" | "RETRYABLE" | "UNKNOWN";

const displayTones: Record<DisplayStatus, BadgeTone> = {
  NOT_REQUESTED: "neutral",
  PENDING: "info",
  CREATED: "paypal",
  RETRYABLE: "warning",
  UNKNOWN: "warning",
};

interface PayPalStatusProps {
  run: RunView;
  executing: boolean;
  executeError: string | null;
  onExecute: () => void;
}

export function PayPalStatus({ run, executing, executeError, onExecute }: PayPalStatusProps) {
  const payment = run.payment;
  const displayStatus: DisplayStatus = payment
    ? {
        PAYMENT_PENDING: "PENDING",
        PAYPAL_CREATED: "CREATED",
        PAYMENT_RETRYABLE: "RETRYABLE",
        PAYMENT_UNKNOWN: "UNKNOWN",
      }[payment.status] as DisplayStatus
    : run.status === "PAYMENT_PENDING" ? "PENDING" : "NOT_REQUESTED";

  const canExecute = run.status === "APPROVED" || run.status === "PAYMENT_RETRYABLE" || run.status === "PAYMENT_UNKNOWN";
  const stateContent = {
    NOT_REQUESTED: {
      title: "No PayPal order requested",
      text: run.verdict?.decision === "BLOCK" || run.verdict?.decision === "REVIEW"
        ? "The current verdict does not authorize payment execution."
        : "No Sandbox order creation has been requested for this run.",
      icon: <LockIcon />,
    },
    PENDING: {
      title: "Creating Sandbox order",
      text: "The executor is processing the existing approved snapshot.",
      icon: <ClockIcon />,
    },
    CREATED: {
      title: "Sandbox order created",
      text: "PayPal returned an order for the approved snapshot. This is not a completed payment.",
      icon: <CheckIcon />,
    },
    RETRYABLE: {
      title: "Sandbox order needs retry",
      text: "Order creation did not complete. Retry the existing run without creating a new mandate.",
      icon: <RefreshIcon />,
    },
    UNKNOWN: {
      title: "Sandbox order outcome unknown",
      text: "A timeout or network uncertainty was saved. Retry uses the same approved order and request identity.",
      icon: <AlertIcon />,
    },
  }[displayStatus];

  const executeLabel = run.status === "APPROVED"
    ? "Create Sandbox order"
    : run.status === "PAYMENT_UNKNOWN"
      ? "Retry with same request"
      : "Retry Sandbox order";

  return (
    <SectionPanel
      title="PayPal Status"
      description="Order creation state, separate from policy approval."
      icon={<CardIcon />}
      testId="paypal-status"
    >
      <div className="paypal-mode">
        <span className="paypal-wordmark">PayPal</span>
        <StatusBadge tone={run.replay ? "warning" : "paypal"} dot>
          {run.replay ? "Replay — simulated PayPal" : "PayPal Sandbox"}
        </StatusBadge>
      </div>
      <div className={`paypal-state paypal-state-${displayStatus.toLowerCase()}`} aria-live="polite">
        <span className="paypal-state-icon">{stateContent.icon}</span>
        <StatusBadge tone={displayTones[displayStatus]} dot>{displayStatus}</StatusBadge>
        <h3>{stateContent.title}</h3>
        <p>{stateContent.text}</p>
        {displayStatus === "CREATED" ? <p className="not-captured">NOT captured</p> : null}
        {payment ? (
          <dl className="payment-details">
            {payment.paypalOrderId ? (
              <div className="payment-detail"><dt>Order ID</dt><dd><code>{payment.paypalOrderId}</code></dd></div>
            ) : null}
            {payment.paypalStatus ? (
              <div className="payment-detail"><dt>PayPal status</dt><dd>{payment.paypalStatus}</dd></div>
            ) : null}
            {payment.errorCode ? (
              <div className="payment-detail"><dt>Error code</dt><dd><code>{payment.errorCode}</code></dd></div>
            ) : null}
            <div className="payment-detail"><dt>Updated</dt><dd>{formatDateTime(payment.updatedAt)}</dd></div>
          </dl>
        ) : null}
      </div>

      {canExecute || payment?.approveUrl || executeError ? (
        <div className="paypal-actions">
          {canExecute ? (
            <div>
              <button type="button" className="button button-secondary" data-testid="execute-payment" onClick={onExecute} disabled={executing}>
                {executing ? <span className="spinner spinner-dark" aria-hidden="true" /> : <RefreshIcon />}
                {executing ? "Executing…" : executeLabel}
              </button>
              <p className="execute-note">Retries this run only; no new run is created.</p>
            </div>
          ) : null}
          {payment?.approveUrl ? (
            <a className="button paypal-approve" href={payment.approveUrl} target="_blank" rel="noreferrer">
              Open PayPal approval <ExternalLinkIcon />
            </a>
          ) : null}
          {executeError ? <div className="payment-error" role="alert">{executeError}</div> : null}
        </div>
      ) : null}
      <p className="paypal-footnote"><LockIcon /> IntentFence creates Sandbox orders only. It never captures payment in this MVP.</p>
    </SectionPanel>
  );
}
