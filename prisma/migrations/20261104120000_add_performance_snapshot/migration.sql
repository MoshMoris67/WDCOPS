CREATE TABLE "PerformanceSnapshot" (
    "id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "batchLabel" TEXT NOT NULL,
    "agentId" TEXT,
    "agentName" TEXT NOT NULL,
    "accountsAssigned" INTEGER NOT NULL DEFAULT 0,
    "bookAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "accountsPaid" INTEGER NOT NULL DEFAULT 0,
    "paymentCount" INTEGER NOT NULL DEFAULT 0,
    "recovered" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "agentCommission" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "companyCommission" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "callsMade" INTEGER NOT NULL DEFAULT 0,
    "promisesMade" INTEGER NOT NULL DEFAULT 0,
    "promisedAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PerformanceSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PerformanceSnapshot_month_clientId_idx" ON "PerformanceSnapshot"("month", "clientId");
CREATE INDEX "PerformanceSnapshot_clientId_fileId_month_idx" ON "PerformanceSnapshot"("clientId", "fileId", "month");
