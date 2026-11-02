-- CreateTable
CREATE TABLE "Run" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL,
    "runIdempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "mandateJson" JSONB NOT NULL,
    "proposedOrderJson" JSONB,
    "verdictJson" JSONB,
    "approvedOrderJson" JSONB,
    "approvedOrderId" TEXT,
    "approvalHash" TEXT,
    "inputHash" TEXT,
    "replay" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "EvidenceRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "captureId" TEXT NOT NULL,
    "publisherId" TEXT NOT NULL,
    "sourceClass" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "securityStatus" TEXT NOT NULL,
    "evidenceJson" JSONB NOT NULL,
    "securityReportJson" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EvidenceRecord_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
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
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PaymentExecution_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PolicyEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "level" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "itemId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PolicyEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Run_runIdempotencyKey_key" ON "Run"("runIdempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Run_approvedOrderId_key" ON "Run"("approvedOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceRecord_evidenceId_key" ON "EvidenceRecord"("evidenceId");

-- CreateIndex
CREATE INDEX "EvidenceRecord_runId_idx" ON "EvidenceRecord"("runId");

-- CreateIndex
CREATE INDEX "EvidenceRecord_captureId_idx" ON "EvidenceRecord"("captureId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentExecution_runId_key" ON "PaymentExecution"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentExecution_approvedOrderId_key" ON "PaymentExecution"("approvedOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentExecution_paypalRequestId_key" ON "PaymentExecution"("paypalRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentExecution_paypalOrderId_key" ON "PaymentExecution"("paypalOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentExecution_leaseToken_key" ON "PaymentExecution"("leaseToken");

-- CreateIndex
CREATE UNIQUE INDEX "PolicyEvent_runId_sequence_key" ON "PolicyEvent"("runId", "sequence");
