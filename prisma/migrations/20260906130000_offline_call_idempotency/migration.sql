ALTER TABLE "CallLog" ADD COLUMN "clientRequestId" TEXT;
CREATE UNIQUE INDEX "CallLog_clientRequestId_key" ON "CallLog"("clientRequestId");