"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { RunViewSchema, type CatalogSource, type CreateRunInput } from "@/shared/contracts";
import type { ApiError } from "@/shared/views";
import { ArrowRightIcon, PlusIcon, ShieldCheckIcon, SparkIcon, TrashIcon } from "@/components/icons";

interface ConstraintDraft {
  id: string;
  text: string;
  enforcement: "hard" | "soft";
}

interface RunOperation {
  body: string;
  key: string;
}

const coffeeGoal = "Set up a tablet-based point of sale for a coffee shop so staff can take orders and print customer receipts.";
const incompatiblePrinterGoal = "Set up receipt printing for my existing HubTab S10 tablet.";
const protectionPackGoal = "Buy the Samsung 55-inch Class The Frame Pro Neo QLED 4K TV (2026) with the 26 Month Protection Pack for my living room.";
const noProtectionPackConstraint = "Do not include extended warranties, protection packs, or protection plans.";

function makeConstraint(text = "", enforcement: "hard" | "soft" = "hard"): ConstraintDraft {
  return { id: crypto.randomUUID(), text, enforcement };
}

function dollarsToMinorUnits(value: string): number | null {
  const match = value.trim().match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return null;

  const whole = Number(match[1]);
  const cents = Number((match[2] ?? "").padEnd(2, "0") || "0");
  const amountMinor = whole * 100 + cents;

  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0 || amountMinor > 10_000_000) {
    return null;
  }
  return amountMinor;
}

function apiErrorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object" && "error" in payload) {
    const error = (payload as ApiError).error;
    if (error && typeof error.message === "string") return error.message;
  }
  return fallback;
}

