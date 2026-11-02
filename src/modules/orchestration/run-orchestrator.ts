import "server-only";
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import {
  CreateRunInputSchema,
  type CreateRunInput,
  type Mandate,
  type RunView,
} from "@/shared/contracts";
import type { PaymentExecutorPort } from "@/shared/ports";
import { sha256 } from "@/server/canonical-json";
import { runRepository, type RunRepository } from "@/server/run-repository";
import { configureLiveLlm } from "@/server/llm-runtime";
import { createActor, type Actor } from "@/modules/actor";
import { createSupervisor, type Supervisor } from "@/modules/supervisor";
import { createPaymentExecutor, MockPayPalClient } from "@/modules/payment";
import { buildApprovedOrder } from "./approval-builder";

export class RunNotFoundError extends Error {}
export class IdempotencyConflictError extends Error {}

interface OrchestratorDependencies {
  repository: RunRepository;
  actorFactory: (mode: "live" | "replay", model: string | undefined, catalogSource: CreateRunInput["catalogSource"]) => Actor;
  supervisorFactory: (mode: "live" | "replay", model?: string) => Supervisor;
  paymentFactory: (mode: "live" | "replay") => PaymentExecutorPort;
}

const defaultDependencies: OrchestratorDependencies = {
  repository: runRepository,
  actorFactory: (mode, model, catalogSource) => createActor({ mode, model, catalogSource }),
  supervisorFactory: (mode, model) => createSupervisor({ mode, model }),
  paymentFactory: (mode) => createPaymentExecutor({
    paypalClient: mode === "replay" ? new MockPayPalClient() : undefined,
  }),
};

export class RunOrchestrator {
  constructor(private readonly dependencies: OrchestratorDependencies = defaultDependencies) {}

  async createRun(rawInput: unknown, idempotencyKey: string): Promise<{ run: RunView; created: boolean }> {
    const input: CreateRunInput = CreateRunInputSchema.parse(rawInput);
    const requestHash = sha256(input);
    const existingHash = await this.dependencies.repository.getRequestHash(idempotencyKey);
    if (existingHash) {
      if (existingHash !== requestHash) throw new IdempotencyConflictError();
      const existing = await this.dependencies.repository.findByIdempotencyKey(idempotencyKey);
      if (existing) return { run: existing, created: false };
    }

    const mode = getRunMode();
    const llm = mode === "live" ? configureLiveLlm() : null;
    const mandate: Mandate = {
      schemaVersion: "1",
      id: randomUUID(),
      goal: input.goal,
      budget: { currency: "USD", amountMinor: input.budget },
      constraints: input.constraints.map((constraint) => ({ id: randomUUID(), ...constraint })),
      createdAt: new Date().toISOString(),
    };

    let run: RunView;
    try {
      run = await this.dependencies.repository.createRun({
        idempotencyKey,
        requestHash,
        mandate,
        catalogSource: input.catalogSource,
        replay: mode === "replay",
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        const savedHash = await this.dependencies.repository.getRequestHash(idempotencyKey);
        if (savedHash !== requestHash) throw new IdempotencyConflictError();
        const existing = await this.dependencies.repository.findByIdempotencyKey(idempotencyKey);
        if (existing) return { run: existing, created: false };
      }
      throw error;
    }

    const actor = this.dependencies.actorFactory(mode, llm?.actorModel, input.catalogSource);
    const proposal = await actor.propose(mandate);
    const evidence = await actor.getEvidence(mandate.id);
    await this.dependencies.repository.saveProposal(run.id, proposal, evidence);
    await this.dependencies.repository.markSupervisorRunning(run.id);

    const supervisor = this.dependencies.supervisorFactory(mode, llm?.supervisorModel);
    const verdict = await supervisor.evaluateWithEvidence(mandate, proposal, evidence);
    await this.dependencies.repository.saveVerdict(run.id, verdict);

    if (verdict.decision === "BLOCK" || verdict.decision === "REVIEW") {
      const terminal = await this.dependencies.repository.findById(run.id);
      if (!terminal) throw new RunNotFoundError();
      return { run: terminal, created: true };
    }

    const approval = buildApprovedOrder(mandate, proposal, verdict);
    await this.dependencies.repository.saveApproval(run.id, approval);
    await this.dependencies.repository.updateStatus(run.id, "PAYMENT_PENDING");
    const payment = await this.dependencies.paymentFactory(mode).execute(approval);
    await this.dependencies.repository.updateStatus(run.id, payment.status);
    const completed = await this.dependencies.repository.findById(run.id);
    if (!completed) throw new RunNotFoundError();
    return { run: completed, created: true };
  }

  async getRun(runId: string): Promise<RunView | null> {
    return this.dependencies.repository.findById(runId);
  }

  async executeRun(runId: string): Promise<{ payment: RunView["payment"]; createdNow: boolean }> {
    const run = await this.dependencies.repository.findById(runId);
    if (!run) throw new RunNotFoundError();
    if (!run.approvedOrder || !run.verdict || run.verdict.decision === "BLOCK" || run.verdict.decision === "REVIEW") {
      throw new Error("RUN_NOT_APPROVABLE");
    }

    const mode = getRunMode();
    const hadPayPalOrder = Boolean(run.payment?.paypalOrderId);
    await this.dependencies.repository.updateStatus(run.id, "PAYMENT_PENDING");
    const payment = await this.dependencies.paymentFactory(mode).execute(run.approvedOrder);
    await this.dependencies.repository.updateStatus(run.id, payment.status);
    return {
      payment,
      createdNow: !hadPayPalOrder && payment.status === "PAYPAL_CREATED",
    };
  }
}

function getRunMode(): "live" | "replay" {
  const mode = process.env.APP_MODE ?? (process.env.NODE_ENV === "development" ? "replay" : "live");
  if (mode !== "live" && mode !== "replay") throw new Error("APP_MODE must be live or replay");
  if (mode === "live" && process.env.PAYPAL_MODE === "mock") {
    throw new Error("Mock PayPal is permitted only in Replay mode");
  }
  return mode;
}

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002");
}

export function isContractError(error: unknown): boolean {
  return error instanceof ZodError;
}

export const orchestrator = new RunOrchestrator();
