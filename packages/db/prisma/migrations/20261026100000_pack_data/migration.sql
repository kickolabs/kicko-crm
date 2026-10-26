-- Industry-pack field values on leads, clients and cases, kept apart from agency custom fields.
-- AlterTable
ALTER TABLE "Case" ADD COLUMN     "packData" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "packData" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "packData" JSONB NOT NULL DEFAULT '{}';
