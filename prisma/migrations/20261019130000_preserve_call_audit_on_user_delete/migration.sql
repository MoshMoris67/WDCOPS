ALTER TABLE "CallLog" ADD COLUMN "agentName" TEXT;
ALTER TABLE "CallLog" ADD COLUMN "agentEmail" TEXT;

UPDATE "CallLog" AS c
SET "agentName" = u."name",
    "agentEmail" = u."email"
FROM "User" AS u
WHERE c."agentId" = u."id";

ALTER TABLE "CallLog" ALTER COLUMN "agentName" SET NOT NULL;
ALTER TABLE "CallLog" ALTER COLUMN "agentEmail" SET NOT NULL;
ALTER TABLE "CallLog" ALTER COLUMN "agentId" DROP NOT NULL;
ALTER TABLE "CallLog" DROP CONSTRAINT "CallLog_agentId_fkey";
ALTER TABLE "CallLog"
  ADD CONSTRAINT "CallLog_agentId_fkey"
  FOREIGN KEY ("agentId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CallLogCorrection" ADD COLUMN "correctedByName" TEXT;
ALTER TABLE "CallLogCorrection" ADD COLUMN "correctedByEmail" TEXT;

UPDATE "CallLogCorrection" AS c
SET "correctedByName" = u."name",
    "correctedByEmail" = u."email"
FROM "User" AS u
WHERE c."correctedById" = u."id";

ALTER TABLE "CallLogCorrection" ALTER COLUMN "correctedByName" SET NOT NULL;
ALTER TABLE "CallLogCorrection" ALTER COLUMN "correctedByEmail" SET NOT NULL;
ALTER TABLE "CallLogCorrection" ALTER COLUMN "correctedById" DROP NOT NULL;
ALTER TABLE "CallLogCorrection" DROP CONSTRAINT "CallLogCorrection_correctedById_fkey";
ALTER TABLE "CallLogCorrection"
  ADD CONSTRAINT "CallLogCorrection_correctedById_fkey"
  FOREIGN KEY ("correctedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
