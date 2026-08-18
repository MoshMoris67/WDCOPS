-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_DispositionCode" (
    "code" TEXT NOT NULL PRIMARY KEY,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT NOT NULL DEFAULT '#64748B',
    "requiresCallback" BOOLEAN NOT NULL DEFAULT false,
    "requiresPtp" BOOLEAN NOT NULL DEFAULT false
);
INSERT INTO "new_DispositionCode" ("code", "description", "label", "requiresCallback", "requiresPtp") SELECT "code", "description", "label", "requiresCallback", "requiresPtp" FROM "DispositionCode";
DROP TABLE "DispositionCode";
ALTER TABLE "new_DispositionCode" RENAME TO "DispositionCode";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
