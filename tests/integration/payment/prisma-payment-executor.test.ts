import { rm } from "node:fs/promises";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApprovedOrder } from "@/shared/contracts";
import {
  createPaymentExecutor,
  MockPayPalClient,
  PayPalClientError,
  PrismaPaymentExecutionStore,
} from "@/modules/payment";
import {
  makeApprovedOrder,
  makeMandate,
  makeVerdict,
} from "../../unit/payment/test-helpers";

vi.mock("server-only", () => ({}));

const databasePath = join(process.cwd(), "tests/integration/payment/.payment-executor.test.db");
const databaseUrl = `file:${databasePath}`;
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const order = makeApprovedOrder();

describe("PrismaPaymentExecutionStore integration", () => {
  beforeAll(async () => {
    await removeDatabaseFiles();
    await prisma.$connect();
    await prisma.$executeRawUnsafe("PRAGMA foreign_keys = ON");
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "Run" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "status" TEXT NOT NULL,
        "runIdempotencyKey" TEXT NOT NULL,
        "requestHash" TEXT NOT NULL,
        "mandateJson" JSONB NOT NULL,
        "catalogSource" TEXT NOT NULL DEFAULT 'fixtures',
        "proposedOrderJson" JSONB,
        "verdictJson" JSONB,
        "approvedOrderJson" JSONB,
        "approvedOrderId" TEXT,
        "approvalHash" TEXT,
        "inputHash" TEXT,
        "replay" BOOLEAN NOT NULL DEFAULT false,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "Run_runIdempotencyKey_key" UNIQUE ("runIdempotencyKey"),
        CONSTRAINT "Run_approvedOrderId_key" UNIQUE ("approvedOrderId")
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "PaymentExecution" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "runId" TEXT NOT NULL,
        "approvedOrderId" TEXT NOT NULL,
        "approvalHash" TEXT NOT NULL,
        "paypalRequestId" TEXT NOT NULL,
        "paypalOrderId" TEXT,
        "paypalStatus" TEXT,
        "approveUrl" TEXT,
        "status" TEXT NOT NULL,
        "errorCode" TEXT,
        "leaseToken" TEXT,
        "leaseExpiresAt" DATETIME,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "PaymentExecution_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "PaymentExecution_runId_key" UNIQUE ("runId"),
        CONSTRAINT "PaymentExecution_approvedOrderId_key" UNIQUE ("approvedOrderId"),
        CONSTRAINT "PaymentExecution_paypalRequestId_key" UNIQUE ("paypalRequestId"),
        CONSTRAINT "PaymentExecution_paypalOrderId_key" UNIQUE ("paypalOrderId"),
        CONSTRAINT "PaymentExecution_leaseToken_key" UNIQUE ("leaseToken")
      )
    `);
  });

  beforeEach(async () => {
    await prisma.paymentExecution.deleteMany();
    await prisma.run.deleteMany();
    await seedApprovedRun(order);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await removeDatabaseFiles();
  });

  it("persists one execution and one create for 10 parallel calls", async () => {
    const store = new PrismaPaymentExecutionStore(prisma);
    const client = new MockPayPalClient(async (_input, call) => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return { id: `PRISMA-ORDER-${call}`, status: "CREATED" };
    });
    const executor = createPaymentExecutor({
      store,
      paypalClient: client,
      pollIntervalMs: 2,
      waitTimeoutMs: 5_000,
    });

    const views = await Promise.all(Array.from({ length: 10 }, () => executor.execute(order)));

    expect(client.oauthCalls).toBe(1);
    expect(client.ordersCalls).toBe(1);
    expect(views.every((view) => view.paypalOrderId === "PRISMA-ORDER-1")).toBe(true);
    expect(await prisma.paymentExecution.count()).toBe(1);
    const persisted = await prisma.paymentExecution.findUniqueOrThrow({ where: { approvedOrderId: order.id } });
    expect(persisted).toMatchObject({
      paypalRequestId: order.idempotencyKey,
      paypalOrderId: "PRISMA-ORDER-1",
      status: "PAYPAL_CREATED",
      leaseToken: null,
    });
    expect((await prisma.run.findUniqueOrThrow({ where: { approvedOrderId: order.id } })).status).toBe("PAYPAL_CREATED");
  });

  it("reuses the persisted request ID and byte-equivalent body after UNKNOWN", async () => {
    const store = new PrismaPaymentExecutionStore(prisma);
    const client = new MockPayPalClient((_input, call) => {
      if (call === 1) throw new PayPalClientError("timeout", "PAYPAL_TIMEOUT");
      return { id: "PRISMA-RETRY-ORDER", status: "CREATED" };
    });
    const executor = createPaymentExecutor({ store, paypalClient: client });

    const unknown = await executor.execute(order);
    const created = await executor.execute(order);
    const replay = await executor.execute(order);

    expect(unknown).toMatchObject({ status: "PAYMENT_UNKNOWN", errorCode: "PAYPAL_TIMEOUT" });
    expect(created.status).toBe("PAYPAL_CREATED");
    expect(replay).toEqual(created);
    expect(client.ordersCalls).toBe(2);
    expect(client.requests[0]).toEqual(client.requests[1]);
    expect(client.requests[0]?.requestId).toBe(order.idempotencyKey);
    expect(await prisma.paymentExecution.count()).toBe(1);
  });

  it("rejects tampering before OAuth and leaves no execution row", async () => {
    const store = new PrismaPaymentExecutionStore(prisma);
    const client = new MockPayPalClient();
    const executor = createPaymentExecutor({ store, paypalClient: client });
    const tampered = { ...order, approvalHash: "f".repeat(64) } as ApprovedOrder;

    await expect(executor.execute(tampered)).rejects.toMatchObject({ code: "APPROVAL_HASH_MISMATCH" });
    expect(client.oauthCalls).toBe(0);
    expect(client.ordersCalls).toBe(0);
    expect(await prisma.paymentExecution.count()).toBe(0);
  });
});

async function seedApprovedRun(approvedOrder: ApprovedOrder): Promise<void> {
  await prisma.run.create({
    data: {
      status: "APPROVED",
      runIdempotencyKey: "77777777-7777-4777-8777-777777777777",
      requestHash: "b".repeat(64),
      mandateJson: makeMandate(approvedOrder),
      verdictJson: makeVerdict(approvedOrder),
      approvedOrderJson: approvedOrder,
      approvedOrderId: approvedOrder.id,
      approvalHash: approvedOrder.approvalHash,
      inputHash: "a".repeat(64),
      replay: true,
    },
  });
}

async function removeDatabaseFiles(): Promise<void> {
  await Promise.all([
    rm(databasePath, { force: true }),
    rm(`${databasePath}-wal`, { force: true }),
    rm(`${databasePath}-shm`, { force: true }),
    rm(`${databasePath}-journal`, { force: true }),
  ]);
}
