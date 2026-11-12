"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { RunViewSchema, type CatalogSource, type CreateRunInput } from "@/shared/contracts";
import type { ApiError } from "@/shared/views";
import { ArrowRightIcon, PlusIcon, ShieldCheckIcon, SparkIcon, TrashIcon } from "@/components/icons";
import { CHANNEL3_EXAMPLES, type Channel3Example } from "@/components/channel3-examples";

interface ConstraintDraft {
  id: string;
  text: string;
  enforcement: "hard" | "soft";
}

interface RunOperation {
  body: string;
  key: string;
}

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

  function loadChannel3Example(example: Channel3Example) {
    setCatalogSource("channel3");
    setGoal(example.goal);
    setBudget(example.budget);
    setConstraints(example.constraints.map((constraint) =>
      makeConstraint(constraint.text, constraint.enforcement)));
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
          <p className="panel-eyebrow">New purchase</p>
          <h2>Let’s start with what you need</h2>
          <p>A plain-language goal is enough. We’ll handle the product research.</p>
        </div>
        <span className="mandate-shield"><ShieldCheckIcon /></span>
      </div>

      <form onSubmit={submitMandate} data-testid="mandate-form" noValidate>
        <div className="form-field">
          <div className="field-label-row">
            <label htmlFor="goal" className="field-label">What do you need?</label>
            <span className="field-meta">{goal.length} / 2,000</span>
          </div>
          <textarea
            id="goal"
            data-testid="goal-input"
            className="text-area goal-input"
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
            placeholder="For example: I need a simple checkout setup for my coffee shop…"
            maxLength={2000}
            rows={4}
            required
            disabled={submitting}
          />
          <p className="field-help">Describe the outcome you want. You don’t need to know which products to choose.</p>
        </div>

        <div className="form-field">
          <label htmlFor="budget" className="field-label">What’s your spending limit?</label>
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
          <p id="budget-help" className="field-help">We’ll keep the final order total at or below this amount.</p>
        </div>

        <fieldset className="catalog-source-field" disabled={submitting}>
          <legend className="field-label">Where should we look?</legend>
          <div className="catalog-source-control" role="group" aria-label="Where should we look?">
            <button
              type="button"
              className={catalogSource === "fixtures" ? "is-selected" : ""}
              aria-pressed={catalogSource === "fixtures"}
              data-testid="catalog-source-fixtures"
              onClick={() => { setCatalogSource("fixtures"); setError(null); }}
            >
              Demo catalog
            </button>
            <button
              type="button"
              className={catalogSource === "channel3" ? "is-selected" : ""}
              aria-pressed={catalogSource === "channel3"}
              data-testid="catalog-source-channel3"
              onClick={() => { setCatalogSource("channel3"); setError(null); }}
            >
              Live products · Channel3
            </button>
          </div>
          <p className="field-help">
            {catalogSource === "fixtures"
              ? "Explore a ready-made catalog without any external product requests."
              : "Research live products through Channel3. If the service is unavailable, we’ll show the error rather than switch catalogs."}
          </p>
        </fieldset>

        <fieldset className="constraints-fieldset" disabled={submitting}>
          <legend className="field-label">Any must-haves or preferences? <span>(optional)</span></legend>
          <p className="field-help">Hard constraints are deal-breakers. Soft preferences help us choose between suitable options.</p>
          {constraints.length === 0 ? (
            <p className="constraints-empty">Nothing added yet—your goal and budget are enough to get started.</p>
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
                      placeholder="For example: It must work with my existing tablet"
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
          <div className="example-group" aria-labelledby="examples-title">
            <p id="examples-title" className="field-label">Try a real Channel3 example</p>
            {CHANNEL3_EXAMPLES.map((example) => (
              <button
                type="button"
                className="example-button"
                data-testid={`channel3-example-${example.id}`}
                title={example.goal}
                onClick={() => loadChannel3Example(example)}
                disabled={submitting}
                key={example.id}
              >
                <SparkIcon /> {example.label}
              </button>
            ))}
            <p className="field-help">Real product searches. Replay/Live labels show the verified demo mode; current catalog results can change.</p>
          </div>
          <button type="submit" className="button button-primary submit-run" data-testid="submit-run" disabled={submitting}>
            {submitting ? <span className="spinner" aria-hidden="true" /> : <ShieldCheckIcon />}
            {submitting ? "Reviewing your purchase…" : "Review my purchase"}
            {!submitting ? <ArrowRightIcon /> : null}
          </button>
        </div>

        {submitting ? (
          <div className="run-progress-notice" role="status" aria-live="polite">
            <div>
              <strong>We’re researching your purchase</strong>
              <p>This can take a moment. Keep this page open while we check the options.</p>
            </div>
            <ol>
              <li><span>1</span> Research options</li>
              <li><span>2</span> Check the evidence</li>
              <li><span>3</span> Explain the recommendation</li>
            </ol>
          </div>
        ) : null}
      </form>
    </div>
  );
}
