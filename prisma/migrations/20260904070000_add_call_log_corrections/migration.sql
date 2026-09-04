-- AlterTable
ALTER TABLE "CallLog" ADD COLUMN     "editedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "CallLogCorrection" (
    "id" TEXT NOT NULL,
    "callLogId" TEXT NOT NULL,
    "correctedById" TEXT NOT NULL,
    "previousDispositionCode" TEXT NOT NULL,
    "previousNote" TEXT,
    "previousPromisedAmount" DOUBLE PRECISION,
    "previousPromisedDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CallLogCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CallLogCorrection_callLogId_idx" ON "CallLogCorrection"("callLogId");

-- AddForeignKey
ALTER TABLE "CallLogCorrection" ADD CONSTRAINT "CallLogCorrection_callLogId_fkey" FOREIGN KEY ("callLogId") REFERENCES "CallLog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallLogCorrection" ADD CONSTRAINT "CallLogCorrection_correctedById_fkey" FOREIGN KEY ("correctedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