export function MandateForm() {
  const router = useRouter();
  const operationRef = useRef<RunOperation | null>(null);
  const [goal, setGoal] = useState("");
  const [budget, setBudget] = useState("");
  const [constraints, setConstraints] = useState<ConstraintDraft[]>([]);
  const [catalogSource, setCatalogSource] = useState<CatalogSource>("fixtures");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function loadCoffeeExample() {
    setCatalogSource("fixtures");
    setGoal(coffeeGoal);
    setBudget("800");
    setConstraints([
      { id: crypto.randomUUID(), text: "Keep the complete order within the stated budget.", enforcement: "hard" },
      { id: crypto.randomUUID(), text: "Only include equipment necessary for the stated checkout workflow.", enforcement: "hard" },
      { id: crypto.randomUUID(), text: "Prefer compact equipment with documented compatibility.", enforcement: "soft" },
    ]);
    setError(null);
  }

  function loadIncompatiblePrinterExample() {
    setCatalogSource("fixtures");
    setGoal(incompatiblePrinterGoal);
    setBudget("250");
    setConstraints([
      { id: crypto.randomUUID(), text: "The printer must be compatible with the existing HubTab S10.", enforcement: "hard" },
    ]);
    setError(null);
  }

  function loadProtectionPackExample() {
    setCatalogSource("channel3");
    setGoal(protectionPackGoal);
    setBudget("1500");
    setConstraints([
      { id: crypto.randomUUID(), text: noProtectionPackConstraint, enforcement: "hard" },
    ]);
    setError(null);
  }

  function updateConstraint(id: string, update: Partial<Omit<ConstraintDraft, "id">>) {
    setConstraints((current) => current.map((item) => item.id === id ? { ...item, ...update } : item));
  }

  async function submitMandate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const trimmedGoal = goal.trim();
    const amountMinor = dollarsToMinorUnits(budget);
    if (!trimmedGoal) {
      setError("Describe the purchase goal before starting the review.");
      return;
    }
    if (amountMinor === null) {
      setError("Enter a USD budget from $0.01 to $100,000, with no more than two decimal places.");
      return;
    }
    if (constraints.some((constraint) => !constraint.text.trim())) {
      setError("Complete or remove each empty constraint.");
      return;
    }

    const input: CreateRunInput = {
      goal: trimmedGoal,
      budget: amountMinor,
      constraints: constraints.map(({ text, enforcement }) => ({ text: text.trim(), enforcement })),
      catalogSource,
    };
    const serializedBody = JSON.stringify(input);
    if (operationRef.current?.body !== serializedBody) {
      operationRef.current = { body: serializedBody, key: crypto.randomUUID() };
    }
    const operation = operationRef.current;

    setSubmitting(true);
    try {
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": operation.key,
        },
        body: serializedBody,
      });
      const payload: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(apiErrorMessage(payload, "The run could not be started. Please try again."));
      }
      const result = RunViewSchema.safeParse(payload);
      if (!result.success) {
        throw new Error("The server returned an invalid run snapshot. No further action was taken.");
      }
      router.push(`/runs/${result.data.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The run could not be started. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mandate-card">
      <div className="mandate-card-header">
        <div>
          <p className="panel-eyebrow">New purchase review</p>
          <h2>Define your mandate</h2>
          <p>Set the intent. The evidence will determine the order.</p>
        </div>
        <span className="mandate-shield"><ShieldCheckIcon /></span>
      </div>

      <form onSubmit={submitMandate} data-testid="mandate-form" noValidate>
        <fieldset className="catalog-source-field" disabled={submitting}>
          <legend className="field-label">Product data source</legend>
          <div className="catalog-source-control" role="group" aria-label="Product data source">
            <button
              type="button"
              className={catalogSource === "fixtures" ? "is-selected" : ""}
              aria-pressed={catalogSource === "fixtures"}
              data-testid="catalog-source-fixtures"
              onClick={() => { setCatalogSource("fixtures"); setError(null); }}
            >
              Demo fixtures
            </button>
            <button
              type="button"
              className={catalogSource === "channel3" ? "is-selected" : ""}
              aria-pressed={catalogSource === "channel3"}
              data-testid="catalog-source-channel3"
              onClick={() => { setCatalogSource("channel3"); setError(null); }}
            >
              Channel3 · live data
            </button>
          </div>
          <p className="field-help">
            {catalogSource === "fixtures"
              ? "Offline deterministic scenarios. No external catalog requests."
              : "Real product discovery through the server-side Channel3 API. Requires CHANNEL3_API_KEY; errors never fall back to fixtures."}
          </p>
        </fieldset>
        <div className="form-field">
          <div className="field-label-row">
            <label htmlFor="goal" className="field-label">Purchase goal</label>
            <span className="field-meta">{goal.length} / 2,000</span>
          </div>
          <textarea
            id="goal"
            data-testid="goal-input"
            className="text-area goal-input"
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
            placeholder="Describe what you want to accomplish, not which products to buy…"
            maxLength={2000}
            rows={4}
            required
            disabled={submitting}
          />
          <p className="field-help">Use an open-ended outcome. Product selection happens during the review.</p>
        </div>

        <div className="form-field">
          <label htmlFor="budget" className="field-label">Maximum budget</label>
          <div className="budget-input-wrap">
            <span className="budget-prefix" aria-hidden="true">$</span>
            <input
              id="budget"
              data-testid="budget-input"
              className="text-input budget-input"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={budget}
              onChange={(event) => setBudget(event.target.value)}
              placeholder="800.00"
              aria-describedby="budget-help"
              required
              disabled={submitting}
            />
            <span className="budget-currency">USD</span>
          </div>
          <p id="budget-help" className="field-help">Final order total cannot exceed this amount.</p>
        </div>

        <fieldset className="constraints-fieldset" disabled={submitting}>
          <legend className="field-label">Constraints <span>(optional)</span></legend>
          {constraints.length === 0 ? (
            <p className="constraints-empty">Add hard limits or soft preferences to guide the review.</p>
          ) : (
            <div className="constraint-list">
              {constraints.map((constraint, index) => (
                <div className="constraint-row" key={constraint.id}>
                  <span className="constraint-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                  <div className="constraint-controls">
                    <label className="sr-only" htmlFor={`constraint-${constraint.id}`}>Constraint {index + 1}</label>
                    <input
                      id={`constraint-${constraint.id}`}
                      className="text-input"
                      value={constraint.text}
                      onChange={(event) => updateConstraint(constraint.id, { text: event.target.value })}
                      placeholder="e.g. Must work with my existing tablet"
                      maxLength={500}
                    />
                    <div className="constraint-row-bottom">
                      <label className="sr-only" htmlFor={`enforcement-${constraint.id}`}>Enforcement for constraint {index + 1}</label>
                      <select
                        id={`enforcement-${constraint.id}`}
                        className={`select-input enforcement-${constraint.enforcement}`}
                        value={constraint.enforcement}
                        onChange={(event) => updateConstraint(constraint.id, { enforcement: event.target.value as "hard" | "soft" })}
                      >
                        <option value="hard">Hard constraint</option>
                        <option value="soft">Soft preference</option>
                      </select>
                      <button
                        type="button"
                        className="icon-button remove-constraint"
                        onClick={() => setConstraints((current) => current.filter((item) => item.id !== constraint.id))}
                        aria-label={`Remove constraint ${index + 1}`}
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <button
            type="button"
            className="text-button"
            onClick={() => setConstraints((current) => [...current, makeConstraint()])}
            disabled={constraints.length >= 20}
          >
            <PlusIcon /> Add constraint
          </button>
        </fieldset>

        {error ? <div className="form-error" role="alert">{error}</div> : null}

        <div className="form-actions">
          <button type="button" className="example-button" onClick={loadCoffeeExample} disabled={submitting}>
            <SparkIcon /> Coffee shop example · $800
          </button>
          <button
            type="button"
            className="example-button"
            data-testid="incompatible-printer-example"
            onClick={loadIncompatiblePrinterExample}
            disabled={submitting}
          >
            <SparkIcon /> Incompatible printer demo · $250
          </button>
          <button
            type="button"
            className="example-button"
            data-testid="protection-pack-example"
            onClick={loadProtectionPackExample}
            disabled={submitting}
          >
            <SparkIcon /> Protection pack guard · Channel3
          </button>
          <button type="submit" className="button button-primary submit-run" data-testid="submit-run" disabled={submitting}>
            {submitting ? <span className="spinner" aria-hidden="true" /> : <ShieldCheckIcon />}
            {submitting ? "Reviewing mandate…" : "Start purchase review"}
            {!submitting ? <ArrowRightIcon /> : null}
          </button>
        </div>

        {submitting ? (
          <div className="run-progress-notice" role="status" aria-live="polite">
            <div>
              <strong>Building an evidence-backed review</strong>
              <p>This synchronous run may take a moment. Keep this page open.</p>
            </div>
            <ol>
              <li><span>1</span> Research items</li>
              <li><span>2</span> Verify evidence</li>
              <li><span>3</span> Evaluate verdict</li>
            </ol>
          </div>
        ) : null}
      </form>
    </div>
  );
}
