-- AlterTable
ALTER TABLE "ReconciliationEntry" ADD COLUMN     "paidDate" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "FileSync" (
    "id" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "error" TEXT,
    "rawFile" TEXT,
    "rawFileName" TEXT,
    "callingListMapping" TEXT,
    "paymentMapping" TEXT,
    "newDebtorsCount" INTEGER NOT NULL DEFAULT 0,
    "paymentsAppliedCount" INTEGER NOT NULL DEFAULT 0,
    "paymentsSkippedCount" INTEGER NOT NULL DEFAULT 0,
    "parsingStartedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "FileSync_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReconciliationEntry_debtorId_paidDate_idx" ON "ReconciliationEntry"("debtorId", "paidDate");

-- CreateIndex
CREATE INDEX "FileSync_fileId_idx" ON "FileSync"("fileId");

-- CreateIndex
CREATE INDEX "FileSync_status_idx" ON "FileSync"("status");

-- AddForeignKey
ALTER TABLE "FileSync" ADD CONSTRAINT "FileSync_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
