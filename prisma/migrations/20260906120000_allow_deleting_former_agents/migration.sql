-- Preserve the former agent's identity in assignment history before allowing
-- the live User record to be removed.
ALTER TABLE "Assignment" ADD COLUMN "agentName" TEXT;
ALTER TABLE "Assignment" ADD COLUMN "agentEmail" TEXT;

UPDATE "Assignment" AS a
SET "agentName" = u."name", "agentEmail" = u."email"
FROM "User" AS u
WHERE a."agentId" = u."id";

ALTER TABLE "Assignment" DROP CONSTRAINT "Assignment_agentId_fkey";
ALTER TABLE "Assignment" ALTER COLUMN "agentId" DROP NOT NULL;

ALTER TABLE "Assignment"
  ADD CONSTRAINT "Assignment_agentId_fkey"
  FOREIGN KEY ("agentId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;