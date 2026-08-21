-- AlterTable
ALTER TABLE "Reconciliation" ADD COLUMN     "pendingNewAccountRows" TEXT,
ADD COLUMN     "rowsProcessed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "unmatchedCount" INTEGER NOT NULL DEFAULT 0;
