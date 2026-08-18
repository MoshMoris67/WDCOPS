-- Merge in-house/external agent distinction away — it never gated any real behavior.
ALTER TABLE "User" DROP COLUMN "employmentType";
