-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Reconciliation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "fileId" TEXT,
    "type" TEXT NOT NULL,
    "receivedAt" DATETIME NOT NULL,
    "processedAt" DATETIME,
    "recordCount" INTEGER NOT NULL,
    "updatedCount" INTEGER NOT NULL DEFAULT 0,
    "newAccountsCount" INTEGER NOT NULL DEFAULT 0,
    "totalUpdated" REAL NOT NULL DEFAULT 0,
    "notes" TEXT,
    "errorSummary" TEXT,
    "rawRows" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "branch" TEXT NOT NULL DEFAULT 'uganda',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Reconciliation_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Reconciliation_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Reconciliation" ("branch", "clientId", "createdAt", "errorSummary", "fileId", "id", "notes", "processedAt", "rawRows", "receivedAt", "recordCount", "status", "totalUpdated", "type", "updatedCount") SELECT "branch", "clientId", "createdAt", "errorSummary", "fileId", "id", "notes", "processedAt", "rawRows", "receivedAt", "recordCount", "status", "totalUpdated", "type", "updatedCount" FROM "Reconciliation";
DROP TABLE "Reconciliation";
ALTER TABLE "new_Reconciliation" RENAME TO "Reconciliation";
CREATE INDEX "Reconciliation_clientId_idx" ON "Reconciliation"("clientId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
