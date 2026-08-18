-- CreateTable
CREATE TABLE "ReconciliationEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reconciliationId" TEXT NOT NULL,
    "debtorId" TEXT NOT NULL,
    "oldBalance" REAL NOT NULL,
    "newBalance" REAL NOT NULL,
    "paidAmount" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReconciliationEntry_reconciliationId_fkey" FOREIGN KEY ("reconciliationId") REFERENCES "Reconciliation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReconciliationEntry_debtorId_fkey" FOREIGN KEY ("debtorId") REFERENCES "Debtor" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_File" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "batchLabel" TEXT NOT NULL,
    "receivedDate" DATETIME NOT NULL,
    "isMidMonthTopup" BOOLEAN NOT NULL DEFAULT false,
    "isRecalled" BOOLEAN NOT NULL DEFAULT false,
    "branch" TEXT NOT NULL DEFAULT 'uganda',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "File_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_File" ("batchLabel", "branch", "clientId", "createdAt", "id", "isMidMonthTopup", "receivedDate") SELECT "batchLabel", "branch", "clientId", "createdAt", "id", "isMidMonthTopup", "receivedDate" FROM "File";
DROP TABLE "File";
ALTER TABLE "new_File" RENAME TO "File";
CREATE INDEX "File_clientId_idx" ON "File"("clientId");
CREATE TABLE "new_Reconciliation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "fileId" TEXT,
    "type" TEXT NOT NULL,
    "receivedAt" DATETIME NOT NULL,
    "processedAt" DATETIME,
    "recordCount" INTEGER NOT NULL,
    "updatedCount" INTEGER NOT NULL DEFAULT 0,
    "totalUpdated" REAL NOT NULL DEFAULT 0,
    "notes" TEXT,
    "errorSummary" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "branch" TEXT NOT NULL DEFAULT 'uganda',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Reconciliation_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Reconciliation_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Reconciliation" ("branch", "clientId", "createdAt", "fileId", "id", "processedAt", "receivedAt", "recordCount", "status", "type") SELECT "branch", "clientId", "createdAt", "fileId", "id", "processedAt", "receivedAt", "recordCount", "status", "type" FROM "Reconciliation";
DROP TABLE "Reconciliation";
ALTER TABLE "new_Reconciliation" RENAME TO "Reconciliation";
CREATE INDEX "Reconciliation_clientId_idx" ON "Reconciliation"("clientId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "ReconciliationEntry_reconciliationId_idx" ON "ReconciliationEntry"("reconciliationId");

-- CreateIndex
CREATE INDEX "ReconciliationEntry_debtorId_idx" ON "ReconciliationEntry"("debtorId");
