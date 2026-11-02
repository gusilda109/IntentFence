import "server-only";
import type { PrismaClient } from "@prisma/client";
import {
  ApprovedOrderSchema,
  EvidenceRecordSchema,
  MandateSchema,
  PaymentExecutionViewSchema,
  ProposedOrderSchema,
  VerdictSchema,
  type ApprovedOrder,
  type CatalogSource,
  type EvidenceRecord,
  type Mandate,
  type ProposedOrder,
  type RunStatus,
  type RunView,
  type Verdict,
} from "@/shared/contracts";
import { db } from "@/server/db";

type RunWithRelations = {
  id: string;
  status: string;
  runIdempotencyKey: string;
  requestHash: string;
  mandateJson: unknown;
  catalogSource: CatalogSource;
  proposedOrderJson: unknown | null;
  verdictJson: unknown | null;
  approvedOrderJson: unknown | null;
  replay: boolean;
  createdAt: Date;
  updatedAt: Date;
  evidence: Array<{ evidenceJson: unknown; securityReportJson: unknown }>;
  payment: {
    status: string;
    paypalOrderId: string | null;
    paypalStatus: string | null;
    approveUrl: string | null;
    errorCode: string | null;
    createdAt: Date;
    updatedAt: Date;
  } | null;
};

export class RunRepository {
  constructor(private readonly prisma: PrismaClient = db) {}

  async findByIdempotencyKey(key: string): Promise<RunView | null> {
    const run = await this.prisma.run.findUnique({
      where: { runIdempotencyKey: key },
      include: { evidence: true, payment: true },
    });
    return run ? toRunView(run as unknown as RunWithRelations) : null;
  }

  async getRequestHash(key: string): Promise<string | null> {
    const run = await this.prisma.run.findUnique({
      where: { runIdempotencyKey: key },
      select: { requestHash: true },
    });
    return run?.requestHash ?? null;
  }

  async findById(id: string): Promise<RunView | null> {
    const run = await this.prisma.run.findUnique({
      where: { id },
      include: { evidence: { orderBy: { createdAt: "asc" } }, payment: true },
    });
    return run ? toRunView(run as unknown as RunWithRelations) : null;
  }

  async createRun(input: {
    idempotencyKey: string;
    requestHash: string;
    mandate: Mandate;
    catalogSource: CatalogSource;
    replay: boolean;
  }): Promise<RunView> {
    const run = await this.prisma.run.create({
      data: {
        status: "ACTOR_RUNNING",
        runIdempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash,
        mandateJson: input.mandate,
        catalogSource: input.catalogSource,
        replay: input.replay,
      },
      include: { evidence: true, payment: true },
    });
    return toRunView(run as unknown as RunWithRelations);
  }

  async saveProposal(runId: string, proposal: ProposedOrder, evidence: EvidenceRecord[]): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.run.update({
        where: { id: runId },
        data: { proposedOrderJson: proposal, status: "PROPOSED" },
      });
      for (const record of evidence) {
        await tx.evidenceRecord.create({
          data: {
            runId,
            evidenceId: record.evidence.id,
            captureId: record.evidence.captureId,
            publisherId: record.evidence.source.publisherId,
            sourceClass: record.evidence.source.sourceClass,
            contentHash: record.evidence.contentHash,
            securityStatus: record.security.status,
            evidenceJson: record.evidence,
            securityReportJson: record.security,
          },
        });
      }
    });
  }

  async markSupervisorRunning(runId: string): Promise<void> {
    await this.updateStatus(runId, "SUPERVISOR_RUNNING");
  }

  async saveVerdict(runId: string, verdict: Verdict): Promise<void> {
    const status: RunStatus = verdict.decision === "BLOCK"
      ? "BLOCKED"
      : verdict.decision === "REVIEW"
        ? "REVIEW_REQUIRED"
        : "APPROVED";
    await this.prisma.$transaction(async (tx) => {
      await tx.run.update({
        where: { id: runId },
        data: { verdictJson: verdict, inputHash: verdict.inputHash, status },
      });
      await tx.policyEvent.deleteMany({ where: { runId } });
      const findings = [
        ...verdict.findings,
        ...verdict.itemDecisions.flatMap((item) => item.reasons),
      ];
      for (const [index, finding] of findings.entries()) {
        await tx.policyEvent.create({
          data: {
            runId,
            sequence: index,
            level: finding.severity,
            code: finding.code,
            message: finding.message,
            itemId: finding.itemId,
          },
        });
      }
    });
  }

  async saveApproval(runId: string, approval: ApprovedOrder): Promise<void> {
    await this.prisma.run.update({
      where: { id: runId },
      data: {
        approvedOrderJson: approval,
        approvedOrderId: approval.id,
        approvalHash: approval.approvalHash,
        status: "APPROVED",
      },
    });
  }

  async updateStatus(runId: string, status: RunStatus): Promise<void> {
    await this.prisma.run.update({ where: { id: runId }, data: { status } });
  }
}

export function toRunView(run: RunWithRelations): RunView {
  const payment = run.payment ? PaymentExecutionViewSchema.parse({
    status: run.payment.status,
    paypalOrderId: run.payment.paypalOrderId ?? undefined,
    paypalStatus: run.payment.paypalStatus ?? undefined,
    approveUrl: run.payment.approveUrl ?? undefined,
    errorCode: run.payment.errorCode ?? undefined,
    createdAt: run.payment.createdAt.toISOString(),
    updatedAt: run.payment.updatedAt.toISOString(),
  }) : null;

  return {
    id: run.id,
    status: run.status as RunStatus,
    mandate: MandateSchema.parse(run.mandateJson),
    catalogSource: run.catalogSource,
    proposedOrder: run.proposedOrderJson ? ProposedOrderSchema.parse(run.proposedOrderJson) : null,
    evidence: run.evidence.map((record) => EvidenceRecordSchema.parse({
      evidence: record.evidenceJson,
      security: record.securityReportJson,
    })),
    verdict: run.verdictJson ? VerdictSchema.parse(run.verdictJson) : null,
    approvedOrder: run.approvedOrderJson ? ApprovedOrderSchema.parse(run.approvedOrderJson) : null,
    payment,
    replay: run.replay,
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
  };
}

export const runRepository = new RunRepository();
