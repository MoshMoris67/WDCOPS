-- AlterTable
ALTER TABLE "File" ADD COLUMN     "parsingStartedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Reconciliation" ADD COLUMN     "parsingStartedAt" TIMESTAMP(3);
