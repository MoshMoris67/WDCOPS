CREATE TABLE "ReassignmentBatch" (
    "id" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "undoneAt" TIMESTAMP(3),

    CONSTRAINT "ReassignmentBatch_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Assignment"
    ADD COLUMN "reassignedFromName" TEXT,
    ADD COLUMN "reassignedFromEmail" TEXT,
    ADD COLUMN "reassignmentBatchId" TEXT,
    ADD COLUMN "reversesAssignmentId" TEXT;

CREATE INDEX "ReassignmentBatch_fileId_createdAt_idx"
    ON "ReassignmentBatch"("fileId", "createdAt");

CREATE INDEX "Assignment_reassignmentBatchId_idx"
    ON "Assignment"("reassignmentBatchId");

ALTER TABLE "ReassignmentBatch"
    ADD CONSTRAINT "ReassignmentBatch_fileId_fkey"
    FOREIGN KEY ("fileId") REFERENCES "File"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Assignment"
    ADD CONSTRAINT "Assignment_reassignmentBatchId_fkey"
    FOREIGN KEY ("reassignmentBatchId") REFERENCES "ReassignmentBatch"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
