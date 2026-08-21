-- AlterTable
ALTER TABLE "File" ADD COLUMN     "importMapping" TEXT,
ADD COLUMN     "importWarnings" TEXT,
ADD COLUMN     "rawFile" TEXT,
ADD COLUMN     "rawFileName" TEXT;
