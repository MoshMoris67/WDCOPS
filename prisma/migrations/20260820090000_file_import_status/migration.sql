-- AlterTable
ALTER TABLE "File" ADD COLUMN "importStatus" TEXT NOT NULL DEFAULT 'complete';
ALTER TABLE "File" ADD COLUMN "importError" TEXT;
