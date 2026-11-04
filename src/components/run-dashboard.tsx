"use client";

import { useCallback, useEffect, useState } from "react";
import { RunViewSchema, type RunStatus, type RunView } from "@/shared/contracts";
import type { ApiError } from "@/shared/views";
import { AlertIcon, RefreshIcon } from "@/components/icons";
import { StatusBadge, type BadgeTone } from "@/components/status-badge";
import { formatMoney } from "@/components/format";
import { OrderItems } from "@/components/order-items";
import { EvidenceTimeline } from "@/components/evidence-timeline";
import { VerdictPanel } from "@/components/verdict-panel";
import { PayPalStatus } from "@/components/paypal-status";

const runStatusDisplay: Record<RunStatus, { label: string; tone: BadgeTone }> = {
  ACTOR_RUNNING: { label: "Research running", tone: "info" },
  PROPOSED: { label: "Order proposed", tone: "info" },
  SUPERVISOR_RUNNING: { label: "Policy review running", tone: "info" },
  BLOCKED: { label: "Blocked", tone: "danger" },
  REVIEW_REQUIRED: { label: "Review required", tone: "warning" },
  APPROVED: { label: "Approved", tone: "success" },
  PAYMENT_PENDING: { label: "Execution pending", tone: "info" },
  PAYPAL_CREATED: { label: "Sandbox order created", tone: "paypal" },
  PAYMENT_RETRYABLE: { label: "Execution retryable", tone: "warning" },
  PAYMENT_UNKNOWN: { label: "Execution unknown", tone: "warning" },
};

function apiErrorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object" && "error" in payload) {
    const error = (payload as ApiError).error;
    if (error && typeof error.message === "string") return error.message;
  }
  return fallback;
}

export function RunDashboard({ runId }: { runId: string }) {
  const [run, setRun] = useState<RunView | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [executeError, setExecuteError] = useState<string | null>(null);

  const loadRun = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(runId)}`, { cache: "no-store" });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(apiErrorMessage(payload, "The run snapshot could not be loaded."));
      }
      const result = RunViewSchema.safeParse(payload);
      if (!result.success) {
        throw new Error("The server returned an invalid run snapshot.");
      }
      setRun(result.data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The run snapshot could not be loaded.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [runId]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => void loadRun());
    return () => cancelAnimationFrame(frame);
  }, [loadRun]);

  async function executePayment() {
    setExecuting(true);
    setExecuteError(null);
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/execute`, { method: "POST" });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(apiErrorMessage(payload, "The existing approved order could not be executed."));
      }
      await loadRun();
    } catch (caught) {
      setExecuteError(caught instanceof Error ? caught.message : "The existing approved order could not be executed.");
    } finally {
      setExecuting(false);
    }
  }

  if (loading) {
    return (
      <main className="page-shell run-page run-loading" aria-label="Loading run snapshot" aria-busy="true">
        <div className="loading-heading" />
        <div className="loading-grid">
          <div className="loading-panel" />
          <div className="loading-panel loading-panel-small" />
        </div>
      </main>
    );
  }

  if (!run) {
    return (
      <main className="page-shell run-page">
        <div className="full-error" role="alert">
          <span className="empty-state-icon"><AlertIcon /></span>
          <h1>Run snapshot unavailable</h1>
          <p>{error ?? "The requested run could not be loaded."}</p>
          <button type="button" className="button button-primary" onClick={() => { setLoading(true); void loadRun(); }}>
            <RefreshIcon /> Try loading again
          </button>
        </div>
      </main>
    );
  }

  const status = runStatusDisplay[run.status];

  return (
    <main className="page-shell run-page">
      <div className="run-topbar">
        <div className="run-heading">
          <div className="run-heading-line">
            <h1>Your purchase review</h1>
            <StatusBadge tone={status.tone} dot>{status.label}</StatusBadge>
          </div>
          <p>Here’s what we found, and why.</p>
          <p className="run-id">Run {run.id} · Updated {new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(run.updatedAt))}</p>
        </div>
        <div className="run-topbar-actions">
          <StatusBadge tone={run.catalogSource === "channel3" ? "paypal" : "neutral"} dot>
            <span data-testid="catalog-source-result">{run.catalogSource === "channel3" ? "Channel3 · live data" : "Demo fixtures"}</span>
          </StatusBadge>
          <StatusBadge tone={run.replay ? "warning" : "paypal"} dot>
            {run.replay ? "Replay — simulated PayPal" : "PayPal Sandbox"}
          </StatusBadge>
          <button
            type="button"
            className={`button button-secondary refresh-button ${refreshing ? "is-refreshing" : ""}`}
            onClick={() => void loadRun()}
            disabled={refreshing || executing}
            aria-label="Refresh run snapshot"
          >
            <RefreshIcon /> {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {error ? <div className="run-alert" role="alert"><AlertIcon /><span>{error} The last valid snapshot remains visible.</span></div> : null}

      <section className="mandate-snapshot" aria-labelledby="mandate-snapshot-title">
        <div>
          <p className="snapshot-label" id="mandate-snapshot-title">Mandate</p>
          <p className="snapshot-goal">{run.mandate.goal}</p>
        </div>
        <div className="snapshot-budget">
          <p className="snapshot-label">Budget ceiling</p>
          <strong>{formatMoney(run.mandate.budget)}</strong>
          <span>USD · final prices</span>
        </div>
        {run.mandate.constraints.length > 0 ? (
          <div className="snapshot-constraints" aria-label="Mandate constraints">
            {run.mandate.constraints.map((constraint) => (
              <span className="constraint-chip" key={constraint.id}><b>{constraint.enforcement}</b>{constraint.text}</span>
            ))}
          </div>
        ) : null}
      </section>

      <div className="run-grid">
        <div className="run-main-column">
          <OrderItems run={run} />
          <EvidenceTimeline records={run.evidence} items={run.proposedOrder?.items ?? []} catalogSource={run.catalogSource} />
        </div>
        <aside className="run-side-column" aria-label="Decision and payment status">
          <VerdictPanel run={run} />
          <PayPalStatus run={run} executing={executing} executeError={executeError} onExecute={() => void executePayment()} />
        </aside>
      </div>
    </main>
  );
}
