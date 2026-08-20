-- AlterTable
ALTER TABLE "File" ADD COLUMN     "rawRows" TEXT,
ALTER COLUMN "updatedAt" DROP DEFAULT;
