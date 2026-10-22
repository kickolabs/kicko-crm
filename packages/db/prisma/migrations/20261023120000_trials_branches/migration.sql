-- AlterTable
ALTER TABLE "Case" ADD COLUMN     "branchId" TEXT;

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "branchId" TEXT;

-- AlterTable
ALTER TABLE "user" ADD COLUMN     "phoneNumber" TEXT,
ADD COLUMN     "phoneNumberVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "trialUsedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "TrialClaim" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "deviceId" TEXT,
    "fingerprint" TEXT,
    "ipHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrialClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrialReview" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "matchTenantId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrialReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TrialClaim_phone_key" ON "TrialClaim"("phone");

-- CreateIndex
CREATE INDEX "TrialClaim_deviceId_idx" ON "TrialClaim"("deviceId");

-- CreateIndex
CREATE INDEX "TrialClaim_fingerprint_idx" ON "TrialClaim"("fingerprint");

-- CreateIndex
CREATE INDEX "TrialClaim_ipHash_createdAt_idx" ON "TrialClaim"("ipHash", "createdAt");

-- CreateIndex
CREATE INDEX "TrialReview_status_createdAt_idx" ON "TrialReview"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "user_phoneNumber_key" ON "user"("phoneNumber");

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Case" ADD CONSTRAINT "Case_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- One free trial per person: everyone who already owns a workspace has used theirs.
-- Membership has forced RLS; the platform-admin read policy lets this migration see every row.
SELECT set_config('app.platform_admin', 'on', true);
UPDATE "user" u
SET "trialUsedAt" = o.first
FROM (
  SELECT m."userId", MIN(t."createdAt") AS first
  FROM "Membership" m
  JOIN "Tenant" t ON t.id = m."tenantId"
  WHERE m.role = 'OWNER'
  GROUP BY m."userId"
) o
WHERE u.id = o."userId";
