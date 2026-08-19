-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "reconciliationType" TEXT NOT NULL,
    "reportingFrequency" TEXT NOT NULL,
    "branch" TEXT NOT NULL DEFAULT 'uganda',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "File" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "batchLabel" TEXT NOT NULL,
    "receivedDate" TIMESTAMP(3) NOT NULL,
    "isMidMonthTopup" BOOLEAN NOT NULL DEFAULT false,
    "isRecalled" BOOLEAN NOT NULL DEFAULT false,
    "branch" TEXT NOT NULL DEFAULT 'uganda',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "File_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Debtor" (
    "id" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone1" TEXT NOT NULL,
    "phone2" TEXT,
    "loanRef" TEXT NOT NULL,
    "amountOwed" DOUBLE PRECISION NOT NULL,
    "cumulativePaid" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "balance" DOUBLE PRECISION NOT NULL,
    "assignedAgentId" TEXT,
    "branch" TEXT NOT NULL DEFAULT 'uganda',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Debtor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallLog" (
    "id" TEXT NOT NULL,
    "debtorId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "dispositionCode" TEXT NOT NULL,
    "note" TEXT,
    "promisedAmount" DOUBLE PRECISION,
    "promisedDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "CallLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reconciliation" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "fileId" TEXT,
    "type" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "processedAt" TIMESTAMP(3),
    "recordCount" INTEGER NOT NULL,
    "updatedCount" INTEGER NOT NULL DEFAULT 0,
    "newAccountsCount" INTEGER NOT NULL DEFAULT 0,
    "totalUpdated" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT,
    "errorSummary" TEXT,
    "rawRows" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "branch" TEXT NOT NULL DEFAULT 'uganda',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Reconciliation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationEntry" (
    "id" TEXT NOT NULL,
    "reconciliationId" TEXT NOT NULL,
    "debtorId" TEXT NOT NULL,
    "oldBalance" DOUBLE PRECISION NOT NULL,
    "newBalance" DOUBLE PRECISION NOT NULL,
    "paidAmount" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReconciliationEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "branch" TEXT NOT NULL DEFAULT 'uganda',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Assignment" (
    "id" TEXT NOT NULL,
    "debtorId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reassignedFromId" TEXT,

    CONSTRAINT "Assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DispositionCode" (
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT NOT NULL DEFAULT '#64748B',
    "requiresCallback" BOOLEAN NOT NULL DEFAULT false,
    "requiresPtp" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "DispositionCode_pkey" PRIMARY KEY ("code")
);

-- CreateIndex
CREATE INDEX "File_clientId_idx" ON "File"("clientId");

-- CreateIndex
CREATE INDEX "Debtor_fileId_idx" ON "Debtor"("fileId");

-- CreateIndex
CREATE INDEX "Debtor_assignedAgentId_idx" ON "Debtor"("assignedAgentId");

-- CreateIndex
CREATE INDEX "Debtor_loanRef_idx" ON "Debtor"("loanRef");

-- CreateIndex
CREATE INDEX "Debtor_phone1_idx" ON "Debtor"("phone1");

-- CreateIndex
CREATE INDEX "CallLog_debtorId_idx" ON "CallLog"("debtorId");

-- CreateIndex
CREATE INDEX "CallLog_agentId_idx" ON "CallLog"("agentId");

-- CreateIndex
CREATE INDEX "CallLog_debtorId_createdAt_idx" ON "CallLog"("debtorId", "createdAt");

-- CreateIndex
CREATE INDEX "CallLog_createdAt_idx" ON "CallLog"("createdAt");

-- CreateIndex
CREATE INDEX "Reconciliation_clientId_idx" ON "Reconciliation"("clientId");

-- CreateIndex
CREATE INDEX "ReconciliationEntry_reconciliationId_idx" ON "ReconciliationEntry"("reconciliationId");

-- CreateIndex
CREATE INDEX "ReconciliationEntry_debtorId_idx" ON "ReconciliationEntry"("debtorId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Assignment_debtorId_idx" ON "Assignment"("debtorId");

-- AddForeignKey
ALTER TABLE "File" ADD CONSTRAINT "File_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Debtor" ADD CONSTRAINT "Debtor_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Debtor" ADD CONSTRAINT "Debtor_assignedAgentId_fkey" FOREIGN KEY ("assignedAgentId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallLog" ADD CONSTRAINT "CallLog_debtorId_fkey" FOREIGN KEY ("debtorId") REFERENCES "Debtor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallLog" ADD CONSTRAINT "CallLog_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reconciliation" ADD CONSTRAINT "Reconciliation_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reconciliation" ADD CONSTRAINT "Reconciliation_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationEntry" ADD CONSTRAINT "ReconciliationEntry_reconciliationId_fkey" FOREIGN KEY ("reconciliationId") REFERENCES "Reconciliation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationEntry" ADD CONSTRAINT "ReconciliationEntry_debtorId_fkey" FOREIGN KEY ("debtorId") REFERENCES "Debtor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_debtorId_fkey" FOREIGN KEY ("debtorId") REFERENCES "Debtor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
