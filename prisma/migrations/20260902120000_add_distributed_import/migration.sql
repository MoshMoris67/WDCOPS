-- AlterTable
ALTER TABLE "File" ADD COLUMN     "isDistributedImport" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sheetPlan" TEXT;
