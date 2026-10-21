-- CreateEnum
CREATE TYPE "CallDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "CallStatus" AS ENUM ('QUEUED', 'RINGING', 'IN_PROGRESS', 'COMPLETED', 'NO_ANSWER', 'BUSY', 'FAILED', 'CANCELED');

-- AlterTable
ALTER TABLE "Membership" ADD COLUMN     "phone" TEXT;

-- CreateTable
CREATE TABLE "Call" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerCallId" TEXT,
    "direction" "CallDirection" NOT NULL,
    "status" "CallStatus" NOT NULL DEFAULT 'QUEUED',
    "contactPhone" TEXT NOT NULL,
    "agentId" TEXT,
    "agentPhone" TEXT,
    "leadId" TEXT,
    "clientId" TEXT,
    "caseId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answeredAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "durationSec" INTEGER,
    "recordingRef" TEXT,
    "recordingKey" TEXT,
    "recordingMime" TEXT,
    "transcript" JSONB,
    "language" TEXT,
    "aiStatus" TEXT,
    "aiError" TEXT,
    "summary" TEXT,
    "ai" JSONB,
    "outcome" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Call_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Call_providerCallId_key" ON "Call"("providerCallId");

-- CreateIndex
CREATE INDEX "Call_tenantId_startedAt_idx" ON "Call"("tenantId", "startedAt");

-- CreateIndex
CREATE INDEX "Call_tenantId_leadId_idx" ON "Call"("tenantId", "leadId");

-- CreateIndex
CREATE INDEX "Call_tenantId_clientId_idx" ON "Call"("tenantId", "clientId");

-- CreateIndex
CREATE INDEX "Call_tenantId_agentId_startedAt_idx" ON "Call"("tenantId", "agentId", "startedAt");

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- A call belongs to a lead or a client.
ALTER TABLE "Call" ADD CONSTRAINT "Call_contact_check" CHECK ("clientId" IS NOT NULL OR "leadId" IS NOT NULL);

-- Tenant isolation (same policy as migrations/*_rls).
ALTER TABLE "Call" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Call" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Call"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
ALTER TABLE "Call" ADD CONSTRAINT "Call_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON DELETE CASCADE;
