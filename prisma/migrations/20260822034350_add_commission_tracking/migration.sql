-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "agentCommissionShare" DOUBLE PRECISION NOT NULL DEFAULT 0.20;

-- AlterTable
ALTER TABLE "ReconciliationEntry" ADD COLUMN     "agentCommission" DOUBLE PRECISION,
ADD COLUMN     "bucket" TEXT,
ADD COLUMN     "companyCommission" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "CommissionRate" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "rate" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "CommissionRate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CommissionRate_clientId_idx" ON "CommissionRate"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "CommissionRate_clientId_bucket_key" ON "CommissionRate"("clientId", "bucket");

-- AddForeignKey
ALTER TABLE "CommissionRate" ADD CONSTRAINT "CommissionRate_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
