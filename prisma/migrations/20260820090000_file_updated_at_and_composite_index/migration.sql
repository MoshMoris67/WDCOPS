-- AlterTable
ALTER TABLE "File" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "Debtor_fileId_assignedAgentId_idx" ON "Debtor"("fileId", "assignedAgentId");
