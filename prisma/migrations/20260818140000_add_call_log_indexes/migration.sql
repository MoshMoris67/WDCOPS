-- CreateIndex
CREATE INDEX "CallLog_debtorId_createdAt_idx" ON "CallLog"("debtorId", "createdAt");

-- CreateIndex
CREATE INDEX "CallLog_createdAt_idx" ON "CallLog"("createdAt");
