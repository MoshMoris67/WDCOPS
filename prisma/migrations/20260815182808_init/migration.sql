-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "reconciliationType" TEXT NOT NULL,
    "reportingFrequency" TEXT NOT NULL,
    "branch" TEXT NOT NULL DEFAULT 'uganda',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "File" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "batchLabel" TEXT NOT NULL,
    "receivedDate" DATETIME NOT NULL,
    "isMidMonthTopup" BOOLEAN NOT NULL DEFAULT false,
    "branch" TEXT NOT NULL DEFAULT 'uganda',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "File_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Debtor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fileId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone1" TEXT NOT NULL,
    "phone2" TEXT,
    "loanRef" TEXT NOT NULL,
    "amountOwed" REAL NOT NULL,
    "cumulativePaid" REAL NOT NULL DEFAULT 0,
    "balance" REAL NOT NULL,
    "assignedAgentId" TEXT,
    "branch" TEXT NOT NULL DEFAULT 'uganda',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Debtor_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Debtor_assignedAgentId_fkey" FOREIGN KEY ("assignedAgentId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CallLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "debtorId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "dispositionCode" TEXT NOT NULL,
    "note" TEXT,
    "promisedAmount" REAL,
    "promisedDate" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "syncedAt" DATETIME,
    CONSTRAINT "CallLog_debtorId_fkey" FOREIGN KEY ("debtorId") REFERENCES "Debtor" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CallLog_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Reconciliation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "fileId" TEXT,
    "type" TEXT NOT NULL,
    "receivedAt" DATETIME NOT NULL,
    "processedAt" DATETIME,
    "recordCount" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "branch" TEXT NOT NULL DEFAULT 'uganda',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Reconciliation_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Reconciliation_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "employmentType" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "branch" TEXT NOT NULL DEFAULT 'uganda',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Assignment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "debtorId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "assignedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reassignedFromId" TEXT,
    CONSTRAINT "Assignment_debtorId_fkey" FOREIGN KEY ("debtorId") REFERENCES "Debtor" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Assignment_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DispositionCode" (
    "code" TEXT NOT NULL PRIMARY KEY,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "requiresCallback" BOOLEAN NOT NULL DEFAULT false,
    "requiresPtp" BOOLEAN NOT NULL DEFAULT false
);

-- CreateIndex
CREATE INDEX "File_clientId_idx" ON "File"("clientId");

-- CreateIndex
CREATE INDEX "Debtor_fileId_idx" ON "Debtor"("fileId");

-- CreateIndex
CREATE INDEX "Debtor_assignedAgentId_idx" ON "Debtor"("assignedAgentId");

-- CreateIndex
CREATE INDEX "Debtor_loanRef_idx" ON "Debtor"("loanRef");

-- CreateIndex
CREATE INDEX "Debtor_phone1_idx" ON "Debtor"("phone1");

-- CreateIndex
CREATE INDEX "CallLog_debtorId_idx" ON "CallLog"("debtorId");

-- CreateIndex
CREATE INDEX "CallLog_agentId_idx" ON "CallLog"("agentId");

-- CreateIndex
CREATE INDEX "Reconciliation_clientId_idx" ON "Reconciliation"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Assignment_debtorId_idx" ON "Assignment"("debtorId");
