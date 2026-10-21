-- AlterTable
ALTER TABLE "Call" ADD COLUMN     "aiAgent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "attempt" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "purpose" TEXT,
ADD COLUMN     "scheduledAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Call_tenantId_status_scheduledAt_idx" ON "Call"("tenantId", "status", "scheduledAt");

